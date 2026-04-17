/**
 * Save reconciler — runs after reconstruirMundo to detect and fix drift
 * between a loaded save and the current code.
 *
 * Each "healer" inspects the world (and the DTO it came from) for a
 * specific kind of problem (missing field, orphan reference, out-of-
 * domain value) and tries to repair it without losing data. Healers run
 * in isolation — if one crashes the rest still run.
 *
 * Migrations vs reconciler:
 *   - `migrations.ts` rewrites the DTO blob *before* reconstruction.
 *     Use it for schema-level transforms (renaming fields, bumping
 *     versions, backfilling required arrays).
 *   - `reconciler.ts` works on the already-built Mundo and module state
 *     *after* reconstruction. Use it for semantic drift: "this value is
 *     valid JSON but no longer makes sense under current gameplay code".
 *
 * The two layers overlap on purpose — the reconciler is defensive even
 * against data that migrations should have cleaned, so corrupt blobs
 * that slip past the migration stage still produce a playable world.
 */

import type { Mundo, Nave } from '../../types';
import type { MundoDTO } from './dto';
import type { PersonalidadeIA, Arquetipo, Dificuldade } from '../personalidade-ia';
import { gerarPersonalidade, PRESETS_DIFICULDADE } from '../personalidade-ia';
import { getDificuldadeAtual } from '../mundo';
import {
  getPersonalidades,
  setPersonalidadesParaMundoCarregado,
} from '../ia-decisao';
import { STATS_COMBATE, getStatsCombate } from '../combate';
import { CATEGORIAS_PESQUISA, TIER_MAX } from '../constantes';
import { gerarLoreFaccao } from '../lore-faccao';
import {
  restaurarMemoriasIa,
  getMemoriasIaSerializadas,
} from '../ia-memoria';

// ─── Public API ──────────────────────────────────────────────────────

export interface Diagnostico {
  severidade: 'info' | 'warn' | 'erro';
  categoria: string;
  detalhe: string;
  /** Optional entity id the diagnostic refers to. */
  entidade?: string;
}

export interface ReconciliarOpts {
  /**
   * Schema version the save had on disk, before migrations. Used by
   * healers that want to explain "this fix was needed because the save
   * is from v1".
   */
  versaoOriginal?: number;
  /** Labels of migrations that were applied — passed through to logs. */
  transformsAplicados?: readonly string[];
}

interface Healer {
  nome: string;
  diagnosticar: (mundo: Mundo, dto: MundoDTO, opts: ReconciliarOpts) => Diagnostico[];
}

