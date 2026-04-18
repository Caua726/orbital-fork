import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Sol, Planeta, Sistema, Nave, FonteVisao } from '../../types';
import type { MundoDTO, SolDTO, PlanetaDTO, NaveDTO, AlvoDTO } from './dto';
import { criarMundoVazio, aplicarZOrderMundo, type MundoVazio } from '../mundo';
import { criarEstrelaProcedural, criarPlanetaProceduralSprite } from '../planeta-procedural';
import { criarMemoriaVisualPlaneta, restaurarMemoriaPlaneta } from '../nevoa';
import { resetarNomesPlanetas } from '../nomes';
import { instalarTrail } from '../engine-trails';
import { restaurarMemoriasIa, resetMemoriasIa } from '../ia-memoria';
import { restaurarEventos, resetEventos } from '../eventos';
import { restaurarStats, resetStats } from '../stats';
import { restaurarBattles, resetBattles } from '../battle-log';
import { restaurarFirstContact, resetFirstContact } from '../first-contact';
import { restaurarLastSeen, resetLastSeen } from '../last-seen';
import { restaurarNomesUsados, resetNomesUsados } from '../proc-names';
// setIaTickState is intentionally NOT imported here — restoring tick
// state is the main.ts load orchestrator's job (after AI re-init).
import { buildDistanceMatrix } from '../distance-matrix';

export interface ReconstruirFactories {
  criarSol: (x: number, y: number, raio: number) => Sol;
  criarPlaneta: (x: number, y: number, tamanho: number, tipo: string) => Planeta;
  /**
   * When true, skip Pixi-dependent visual reconstruction (fog-of-war
   * memory visuals, stage mounting). Tests pass this to run without a
   * real renderer.
   */
  skipVisuals?: boolean;
}

const defaultFactories: ReconstruirFactories = {
  criarSol: (x, y, raio) => criarEstrelaProcedural(x, y, raio) as unknown as Sol,
  criarPlaneta: (x, y, tamanho, tipo) =>
    criarPlanetaProceduralSprite(x, y, tamanho, tipo) as unknown as Planeta,
};

/** Async fase callback — same signature as criarMundo's onFase. */
export type FaseLoadCallback = (label: string) => Promise<void>;
const noopLoadFase: FaseLoadCallback = async () => {};

export async function reconstruirMundo(
  dto: MundoDTO,
  app: Application,
  factories: ReconstruirFactories = defaultFactories,
  onFase: FaseLoadCallback = noopLoadFase,
): Promise<Mundo> {
  await onFase('Lendo arquivo do mundo');
  resetarNomesPlanetas();

  const mv = criarMundoVazio(dto.tamanho);

  // 1. Reconstruct sois first — they hold the system centers planets
  //    orbit around.
  await onFase('Reacendendo estrelas');
  const solsById = new Map<string, Sol>();
  for (const solDto of dto.sois) {
    const sol = reconstruirSol(solDto, factories);
    solsById.set(sol.id, sol);
    mv.container.addChild(sol);
  }

  // 2. Reconstruct planetas — position is derived from the saved orbit
  //    (centro + angulo + raio) so we don't need to persist x/y.
  await onFase('Restaurando planetas');
  const planetasById = new Map<string, Planeta>();
  for (const planetaDto of dto.planetas) {
    const planeta = reconstruirPlaneta(planetaDto, factories, mv);
    planetasById.set(planeta.id, planeta);
    mv.container.addChild(planeta);
  }

  // 3. Stack the overlay containers (orbits, fleets, ships, routes, fog,
  //    memory) on top of the sol/planet meshes we just added.
  aplicarZOrderMundo(mv);

  // 4. Reconstruct sistemas, resolving sol/planeta references by id.
  const sistemas: Sistema[] = dto.sistemas.map((sistemaDto) => {
    const sol = solsById.get(sistemaDto.solId);
    if (!sol) {
      throw new Error(`Save corrompido: sistema ${sistemaDto.id} referencia sol inexistente ${sistemaDto.solId}`);
    }
    const planetas = sistemaDto.planetaIds.map((pid) => {
      const p = planetasById.get(pid);
      if (!p) {
        throw new Error(`Save corrompido: sistema ${sistemaDto.id} referencia planeta inexistente ${pid}`);
      }
      return p;
    });
    return { id: sistemaDto.id, x: sistemaDto.x, y: sistemaDto.y, sol, planetas };
  });

  // Reassign dados.sistemaId to match the new array index, since the
  // serializer sorts by string id (lexicographic) which differs from
  // the original numeric creation order for indices >= 10.
  for (let i = 0; i < sistemas.length; i++) {
    for (const p of sistemas[i].planetas) {
      p.dados.sistemaId = i;
    }
  }

  const planetas = Array.from(planetasById.values());
  const sois = Array.from(solsById.values());

  // 4.5 Re-link sistemas
  await onFase('Reconectando sistemas estelares');

  // 5. Reconstruct naves
  await onFase(`Restaurando ${dto.naves.length} naves em órbita`);
  const naves: Nave[] = [];
  for (const naveDto of dto.naves) {
    const nave = reconstruirNave(naveDto, planetasById, solsById);
    naves.push(nave);
    if (!factories.skipVisuals) {
      mv.navesContainer.addChild(nave.gfx);
      mv.rotasContainer.addChild(nave.rotaGfx);
      // Engine trail rendered behind the (placeholder) sprite.
      instalarTrail(nave);
    }
  }

  // 6. Assemble the Mundo.
  const mundo: Mundo = {
    container: mv.container,
    tamanho: mv.tamanho,
    planetas,
    sistemas,
    sois,
    naves,
    fundo: mv.fundo,
    frotas: [] as unknown[],
    frotasContainer: mv.frotasContainer,
    navesContainer: mv.navesContainer,
    rotasContainer: mv.rotasContainer,
    tipoJogador: dto.tipoJogador,
    ultimoTickMs: performance.now(),
    visaoContainer: mv.visaoContainer,
    orbitasContainer: mv.orbitasContainer,
    memoriaPlanetasContainer: mv.memoriaPlanetasContainer,
    fontesVisao: dto.fontesVisao.map((f: FonteVisao) => ({ ...f })),
    // Fresh soundtrack on every load — the saved seedMusical is
    // deliberately ignored so the player hears new procedural music
    // each time they return to a world. The new seed is written back
    // on the next save, so subsequent loads roll again from there.
    seedMusical: Math.floor(Math.random() * 0xFFFFFFFF),
    galaxySeed: dto.galaxySeed ?? Math.floor(Math.random() * 0xFFFFFFFF),
  } as Mundo;

  // 7. Rebuild fog-of-war memory visuals and restore captured snapshots.
  //    Tests flip skipVisuals so they don't need a real Pixi renderer.
  if (!factories.skipVisuals) {
    await onFase('Recuperando névoa de guerra');
    for (const planeta of planetas) {
      criarMemoriaVisualPlaneta(mundo, planeta);
      const dtoRef = dto.planetas.find((p) => p.id === planeta.id);
      if (!dtoRef?.memoria) continue;
      const m = dtoRef.memoria;
      restaurarMemoriaPlaneta(planeta, {
        conhecida: m.conhecida,
        x: m.snapshotX,
        y: m.snapshotY,
        // Rebase the absolute save-time timestamp onto the current
        // performance.now() clock so "X minutes ago" labels stay correct.
        timestamp: performance.now() - m.idadeMs,
        dados: { ...m.dados },
      });
    }
  }

  await onFase('Restaurando memórias das facções');
  restaurarEstadoGlobalDoSave(dto);
  // Note: iaTickState is intentionally NOT restored here — the caller
  // (main.ts) calls restaurarOuReinicializarIas next, which invokes
  // setPersonalidadesParaMundoCarregado → resetIasV2(), zeroing the tick
  // accumulator. setIaTickState must be called AFTER that handshake.

  // Rebuild the planet-to-planet distance cache so post-load AI decisions
  // don't eat a cold Math.hypot storm on their first tick.
  buildDistanceMatrix(mundo);

  await onFase('Mundo carregado');
  return mundo;
}

/**
 * Restore all module-scoped state (AI memory, events, stats, etc.) from
 * the save. Caller must have already rebuilt the Mundo struct — this
 * step only touches in-process state of other modules.
 */
function restaurarEstadoGlobalDoSave(dto: MundoDTO): void {
  if (dto.iaMemoria) restaurarMemoriasIa(dto.iaMemoria);
  else resetMemoriasIa();

  if (dto.eventosHistorico) restaurarEventos(dto.eventosHistorico);
  else resetEventos();

  if (dto.statsAmostragem) restaurarStats(dto.statsAmostragem);
  else resetStats();

  if (dto.battleHistory) restaurarBattles(dto.battleHistory);
  else resetBattles();

  if (dto.firstContact) restaurarFirstContact(dto.firstContact);
  else resetFirstContact();

  if (dto.lastSeenInimigos) restaurarLastSeen(dto.lastSeenInimigos);
  else resetLastSeen();

  if (dto.procNamesUsados) restaurarNomesUsados(dto.procNamesUsados);
  else resetNomesUsados();
}

function reconstruirSol(dto: SolDTO, factories: ReconstruirFactories): Sol {
  const sol = factories.criarSol(dto.x, dto.y, dto.raio);
  sol.id = dto.id;
  sol._raio = dto.raio;
  sol._cor = dto.cor;
  sol._tipoAlvo = 'sol';
  sol._visivelAoJogador = dto.visivelAoJogador;
  sol._descobertoAoJogador = dto.descobertoAoJogador;
  sol.visible = dto.visivelAoJogador || dto.descobertoAoJogador;
  return sol;
}