/** Main entry point — run all healers and return their diagnostics. */
export function reconciliarMundo(
  mundo: Mundo,
  dto: MundoDTO,
  opts: ReconciliarOpts = {},
): Diagnostico[] {
  const todos: Diagnostico[] = [];

  if (opts.transformsAplicados && opts.transformsAplicados.length > 0) {
    for (const label of opts.transformsAplicados) {
      todos.push({ severidade: 'info', categoria: 'migration', detalhe: label });
    }
  }

  for (const h of HEALERS) {
    try {
      todos.push(...h.diagnosticar(mundo, dto, opts));
    } catch (err) {
      console.error(`[reconciler] healer "${h.nome}" falhou:`, err);
      todos.push({
        severidade: 'erro',
        categoria: h.nome,
        detalhe: `healer crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return todos;
}

/** Short human-friendly summary for a toast. */
export function resumirDiagnosticos(lista: readonly Diagnostico[]): string | null {
  if (lista.length === 0) return null;
  const erros = lista.filter((d) => d.severidade === 'erro').length;
  const warns = lista.filter((d) => d.severidade === 'warn').length;
  const infos = lista.filter((d) => d.severidade === 'info').length;
  const partes: string[] = [];
  if (erros > 0) partes.push(`${erros} erro(s)`);
  if (warns > 0) partes.push(`${warns} ajuste(s)`);
  if (infos > 0) partes.push(`${infos} auto-fix`);
  return `Save reconciliado: ${partes.join(', ')}`;
}

// ─── Helpers ────────────────────────────────────────────────────────

function isValidNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeNumber(n: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  if (!isValidNumber(n)) return fallback;
  return clamp(n, lo, hi);
}

const ESTADOS_NAVE_VALIDOS = new Set<Nave['estado']>([
  'orbitando', 'viajando', 'parado', 'fazendo_survey', 'aguardando_decisao', 'pilotando',
]);

const ARQUETIPOS_VALIDOS: Arquetipo[] = ['warlord', 'trader', 'scientist', 'defender', 'explorer'];
const DIFICULDADES_VALIDAS: Dificuldade[] = ['pacifico', 'facil', 'normal', 'dificil', 'brutal', 'infernal'];
const NAVES_FAVORITAS = new Set(['fragata', 'torreta', 'batedora', 'cargueira']);
const GAMESPEED_VALIDOS = new Set([0, 0.5, 1, 2, 4]);

// ─── Healers: mundo top-level ────────────────────────────────────────

const healMundoHeader: Healer = {
  nome: 'mundo-header',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    if (!isValidNumber(mundo.tamanho) || mundo.tamanho <= 0) {
      out.push({
        severidade: 'warn',
        categoria: 'mundo-tamanho-invalido',
        detalhe: `tamanho=${mundo.tamanho} substituído por 10000`,
      });
      mundo.tamanho = 10000;
    }
    if (!isValidNumber(mundo.seedMusical)) {
      mundo.seedMusical = Math.floor(Math.random() * 0xffffffff);
      out.push({
        severidade: 'info',
        categoria: 'seed-musical-faltando',
        detalhe: 'gerou novo seed musical',
      });
    }
    // fontesVisao might contain bad entries — drop any non-object or NaN.
    if (Array.isArray(mundo.fontesVisao)) {
      const antes = mundo.fontesVisao.length;
      mundo.fontesVisao = mundo.fontesVisao.filter(
        (f) => f && isValidNumber(f.x) && isValidNumber(f.y) && isValidNumber(f.raio) && f.raio > 0,
      );
      if (mundo.fontesVisao.length !== antes) {
        out.push({
          severidade: 'warn',
          categoria: 'fontesVisao-inválidas',
          detalhe: `removeu ${antes - mundo.fontesVisao.length} fonte(s) de visão corrompida(s)`,
        });
      }
    } else {
      mundo.fontesVisao = [];
    }
    return out;
  },
};

const healDto: Healer = {
  nome: 'dto-header',
  diagnosticar(_mundo, dto) {
    const out: Diagnostico[] = [];
    // dificuldade enum check
    if (dto.dificuldade && !DIFICULDADES_VALIDAS.includes(dto.dificuldade)) {
      out.push({
        severidade: 'warn',
        categoria: 'dificuldade-invalida',
        detalhe: `dificuldade "${dto.dificuldade}" desconhecida, usando normal`,
      });
      dto.dificuldade = 'normal';
    }
    // camera fields
    if (dto.camera) {
      const c = dto.camera;
      if (!isValidNumber(c.x) || !isValidNumber(c.y) || !isValidNumber(c.zoom)) {
        out.push({
          severidade: 'warn',
          categoria: 'camera-invalida',
          detalhe: 'valores de câmera inválidos, descartados',
        });
        dto.camera = undefined;
      } else {
        c.zoom = clamp(c.zoom, 0.3, 2.0);
      }
    }
    // gameSpeed
    if (typeof dto.gameSpeed === 'number' && !GAMESPEED_VALIDOS.has(dto.gameSpeed)) {
      out.push({
        severidade: 'info',
        categoria: 'gameSpeed-invalido',
        detalhe: `gameSpeed=${dto.gameSpeed} coerced pra 1`,
      });
      dto.gameSpeed = 1;
    }
    // tempoJogadoMs
    if (!isValidNumber(dto.tempoJogadoMs) || dto.tempoJogadoMs < 0) {
      out.push({
        severidade: 'info',
        categoria: 'tempoJogado-invalido',
        detalhe: 'tempoJogadoMs resetado pra 0',
      });
      dto.tempoJogadoMs = 0;
    }
    return out;
  },
};

// ─── Healers: tipoJogador ────────────────────────────────────────────

const healTipoJogador: Healer = {
  nome: 'tipo-jogador',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    const tj = mundo.tipoJogador as any;
    if (!tj || typeof tj !== 'object') {
      mundo.tipoJogador = { nome: 'Jogador', desc: '', cor: 0x44aaff, bonus: {} } as any;
      out.push({
        severidade: 'warn',
        categoria: 'tipoJogador-ausente',
        detalhe: 'tipoJogador faltando, usando padrão',
      });
      return out;
    }
    if (typeof tj.nome !== 'string') tj.nome = 'Jogador';
    if (typeof tj.desc !== 'string') tj.desc = '';
    if (!isValidNumber(tj.cor)) tj.cor = 0x44aaff;
    if (!tj.bonus || typeof tj.bonus !== 'object') tj.bonus = {};
    return out;
  },
};

// ─── Healers: personalidades ─────────────────────────────────────────

const healLoreFaltando: Healer = {
  nome: 'lore-faltando',
  diagnosticar(_mundo, _dto) {
    const out: Diagnostico[] = [];
    for (const ia of getPersonalidades()) {
      if (!ia.lore) {
        (ia as any).lore = gerarLoreFaccao(ia.id, ia.arquetipo);
        out.push({
          severidade: 'info',
          categoria: 'lore-faltando',
          detalhe: `gerou lore pra ${ia.nome}`,
          entidade: ia.id,
        });
      }
    }
    return out;
  },
};

/**
 * Validate every field on each PersonalidadeIA — archetype, weights,
 * favorite ship, forca, fleet params. Clamp or default anything off.
 */
const healPersonalidadeCampos: Healer = {
  nome: 'personalidade-campos',
  diagnosticar(_mundo, _dto) {
    const out: Diagnostico[] = [];
    const ias = getPersonalidades() as PersonalidadeIA[];
    const PESOS_CHAVES = ['agressao', 'expansao', 'economia', 'ciencia', 'defesa', 'vinganca'] as const;
    for (const ia of ias) {
      if (!ARQUETIPOS_VALIDOS.includes(ia.arquetipo)) {
        out.push({
          severidade: 'warn',
          categoria: 'personalidade-arquetipo-invalido',
          detalhe: `arquétipo "${ia.arquetipo}" desconhecido em ${ia.id}, usando warlord`,
          entidade: ia.id,
        });
        (ia as any).arquetipo = 'warlord';
      }
      if (!NAVES_FAVORITAS.has(ia.naveFavorita)) {
        (ia as any).naveFavorita = 'fragata';
        out.push({
          severidade: 'info',
          categoria: 'personalidade-nave-favorita',
          detalhe: `${ia.id} naveFavorita coerced pra fragata`,
          entidade: ia.id,
        });
      }
      const pesos = ia.pesos as any;
      if (!pesos || typeof pesos !== 'object') {
        (ia as any).pesos = { agressao: 1, expansao: 1, economia: 1, ciencia: 1, defesa: 1, vinganca: 1 };
        out.push({
          severidade: 'warn',
          categoria: 'personalidade-pesos-ausentes',
          detalhe: `${ia.id} pesos ausentes, defaults aplicados`,
          entidade: ia.id,
        });
      } else {
        for (const k of PESOS_CHAVES) {
          if (!isValidNumber(pesos[k])) pesos[k] = 1;
          else if (pesos[k] < 0) pesos[k] = 0;
        }
      }
      if (!isValidNumber(ia.forca) || ia.forca <= 0) (ia as any).forca = 1;
      if (!isValidNumber(ia.frotaMinAtaque) || ia.frotaMinAtaque < 1) (ia as any).frotaMinAtaque = 4;
      if (!isValidNumber(ia.paciencia) || ia.paciencia < 0) (ia as any).paciencia = 2;
      if (!isValidNumber(ia.frotaMax) || ia.frotaMax < 1) (ia as any).frotaMax = 20;
      if (!isValidNumber(ia.cor)) (ia as any).cor = 0xff5555;
    }
    return out;
  },
};

const healPersonalidadeOrfa: Healer = {
  nome: 'personalidade-orfa-do-dono',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    const ias = getPersonalidades();
    const existentes = new Set(ias.map((i) => i.id));
    const donosAtivos = new Set<string>();
    for (const p of mundo.planetas) if (p.dados.dono.startsWith('inimigo')) donosAtivos.add(p.dados.dono);
    for (const n of mundo.naves) if (n.dono.startsWith('inimigo')) donosAtivos.add(n.dono);

    const faltando = [...donosAtivos].filter((d) => !existentes.has(d));
    if (faltando.length === 0) return out;

    const dificuldade = getDificuldadeAtual();
    const cfg = PRESETS_DIFICULDADE[dificuldade];
    const coresUsadas = new Set(ias.map((i) => i.cor));
    const novas: PersonalidadeIA[] = [];
    for (const id of faltando) {
      const nova = gerarPersonalidade(id, cfg.forca || 1, coresUsadas);
      novas.push(nova);
      out.push({
        severidade: 'warn',
        categoria: 'personalidade-orfa-do-dono',
        detalhe: `regenerou personalidade pra ${id} (${nova.nome})`,
        entidade: id,
      });
    }
    if (novas.length > 0) setPersonalidadesParaMundoCarregado([...ias, ...novas], cfg.tickMs);
    return out;
  },
};

// ─── Healers: naves ──────────────────────────────────────────────────

const healNaveCampos: Healer = {
  nome: 'nave-campos',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    for (const nave of mundo.naves) {
      // tipo / tier / hp (pre-existing healers folded in)
      if (!STATS_COMBATE[nave.tipo]) {
        out.push({
          severidade: 'warn',
          categoria: 'nave-tipo-desconhecido',
          detalhe: `nave ${nave.id} tinha tipo "${nave.tipo}", convertida em fragata`,
          entidade: nave.id,
        });
        nave.tipo = 'fragata';
        // leave tier — the block below will clamp if out of range
      }
      if (!isValidNumber(nave.tier) || nave.tier < 1 || nave.tier > TIER_MAX) {
        out.push({
          severidade: 'info',
          categoria: 'nave-tier-invalido',
          detalhe: `nave ${nave.id} tier=${nave.tier} clampado`,
          entidade: nave.id,
        });
        nave.tier = clamp(isValidNumber(nave.tier) ? nave.tier : 1, 1, TIER_MAX);
      }
      const max = getStatsCombate(nave).hp;
      if (nave.hp !== undefined && (!isValidNumber(nave.hp) || nave.hp < 0 || nave.hp > max * 1.001)) {
        out.push({
          severidade: 'info',
          categoria: 'nave-hp-invalido',
          detalhe: `nave ${nave.id} hp=${nave.hp} resetado pra ${max.toFixed(0)}`,
          entidade: nave.id,
        });
        nave.hp = max;
      }
      // estado enum
      if (!ESTADOS_NAVE_VALIDOS.has(nave.estado)) {
        out.push({
          severidade: 'warn',
          categoria: 'nave-estado-invalido',
          detalhe: `nave ${nave.id} estado="${nave.estado}" coerced pra orbitando`,
          entidade: nave.id,
        });
        nave.estado = 'orbitando';
      }
      // posição
      if (!isValidNumber(nave.x) || !isValidNumber(nave.y)) {
        nave.x = nave.origem?.x ?? 0;
        nave.y = nave.origem?.y ?? 0;
        nave.estado = 'orbitando';
        out.push({
          severidade: 'warn',
          categoria: 'nave-posicao-invalida',
          detalhe: `nave ${nave.id} teleportada pra origem`,
          entidade: nave.id,
        });
      }
      // carga / configuracaoCarga — non-negative recursos
      sanitizeRecursos(nave.carga, `nave ${nave.id}.carga`, out);
      sanitizeRecursos(nave.configuracaoCarga, `nave ${nave.id}.configuracaoCarga`, out);
      // orbita
      if (nave.orbita && (!isValidNumber(nave.orbita.raio) || !isValidNumber(nave.orbita.angulo) || !isValidNumber(nave.orbita.velocidade))) {
        nave.orbita = null;
        out.push({
          severidade: 'info',
          categoria: 'nave-orbita-invalida',
          detalhe: `nave ${nave.id} órbita descartada`,
          entidade: nave.id,
        });
      }
      // thrust — when not piloting, must be zero; clamp magnitude ≤ 1
      if (nave.thrustX !== undefined && !isValidNumber(nave.thrustX)) nave.thrustX = 0;
      if (nave.thrustY !== undefined && !isValidNumber(nave.thrustY)) nave.thrustY = 0;
      if (nave.estado !== 'pilotando') {
        nave.thrustX = undefined;
        nave.thrustY = undefined;
      }
      // survey timers
      if (nave.surveyTempoRestanteMs !== undefined && (!isValidNumber(nave.surveyTempoRestanteMs) || nave.surveyTempoRestanteMs < 0)) {
        nave.surveyTempoRestanteMs = 0;
      }
    }
    return out;
  },
};

function sanitizeRecursos(r: any, label: string, out: Diagnostico[]): void {
  if (!r || typeof r !== 'object') return;
  for (const k of ['comum', 'raro', 'combustivel']) {
    if (!isValidNumber(r[k]) || r[k] < 0) {
      out.push({
        severidade: 'info',
        categoria: 'recursos-invalidos',
        detalhe: `${label}.${k}=${r[k]} resetado pra 0`,
      });
      r[k] = 0;
    }
  }
}

// ─── Healers: planetas ───────────────────────────────────────────────

const healPlanetaCampos: Healer = {
  nome: 'planeta-campos',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    const maxSistemaId = mundo.sistemas.length - 1;
    for (const planeta of mundo.planetas) {
      const d = planeta.dados as any;

      // sistemaId out of range
      if (typeof d.sistemaId !== 'number' || d.sistemaId < 0 || d.sistemaId > maxSistemaId) {
        out.push({
          severidade: 'warn',
          categoria: 'planeta-sistema-orfao',
          detalhe: `planeta ${planeta.id} referencia sistema ${d.sistemaId}, coerced pra 0`,
          entidade: planeta.id,
        });
        d.sistemaId = 0;
      }

      // nome missing
      if (typeof d.nome !== 'string' || d.nome.length === 0) {
        d.nome = `Planeta ${planeta.id.slice(0, 6)}`;
      }

      // tipoPlaneta falsy
      if (typeof d.tipoPlaneta !== 'string' || d.tipoPlaneta.length === 0) {
        d.tipoPlaneta = 'comum';
      }

      // producao
      if (!isValidNumber(d.producao) || d.producao <= 0) d.producao = 1;

      // tamanho
      if (!isValidNumber(d.tamanho) || d.tamanho <= 0) d.tamanho = 200;

      // fabricas / infraestrutura / naves
      d.fabricas = clamp(sanitizeNumber(d.fabricas, 0), 0, TIER_MAX);
      d.infraestrutura = clamp(sanitizeNumber(d.infraestrutura, 0), 0, TIER_MAX);
      d.naves = Math.max(0, Math.floor(sanitizeNumber(d.naves, 0)));

      // acumuladorRecursosMs
      d.acumuladorRecursosMs = Math.max(0, sanitizeNumber(d.acumuladorRecursosMs, 0));

      // recursos and fracProducao
      sanitizeRecursos(d.recursos, `planeta ${planeta.id}.recursos`, out);
      sanitizeRecursos(d.fracProducao, `planeta ${planeta.id}.fracProducao`, out);

      // pesquisas — add missing categories, clamp existing arrays. We
      // report a diagnostic only if the planet actually had a pesquisas
      // dict that was *partially* populated; a brand-new world starts
      // with an empty dict and shouldn't trigger a noisy log.
      if (!d.pesquisas || typeof d.pesquisas !== 'object') d.pesquisas = {};
      const tinhaChaves = Object.keys(d.pesquisas).length > 0;
      let chavesAdicionadas = 0;
      for (const categoria of CATEGORIAS_PESQUISA) {
        if (!Array.isArray(d.pesquisas[categoria])) {
          d.pesquisas[categoria] = [];
          chavesAdicionadas++;
        }
        // Clamp array to TIER_MAX length
        if (d.pesquisas[categoria].length > TIER_MAX) {
          d.pesquisas[categoria].length = TIER_MAX;
        }
      }
      if (tinhaChaves && chavesAdicionadas > 0) {
        out.push({
          severidade: 'info',
          categoria: 'pesquisas-incompletas',
          detalhe: `${planeta.id}: inicializou ${chavesAdicionadas} categoria(s) nova(s) de pesquisa`,
          entidade: planeta.id,
        });
      }
      // Drop unknown categories silently (preserve forward-compat if
      // we re-add them later — the serializer would lose them anyway)
      for (const k of Object.keys(d.pesquisas)) {
        if (!CATEGORIAS_PESQUISA.includes(k) && Array.isArray(d.pesquisas[k]) && d.pesquisas[k].length === 0) {
          delete d.pesquisas[k];
        }
      }

      // pesquisaAtual
      if (d.pesquisaAtual) {
        const pa = d.pesquisaAtual;
        if (!CATEGORIAS_PESQUISA.includes(pa.categoria) || !isValidNumber(pa.tier) || pa.tier < 1 || pa.tier > TIER_MAX) {
          out.push({
            severidade: 'warn',
            categoria: 'planeta-pesquisa-invalida',
            detalhe: `${planeta.id} pesquisaAtual descartada`,
            entidade: planeta.id,
          });
          d.pesquisaAtual = null;
        } else if (!isValidNumber(pa.tempoRestanteMs) || pa.tempoRestanteMs < 0) {
          pa.tempoRestanteMs = Math.max(0, sanitizeNumber(pa.tempoTotalMs, 60_000));
        }
      }

      // construcaoAtual / producaoNave timers
      for (const key of ['construcaoAtual', 'producaoNave'] as const) {
        const c = d[key];
        if (c) {
          if (!isValidNumber(c.tempoRestanteMs) || c.tempoRestanteMs < 0) c.tempoRestanteMs = 0;
          if (!isValidNumber(c.tempoTotalMs) || c.tempoTotalMs <= 0) c.tempoTotalMs = 60_000;
        }
      }

      // filaProducao — drop non-object entries
      if (Array.isArray(d.filaProducao)) {
        const antes = d.filaProducao.length;
        d.filaProducao = d.filaProducao.filter((i: any) => i && typeof i.acao === 'string');
        if (antes !== d.filaProducao.length) {
          out.push({
            severidade: 'info',
            categoria: 'planeta-fila-corrompida',
            detalhe: `${planeta.id} filaProducao removeu ${antes - d.filaProducao.length} entrada(s) inválida(s)`,
            entidade: planeta.id,
          });
        }
      } else {
        d.filaProducao = [];
      }
      if (typeof d.repetirFilaProducao !== 'boolean') d.repetirFilaProducao = false;

      // orbita numeric sanity — if any field is NaN/invalid, the planet
      // will render off-screen. Fall back to a small orbit at origin.
      const orb = planeta._orbita;
      if (
        !isValidNumber(orb?.centroX) ||
        !isValidNumber(orb?.centroY) ||
        !isValidNumber(orb?.raio) ||
        !isValidNumber(orb?.angulo) ||
        !isValidNumber(orb?.velocidade)
      ) {
        planeta._orbita = { centroX: 0, centroY: 0, raio: 400, angulo: 0, velocidade: 0.0001 };
        out.push({
          severidade: 'warn',
          categoria: 'planeta-orbita-invalida',
          detalhe: `${planeta.id} órbita inválida, default aplicado`,
          entidade: planeta.id,
        });
      }
    }
    return out;
  },
};

const healPlanetaDonoOrfao: Healer = {
  nome: 'planeta-dono-orfao',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    const ids = new Set(getPersonalidades().map((i) => i.id));
    ids.add('jogador');
    ids.add('neutro');
    for (const p of mundo.planetas) {
      if (!ids.has(p.dados.dono)) {
        out.push({
          severidade: 'warn',
          categoria: 'dono-orfao',
          detalhe: `planeta ${p.id} tinha dono "${p.dados.dono}", revertido pra neutro`,
          entidade: p.id,
        });
        p.dados.dono = 'neutro';
      }
    }
    for (const n of mundo.naves) {
      if (!ids.has(n.dono)) {
        out.push({
          severidade: 'warn',
          categoria: 'dono-orfao',
          detalhe: `nave ${n.id} tinha dono "${n.dono}", revertido pra neutro`,
          entidade: n.id,
        });
        n.dono = 'neutro';
      }
    }
    return out;
  },
};

// ─── Healers: IA memória ─────────────────────────────────────────────

/**
 * Sanitize the in-memory AI memory state. Caps rancor/forcaPercebida at
 * sane bounds, dedupes planetasVistos (reconstruction already converts
 * arrays to Sets, but a malformed save could have contained NaN entries).
 */
const healIaMemoria: Healer = {
  nome: 'ia-memoria',
  diagnosticar(_mundo, _dto) {
    const out: Diagnostico[] = [];
    const current = getMemoriasIaSerializadas();
    const ids = new Set(getPersonalidades().map((i) => i.id));
    const limpos = current.filter((m) => {
      if (!ids.has(m.donoIa)) {
        out.push({
          severidade: 'info',
          categoria: 'ia-memoria-orfa',
          detalhe: `memória da IA ${m.donoIa} descartada (sem personalidade)`,
          entidade: m.donoIa,
        });
        return false;
      }
      // Sanitize values in place
      for (const k of Object.keys(m.rancor)) {
        if (!isValidNumber(m.rancor[k]) || m.rancor[k] < 0) delete m.rancor[k];
        else m.rancor[k] = clamp(m.rancor[k], 0, 1000);
      }
      for (const k of Object.keys(m.forcaPercebida)) {
        if (!isValidNumber(m.forcaPercebida[k]) || m.forcaPercebida[k] < 0) delete m.forcaPercebida[k];
        else m.forcaPercebida[k] = clamp(m.forcaPercebida[k], 0, 10000);
      }
      for (const k of Object.keys(m.ultimoAtaque)) {
        if (!isValidNumber(m.ultimoAtaque[k])) delete m.ultimoAtaque[k];
      }
      // planetasVistos dedupe + drop non-string
      m.planetasVistos = Array.from(new Set((m.planetasVistos || []).filter((p) => typeof p === 'string')));
      return true;
    });
    // Ensure every current IA has an entry (even if empty). This is
    // silent — a fresh-start world legitimately has no memory yet, and
    // we don't want to spam the toast with "initialized empty memory"
    // every time someone loads a v1 save. Only report when an existing
    // memory structure was *partially* populated and we filled a gap.
    const tinhaMemoriaPreExistente = current.length > 0;
    for (const ia of getPersonalidades()) {
      if (!limpos.some((m) => m.donoIa === ia.id)) {
        limpos.push({
          donoIa: ia.id,
          rancor: {}, forcaPercebida: {}, ultimoAtaque: {}, planetasVistos: [],
        });
        if (tinhaMemoriaPreExistente) {
          out.push({
            severidade: 'info',
            categoria: 'ia-memoria-faltando',
            detalhe: `criou entrada de memória vazia pra ${ia.id}`,
            entidade: ia.id,
          });
        }
      }
    }
    restaurarMemoriasIa(limpos);
    return out;
  },
};

// ─── Healers: sois ───────────────────────────────────────────────────

const healSolCampos: Healer = {
  nome: 'sol-campos',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    for (const sol of mundo.sois) {
      if (!isValidNumber(sol._raio) || sol._raio <= 0) {
        out.push({
          severidade: 'info',
          categoria: 'sol-raio-invalido',
          detalhe: `sol ${sol.id} raio=${sol._raio} resetado pra 200`,
          entidade: sol.id,
        });
        sol._raio = 200;
      }
      if (!isValidNumber(sol._cor)) {
        sol._cor = 0xffd166;
      }
      if (!isValidNumber(sol.x) || !isValidNumber(sol.y)) {
        sol.x = 0;
        sol.y = 0;
        out.push({
          severidade: 'warn',
          categoria: 'sol-posicao-invalida',
          detalhe: `sol ${sol.id} posição NaN, teleportado pra origem`,
          entidade: sol.id,
        });
      }
      if (typeof sol._visivelAoJogador !== 'boolean') sol._visivelAoJogador = false;
      if (typeof sol._descobertoAoJogador !== 'boolean') sol._descobertoAoJogador = false;
    }
    return out;
  },
};

// ─── Healers: sistemas ───────────────────────────────────────────────

/**
 * Systems whose planetas array has stale refs — can happen if a planet
 * was dropped by an earlier healer (e.g. converted to neutral). Trims
 * the array to match only planets that actually exist on the mundo.
 */
const healSistemasRefs: Healer = {
  nome: 'sistema-planetas-refs',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    const planetaIds = new Set(mundo.planetas.map((p) => p.id));
    for (const sis of mundo.sistemas) {
      const originalLen = sis.planetas.length;
      sis.planetas = sis.planetas.filter((p) => p && planetaIds.has(p.id));
      if (sis.planetas.length !== originalLen) {
        out.push({
          severidade: 'warn',
          categoria: 'sistema-ref-orfa',
          detalhe: `sistema ${sis.id} removeu ${originalLen - sis.planetas.length} ref(s) órfã(s)`,
          entidade: sis.id,
        });
      }
      if (!sis.sol) {
        out.push({
          severidade: 'erro',
          categoria: 'sistema-sem-sol',
          detalhe: `sistema ${sis.id} ficou sem sol`,
          entidade: sis.id,
        });
      }
    }
    return out;
  },
};

// ─── Healers: mundo vazio (unplayable) ───────────────────────────────

const healMundoVazio: Healer = {
  nome: 'mundo-vazio',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    if (mundo.planetas.length === 0) {
      out.push({
        severidade: 'erro',
        categoria: 'mundo-sem-planetas',
        detalhe: 'mundo carregado sem planetas — jogabilidade impossível',
      });
    }
    const temJogador = mundo.planetas.some((p) => p.dados.dono === 'jogador');
    if (mundo.planetas.length > 0 && !temJogador) {
      out.push({
        severidade: 'warn',
        categoria: 'jogador-sem-planeta',
        detalhe: 'nenhum planeta pertence ao jogador — derrota imediata',
      });
    }
    if (mundo.sistemas.length === 0 && mundo.planetas.length > 0) {
      out.push({
        severidade: 'erro',
        categoria: 'mundo-sem-sistemas',
        detalhe: 'planetas existem mas nenhum sistema solar — render quebrado',
      });
    }
    return out;
  },
};

// ─── Healers: selecaoUI refs ─────────────────────────────────────────

const healSelecaoUI: Healer = {
  nome: 'selecaoUI',
  diagnosticar(mundo, dto) {
    const out: Diagnostico[] = [];
    if (!dto.selecaoUI) return out;
    if (dto.selecaoUI.planetaId) {
      const exists = mundo.planetas.some((p) => p.id === dto.selecaoUI!.planetaId);
      if (!exists) {
        out.push({
          severidade: 'info',
          categoria: 'selecao-planeta-orfa',
          detalhe: `seleção de planeta "${dto.selecaoUI.planetaId}" descartada`,
        });
        dto.selecaoUI.planetaId = undefined;
      }
    }
    if (dto.selecaoUI.naveId) {
      const exists = mundo.naves.some((n) => n.id === dto.selecaoUI!.naveId);
      if (!exists) {
        out.push({
          severidade: 'info',
          categoria: 'selecao-nave-orfa',
          detalhe: `seleção de nave "${dto.selecaoUI.naveId}" descartada`,
        });
        dto.selecaoUI.naveId = undefined;
      }
    }
    return out;
  },
};

// ─── Healers: rotaCargueira ──────────────────────────────────────────

const healRotaCargueira: Healer = {
  nome: 'rotaCargueira',
  diagnosticar(mundo, _dto) {
    const out: Diagnostico[] = [];
    const planetaIds = new Set(mundo.planetas.map((p) => p.id));
    for (const nave of mundo.naves) {
      const rc = nave.rotaCargueira;
      if (!rc) continue;
      if (rc.fase !== 'origem' && rc.fase !== 'destino') {
        out.push({
          severidade: 'info',
          categoria: 'rotaCargueira-fase',
          detalhe: `nave ${nave.id} fase inválida, coerced pra origem`,
          entidade: nave.id,
        });
        rc.fase = 'origem';
      }
      // Orphan origem or destino — drop the reference, leaving the route
      // incomplete (player can re-assign). Fully-null rotaCargueira is
      // valid (freshly-assigned but no route yet).
      if (rc.origem && !planetaIds.has(rc.origem.id)) {
        out.push({
          severidade: 'info',
          categoria: 'rotaCargueira-origem-orfa',
          detalhe: `nave ${nave.id} origem órfã removida`,
          entidade: nave.id,
        });
        rc.origem = null;
      }
      if (rc.destino && !planetaIds.has(rc.destino.id)) {
        out.push({
          severidade: 'info',
          categoria: 'rotaCargueira-destino-orfa',
          detalhe: `nave ${nave.id} destino órfã removido`,
          entidade: nave.id,
        });
        rc.destino = null;
      }
      if (typeof rc.loop !== 'boolean') rc.loop = false;
    }
    return out;
  },
};

// ─── Healers: memória fog-of-war ─────────────────────────────────────

/**
 * Validates the snapshot captured for each planet's fog memory. If any
 * field is malformed we simply clear the memory (the planet appears
 * undiscovered until the player sees it again) — safer than rendering
 * with NaN coordinates.
 */
const healMemoriaPlaneta: Healer = {
  nome: 'memoria-planeta',
  diagnosticar(_mundo, dto) {
    const out: Diagnostico[] = [];
    for (const p of dto.planetas) {
      const m = p.memoria;
      if (!m) continue;
      const bad =
        !isValidNumber(m.snapshotX) ||
        !isValidNumber(m.snapshotY) ||
        !isValidNumber(m.idadeMs) ||
        m.idadeMs < 0 ||
        !m.dados ||
        typeof m.dados.dono !== 'string';
      if (bad) {
        out.push({
          severidade: 'info',
          categoria: 'memoria-planeta-corrompida',
          detalhe: `memória fog de ${p.id} descartada (dados inválidos)`,
          entidade: p.id,
        });
        p.memoria = null;
        continue;
      }
      // Sanitize numeric fields inside dados
      const d = m.dados as any;
      for (const k of ['tamanho', 'fabricas', 'infraestrutura', 'naves', 'producao']) {
        if (!isValidNumber(d[k]) || d[k] < 0) d[k] = 0;
      }
    }
    return out;
  },
};

// ─── Healers: personalidade cor-duplicada ────────────────────────────

/**
 * After all personality healers fire, check for color collisions — two
 * personalities with the same `cor` make the HUD ambiguous. Reassigns
 * the latecomer to a fresh HSL color.
 */
const healPersonalidadeCorDuplicada: Healer = {
  nome: 'personalidade-cor-duplicada',
  diagnosticar(_mundo, _dto) {
    const out: Diagnostico[] = [];
    const ias = getPersonalidades() as PersonalidadeIA[];
    const vistas = new Set<number>();
    for (const ia of ias) {
      if (vistas.has(ia.cor)) {
        const nova = gerarCorHSL();
        out.push({
          severidade: 'info',
          categoria: 'personalidade-cor-colidiu',
          detalhe: `${ia.id} cor duplicada, trocada`,
          entidade: ia.id,
        });
        (ia as any).cor = nova;
      }
      vistas.add(ia.cor);
    }
    return out;
  },
};

function gerarCorHSL(): number {
  const h = Math.floor(Math.random() * 360);
  const s = 70 + Math.random() * 25;
  const l = 60 + Math.random() * 15;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s / 100 * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

// ─── Healers: histórico cap sanity (eventos/stats/battles/etc) ──────

/**
 * The history modules already cap themselves via .slice(-N) on restore,
 * so this healer is mostly defensive — reports if the DTO had more
 * entries than the cap. The DTO blob is mutated to reflect the trim.
 */
const healHistoricoCaps: Healer = {
  nome: 'historico-caps',
  diagnosticar(_mundo, dto) {
    const out: Diagnostico[] = [];
    const check = <T>(arr: T[] | undefined, cap: number, nome: string): void => {
      if (!Array.isArray(arr)) return;
      if (arr.length > cap) {
        out.push({
          severidade: 'info',
          categoria: `historico-${nome}-cap`,
          detalhe: `${nome}: truncou ${arr.length - cap} entradas antigas`,
        });
        arr.splice(0, arr.length - cap);
      }
    };
    check(dto.eventosHistorico, 200, 'eventos');
    check(dto.statsAmostragem, 100, 'stats');
    check(dto.battleHistory, 50, 'battles');
    // procNamesUsados: dedupe
    if (Array.isArray(dto.procNamesUsados)) {
      const set = new Set(dto.procNamesUsados.filter((n) => typeof n === 'string'));
      if (set.size !== dto.procNamesUsados.length) {
        out.push({
          severidade: 'info',
          categoria: 'procnames-dedupe',
          detalhe: `procNamesUsados: ${dto.procNamesUsados.length - set.size} duplicatas removidas`,
        });
        dto.procNamesUsados = Array.from(set);
      }
    }
    // firstContact: drop non-number values
    if (dto.firstContact) {
      for (const k of Object.keys(dto.firstContact)) {
        if (!isValidNumber(dto.firstContact[k]) || dto.firstContact[k] < 0) {
          delete dto.firstContact[k];
        }
      }
    }
    return out;
  },
};

// ─── Healers: legacy version-specific fixups ─────────────────────────

/**
 * Healers that fire only when the save came from a specific older
 * version. Keeps version-aware repair grouped in one place rather than
 * scattered among other healers.
 */
const healLegacyVersion: Healer = {
  nome: 'legacy-version',
  diagnosticar(_mundo, dto, opts) {
    const out: Diagnostico[] = [];
    if (opts.versaoOriginal === undefined || opts.versaoOriginal >= 2) return out;

    // v1 saves never had personalidadesIa with lore — the lore-faltando
    // healer already regenerates those. But the DTO itself also loses
    // transient runtime fields (iaMemoria, events, stats). Annotate.
    out.push({
      severidade: 'info',
      categoria: 'legacy-v1',
      detalhe: 'save legado v1 detectado — memória de IA, histórico e stats começam vazios',
    });

    // v1 saves sometimes had personalidadesIa missing entirely. If so,
    // restaurarOuReinicializarIas already regenerated — nothing to do here.
    if (!dto.personalidadesIa || dto.personalidadesIa.length === 0) {
      out.push({
        severidade: 'info',
        categoria: 'legacy-v1-personalidades',
        detalhe: 'v1 sem personalidades — foram regeneradas na carga',
      });
    }

    return out;
  },
};

// ─── Registry ────────────────────────────────────────────────────────

/**
 * Order matters.
 *  - Header/DTO fixes run first so later healers read sane values.
 *  - Personality orphan fix runs BEFORE dono-orfao so regenerated
 *    personalities are visible when the orphan-revert pass runs.
 *  - Memory healer runs after personalities so it can sync entries.
 */
const HEALERS: Healer[] = [
  healLegacyVersion,
  healMundoHeader,
  healMundoVazio,
  healDto,
  healTipoJogador,
  healSolCampos,
  healLoreFaltando,
  healPersonalidadeCampos,
  healPersonalidadeOrfa,
  healPersonalidadeCorDuplicada,
  healNaveCampos,
  healRotaCargueira,
  healPlanetaCampos,
  healMemoriaPlaneta,
  healPlanetaDonoOrfao,
  healSistemasRefs,
  healSelecaoUI,
  healIaMemoria,
  healHistoricoCaps,
];