function reconstruirPlaneta(
  dto: PlanetaDTO,
  factories: ReconstruirFactories,
  mv: MundoVazio,
): Planeta {
  const x = dto.orbita.centroX + Math.cos(dto.orbita.angulo) * dto.orbita.raio;
  const y = dto.orbita.centroY + Math.sin(dto.orbita.angulo) * dto.orbita.raio;
  const planeta = factories.criarPlaneta(x, y, dto.dados.tamanho, dto.dados.tipoPlaneta);
  planeta.id = dto.id;
  planeta._tipoAlvo = 'planeta';
  planeta._orbita = { ...dto.orbita };
  planeta.dados = {
    ...dto.dados,
    recursos: { ...dto.dados.recursos },
    fracProducao: { ...dto.dados.fracProducao },
    pesquisas: Object.fromEntries(
      Object.entries(dto.dados.pesquisas).map(([k, v]) => [k, [...v]]),
    ),
    filaProducao: dto.dados.filaProducao.map((i) => ({ ...i })),
    construcaoAtual: dto.dados.construcaoAtual ? { ...dto.dados.construcaoAtual } : null,
    producaoNave: dto.dados.producaoNave ? { ...dto.dados.producaoNave } : null,
    pesquisaAtual: dto.dados.pesquisaAtual ? { ...dto.dados.pesquisaAtual } : null,
    selecionado: false,
  };
  planeta._visivelAoJogador = dto.visivelAoJogador;
  planeta._descobertoAoJogador = dto.descobertoAoJogador;
  planeta.visible = dto.visivelAoJogador;

  // Recreate the Graphics children that criarSistemaSolar normally
  // attaches: the orbit ring (in orbitasContainer) and the selection
  // ring / construction overlay (children of the planeta itself).
  const linhaOrbita = new Graphics();
  linhaOrbita.visible = false;
  linhaOrbita
    .circle(dto.orbita.centroX, dto.orbita.centroY, dto.orbita.raio)
    .stroke({ color: 0xffd166, width: 2, alpha: 0.3 });
  mv.orbitasContainer.addChild(linhaOrbita);
  planeta._linhaOrbita = linhaOrbita;

  const anel = new Graphics();
  planeta.addChild(anel);
  planeta._anel = anel;

  return planeta;
}

function reconstruirNave(
  dto: NaveDTO,
  planetasById: Map<string, Planeta>,
  solsById: Map<string, Sol>,
): Nave {
  const origem = planetasById.get(dto.origemId);
  if (!origem) throw new Error(`Save corrompido: referência órfã ${dto.origemId}`);

  const alvo = resolverAlvo(dto.alvo, planetasById, solsById);

  let rotaCargueira: Nave['rotaCargueira'] = null;
  if (dto.rotaCargueira) {
    const rOrigem = dto.rotaCargueira.origemId
      ? planetasById.get(dto.rotaCargueira.origemId) ?? null
      : null;
    if (dto.rotaCargueira.origemId && !rOrigem) {
      throw new Error(`Save corrompido: referência órfã ${dto.rotaCargueira.origemId}`);
    }
    const rDestino = dto.rotaCargueira.destinoId
      ? planetasById.get(dto.rotaCargueira.destinoId) ?? null
      : null;
    if (dto.rotaCargueira.destinoId && !rDestino) {
      throw new Error(`Save corrompido: referência órfã ${dto.rotaCargueira.destinoId}`);
    }
    rotaCargueira = {
      origem: rOrigem,
      destino: rDestino,
      loop: dto.rotaCargueira.loop,
      fase: dto.rotaCargueira.fase,
    };
  }

  return {
    id: dto.id,
    tipo: dto.tipo,
    tier: dto.tier,
    dono: dto.dono,
    x: dto.x,
    y: dto.y,
    estado: dto.estado,
    alvo,
    surveyTempoRestanteMs: dto.surveyTempoRestanteMs,
    surveyTempoTotalMs: dto.surveyTempoTotalMs,
    thrustX: dto.thrustX,
    thrustY: dto.thrustY,
    selecionado: false,
    origem,
    carga: { ...dto.carga },
    configuracaoCarga: { ...dto.configuracaoCarga },
    rotaManual: dto.rotaManual.map((p) => ({ _tipoAlvo: 'ponto' as const, x: p.x, y: p.y })),
    rotaCargueira,
    gfx: new Container(),
    rotaGfx: new Graphics(),
    _tipoAlvo: 'nave',
    orbita: dto.orbita ? { ...dto.orbita } : null,
    hp: dto.hp,
    _ultimoTiroMs: dto.ultimoTiroMs,
  } as Nave;
}

function resolverAlvo(
  alvoDto: AlvoDTO | null,
  planetasById: Map<string, Planeta>,
  solsById: Map<string, Sol>,
): Nave['alvo'] {
  if (!alvoDto) return null;
  if (alvoDto.tipo === 'planeta') {
    const p = planetasById.get(alvoDto.id);
    if (!p) throw new Error(`Save corrompido: referência órfã ${alvoDto.id}`);
    return p;
  }
  if (alvoDto.tipo === 'sol') {
    const s = solsById.get(alvoDto.id);
    if (!s) throw new Error(`Save corrompido: referência órfã ${alvoDto.id}`);
    return s;
  }
  return { _tipoAlvo: 'ponto', x: alvoDto.x, y: alvoDto.y };
}
