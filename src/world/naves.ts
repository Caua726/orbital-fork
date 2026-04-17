import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Nave, Mundo, Planeta, Sol, AlvoPonto, AcaoNaveParsed, Recursos } from '../types';
import { VELOCIDADE_NAVE, VELOCIDADE_ORBITA_NAVE, TEMPO_SURVEY_MS, formatarId } from './constantes';
import { cheats } from '../ui/debug';
import { notifColonizacao, mostrarNotificacao } from '../ui/notificacao';
import { somConquista } from '../audio/som';
import { revelarSistemaCompleto } from './visao';
import { confirmarAcao } from '../ui/confirmar-acao';
import { carregarSpritesheet, getSpritesheetTexture, onSpritesheetReady } from './spritesheets';
import { t } from '../core/i18n/t';
import { instalarTrail, atualizarTrail, destruirTrail } from './engine-trails';

// ─── Spritesheet loading ────────────────────────────────────────────────────

const SHIP_SPRITE_CELL = 96;

// Row per ship type within ships.png
export const SHIP_SHEET_ROW: Record<string, number> = {
  colonizadora: 0,
  cargueira: 1,
  batedora: 2,
  torreta: 3,
};

// Display size per ship type in world pixels (base size; some ships render bigger)
const SHIP_DISPLAY_SIZE: Record<string, number> = {
  colonizadora: 48,
  cargueira: 36,
  batedora: 32,
  torreta: 32,
};

const _frameCache = new Map<string, Texture>();
// Ships created before the sheet finishes loading are queued here so we can
// swap their placeholder texture once it's ready.
const _pendingSprites: Array<{ sprite: Sprite; tipo: string; tier: number }> = [];

export function carregarSpritesheetNaves(): Promise<void> {
  return carregarSpritesheet('ships').then(() => {
    for (const { sprite, tipo, tier } of _pendingSprites) {
      sprite.texture = getShipFrame(tipo, tier);
      const displaySize = SHIP_DISPLAY_SIZE[tipo] ?? 32;
      sprite.width = displaySize;
      sprite.height = displaySize;
    }
    _pendingSprites.length = 0;
  });
}

function getShipFrame(tipo: string, tier: number): Texture {
  const sheet = getSpritesheetTexture('ships');
  if (!sheet) return Texture.EMPTY;
  const row = SHIP_SHEET_ROW[tipo] ?? 0;
  // Colonizadora has only 1 column; everything else is tier-1 = col 0..col 4.
  const col = tipo === 'colonizadora' ? 0 : Math.max(0, Math.min(4, tier - 1));
  const key = `${row},${col}`;
  const cached = _frameCache.get(key);
  if (cached) return cached;
  const frame = new Texture({
    source: sheet.source,
    frame: new Rectangle(col * SHIP_SPRITE_CELL, row * SHIP_SPRITE_CELL, SHIP_SPRITE_CELL, SHIP_SPRITE_CELL),
  });
  _frameCache.set(key, frame);
  return frame;
}

function criarShipSprite(tipo: string, tier: number): Sprite {
  const hasSheet = !!getSpritesheetTexture('ships');
  const tex = hasSheet ? getShipFrame(tipo, tier) : Texture.EMPTY;
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5);
  const displaySize = SHIP_DISPLAY_SIZE[tipo] ?? 32;
  sprite.width = displaySize;
  sprite.height = displaySize;
  if (!hasSheet) {
    _pendingSprites.push({ sprite, tipo, tier });
    // Ensure the load is in flight even if carregarSpritesheetNaves was
    // called before configurarCamera. Safe to trigger repeatedly.
    onSpritesheetReady('ships', () => {
      // no-op here; the pending-swap loop above fires inside carregar…
    });
  }
  return sprite;
}

const COR_ROTA_NAVE = 0x27465f;
const COR_PONTO_ROTA_NAVE = 0x3d6888;
const ALPHA_ROTA_NAVE = 0.85;

function criarCargaVazia(): Recursos {
  return { comum: 0, raro: 0, combustivel: 0 };
}

function totalRecursos(recursos: Recursos): number {
  return recursos.comum + recursos.raro + recursos.combustivel;
}

function obterPlanetaAlvo(nave: Nave): Planeta | null {
  return nave.alvo && nave.alvo._tipoAlvo === 'planeta' ? nave.alvo : null;
}

export function capacidadeCargaCargueira(tier: number): number {
  return 30 * (2 ** Math.max(0, tier - 1));
}

function carregarRecursosPlaneta(planeta: Planeta, capacidade: number): Recursos {
  const carga = criarCargaVazia();
  let restante = capacidade;
  for (const tipo of ['comum', 'raro', 'combustivel'] as const) {
    if (restante <= 0) break;
    const disponivel = Math.floor(planeta.dados.recursos[tipo]);
    const quantidade = Math.min(disponivel, restante);
    planeta.dados.recursos[tipo] -= quantidade;
    carga[tipo] = quantidade;
    restante -= quantidade;
  }
  return carga;
}

function descarregarRecursosPlaneta(planeta: Planeta, carga: Recursos): void {
  planeta.dados.recursos.comum += carga.comum;
  planeta.dados.recursos.raro += carga.raro;
  planeta.dados.recursos.combustivel += carga.combustivel;
}

function totalConfigurado(nave: Nave): number {
  return totalRecursos(nave.configuracaoCarga);
}

function carregarConfiguracaoOrigem(nave: Nave, planeta: Planeta): Recursos {
  const carga = criarCargaVazia();
  for (const tipo of ['comum', 'raro', 'combustivel'] as const) {
    const desejado = Math.max(0, Math.floor(nave.configuracaoCarga[tipo]));
    const disponivel = Math.floor(planeta.dados.recursos[tipo]);
    const quantidade = Math.min(desejado, disponivel);
    planeta.dados.recursos[tipo] -= quantidade;
    carga[tipo] = quantidade;
  }
  return carga;
}

export function ajustarConfiguracaoCarga(nave: Nave, tipo: keyof Recursos, delta: number): void {
  if (nave.tipo !== 'cargueira') return;
  const capacidade = capacidadeCargaCargueira(nave.tier);
  const atual = nave.configuracaoCarga[tipo];
  const totalSemTipo = totalConfigurado(nave) - atual;
  const proximo = Math.max(0, Math.min(capacidade - totalSemTipo, atual + delta));
  nave.configuracaoCarga[tipo] = proximo;
}

export function definirPlanetaRotaCargueira(nave: Nave, modo: 'origem' | 'destino', planeta: Planeta): void {
  if (nave.tipo !== 'cargueira' || planeta.dados.dono !== 'jogador') return;
  nave.rotaCargueira ??= { origem: null, destino: null, loop: false, fase: 'origem' };
  nave.rotaCargueira[modo] = planeta;
}

export function alternarLoopCargueira(nave: Nave): void {
  if (nave.tipo !== 'cargueira') return;
  nave.rotaCargueira ??= { origem: null, destino: null, loop: false, fase: 'origem' };
  nave.rotaCargueira.loop = !nave.rotaCargueira.loop;
}

function processarLoopCargueira(nave: Nave): void {
  if (nave.tipo !== 'cargueira' || nave.estado !== 'orbitando' || !nave.rotaCargueira?.loop) return;
  const planetaAtual = obterPlanetaAlvo(nave);
  const rota = nave.rotaCargueira;
  if (!planetaAtual || !rota.origem || !rota.destino) return;
  if (totalConfigurado(nave) <= 0) return;

  if (rota.fase === 'origem' && planetaAtual === rota.origem && totalRecursos(nave.carga) <= 0) {
    const carga = carregarConfiguracaoOrigem(nave, planetaAtual);
    if (totalRecursos(carga) <= 0) return;
    nave.carga = carga;
    nave.origem = planetaAtual;
    rota.fase = 'destino';
    nave.estado = 'viajando';
    nave.alvo = rota.destino;
    nave.orbita = null;
    return;
  }

  if (rota.fase === 'destino' && planetaAtual === rota.destino && totalRecursos(nave.carga) <= 0) {
    rota.fase = 'origem';
    nave.estado = 'viajando';
    nave.alvo = rota.origem;
    nave.orbita = null;
  }
}

const COR_SURVEY = 0x8ce0ff;
const COR_DECISAO = 0xffd97a;
const COR_OUTPOST = 0x60ccff;
const COR_SELECAO = 0x44aaff;

function desenharNaveGfx(nave: Nave): void {
  const ring = nave._ring;
  if (!ring) return;
  ring.clear();
  const baseRadius = (SHIP_DISPLAY_SIZE[nave.tipo] ?? 32) * 0.55;
  const now = performance.now();

  if (nave.estado === 'fazendo_survey' && nave.surveyTempoTotalMs) {
    const total = nave.surveyTempoTotalMs;
    const remaining = nave.surveyTempoRestanteMs ?? 0;
    const elapsed = total - remaining;
    const progress = 1 - remaining / total;

    // Three concentric pulses, phase-offset so the scan feels continuous.
    for (let i = 0; i < 3; i++) {
      const pulse = ((now / 520) + i / 3) % 1;
      const pulseRadius = baseRadius * (1 + pulse * 2.8);
      const pulseAlpha = (1 - pulse) * 0.55;
      ring.circle(0, 0, pulseRadius).stroke({
        color: COR_SURVEY,
        width: 1.1,
        alpha: pulseAlpha,
      });
    }

    // Rotating radar sweep line inside the outer ring.
    const sweepRadius = baseRadius * 2.4;
    const sweepAngle = (now / 700) % (Math.PI * 2);
    ring.moveTo(0, 0)
      .lineTo(Math.cos(sweepAngle) * sweepRadius, Math.sin(sweepAngle) * sweepRadius)
      .stroke({ color: COR_SURVEY, width: 1.5, alpha: 0.55 });

    // Progress ring: dim backdrop + bright arc that fills clockwise.
    const arcRadius = baseRadius * 1.8;
    ring.circle(0, 0, arcRadius).stroke({ color: COR_SURVEY, width: 1, alpha: 0.22 });
    ring.arc(0, 0, arcRadius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
      .stroke({ color: COR_SURVEY, width: 2.2, alpha: 0.95 });

    // Arrival shockwave — one-shot expanding burst for the first 500ms after
    // the ship enters survey state. Uses elapsed (not wall-clock) so it
    // survives pause/speed changes.
    if (elapsed < 500) {
      const t = elapsed / 500;
      const shockRadius = baseRadius * (1 + t * 5);
      const shockAlpha = (1 - t) * 0.9;
      ring.circle(0, 0, shockRadius).stroke({
        color: COR_SURVEY,
        width: 2.5 * (1 - t) + 0.5,
        alpha: shockAlpha,
      });
    }
  } else if (nave.estado === 'aguardando_decisao') {
    // Double ring + breath pulse.
    const breath = 0.55 + Math.sin(now / 420) * 0.3;
    ring.circle(0, 0, baseRadius * 1.8).stroke({ color: COR_DECISAO, width: 1.6, alpha: 0.9 });
    ring.circle(0, 0, baseRadius * 2.2).stroke({ color: COR_DECISAO, width: 1.1, alpha: breath });

    // Four rotating chevrons pointing inward — a clear "needs attention" cue.
    const chevronR = baseRadius * 2.7;
    const spin = now / 1400;
    const chevronSize = baseRadius * 0.45;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * Math.PI) / 2;
      const cx = Math.cos(a) * chevronR;
      const cy = Math.sin(a) * chevronR;
      // Chevron "V" pointing toward the ship (opposite of the radial direction).
      const inward = a + Math.PI;
      const leftA = inward + 0.5;
      const rightA = inward - 0.5;
      ring.moveTo(cx + Math.cos(leftA) * chevronSize, cy + Math.sin(leftA) * chevronSize)
        .lineTo(cx, cy)
        .lineTo(cx + Math.cos(rightA) * chevronSize, cy + Math.sin(rightA) * chevronSize)
        .stroke({ color: COR_DECISAO, width: 1.6, alpha: 0.85 });
    }
  } else if (nave.tipo === 'colonizadora' && nave.estado === 'orbitando' && _ehOutpost(nave)) {
    // Permanent outpost marker — dim ring with a slow beacon orbiting it.
    const r = baseRadius * 1.6;
    ring.circle(0, 0, r).stroke({ color: COR_OUTPOST, width: 1, alpha: 0.4 });
    // Beacon dot — single point rotating slowly around the marker ring.
    const beaconA = (now / 1800) % (Math.PI * 2);
    const beaconX = Math.cos(beaconA) * r;
    const beaconY = Math.sin(beaconA) * r;
    ring.circle(beaconX, beaconY, 1.8).fill({ color: COR_OUTPOST, alpha: 0.95 });
    ring.circle(beaconX, beaconY, 3.2).stroke({ color: COR_OUTPOST, width: 0.8, alpha: 0.35 });
  }

  if (nave.selecionado) {
    ring.circle(0, 0, baseRadius).stroke({ color: COR_SELECAO, width: 1.4, alpha: 0.95 });
  }
}

/**
 * A colonizadora is considered an "outpost" when it's orbiting a target that
 * isn't its origin planet — i.e. a survey concluded somewhere that couldn't
 * be colonised (star, own planet, hostile) and the ship was left parked as
 * a permanent observation post.
 */
function _ehOutpost(nave: Nave): boolean {
  if (nave.tipo !== 'colonizadora') return false;
  if (nave.estado !== 'orbitando') return false;
  if (!nave.alvo) return false;
  if (nave.alvo === nave.origem) return false;
  return true;
}

export function ehColonizadoraOutpost(nave: Nave): boolean {
  return _ehOutpost(nave);
}

function desenharRotaNave(nave: Nave): void {
  const g = nave.rotaGfx;
  g.clear();

  // Only manual waypoint routes get a visible polyline. A planet/sol target
  // is communicated through the ship's own orbit — no line or marker is
  // drawn on top (matches the game's existing minimal aesthetic where
  // ships simply enter orbit and are visible at the orbit radius).
  const pontos: AlvoPonto[] = [];
  if (nave.alvo?._tipoAlvo === 'ponto') pontos.push(nave.alvo);
  if (nave.rotaManual.length > 0) pontos.push(...nave.rotaManual);
  if (pontos.length <= 0) return;

  g.moveTo(nave.x, nave.y);
  for (const ponto of pontos) {
    g.lineTo(ponto.x, ponto.y);
  }
  g.stroke({ color: COR_ROTA_NAVE, width: 1.2, alpha: ALPHA_ROTA_NAVE });

  for (const ponto of pontos) {
    g.circle(ponto.x, ponto.y, 3.5).fill({ color: 0x08111a, alpha: 0.96 });
    g.circle(ponto.x, ponto.y, 3.5).stroke({ color: COR_PONTO_ROTA_NAVE, width: 1.1, alpha: 0.92 });
  }
}

export function atualizarSelecaoNave(nave: Nave): void {
  desenharNaveGfx(nave);
}

function obterRaioAlvo(alvo: Planeta | Sol | AlvoPonto | null): number {
  if (!alvo) return 0;
  if (alvo._tipoAlvo === 'ponto') return 16;
  if (alvo._tipoAlvo === 'sol') return alvo._raio + 45;
  return alvo.dados.tamanho / 2 + 28;
}

export function entrarEmOrbita(nave: Nave, alvo: Planeta | Sol | AlvoPonto): void {
  // Use the current approach angle so the ship doesn't teleport to a random
  // point on the orbit circle. Fixed radius (no random jitter) so repeated
  // orbit entries don't visually bounce the ship in and out.
  const raio = obterRaioAlvo(alvo) + 20;
  const dx = nave.x - alvo.x;
  const dy = nave.y - alvo.y;
  const angulo = (dx === 0 && dy === 0) ? 0 : Math.atan2(dy, dx);
  nave.estado = 'orbitando';
  nave.alvo = alvo;
  nave.orbita = {
    raio,
    angulo,
    velocidade: VELOCIDADE_ORBITA_NAVE,
  };
}

export function criarNave(mundo: Mundo, planetaOrigem: Planeta, tipo: string, tier: number = 1): Nave {
  const gfxContainer = new Container();
  const sprite = criarShipSprite(tipo, tier);
  const ring = new Graphics();
  gfxContainer.addChild(sprite, ring);

  const nave: Nave = {
    id: formatarId('nave'),
    tipo, tier,
    dono: 'jogador',
    x: planetaOrigem.x, y: planetaOrigem.y,
    estado: 'orbitando',
    alvo: planetaOrigem,
    selecionado: false,
    origem: planetaOrigem,
    carga: criarCargaVazia(),
    configuracaoCarga: criarCargaVazia(),
    rotaManual: [],
    rotaCargueira: null,
    gfx: gfxContainer,
    rotaGfx: new Graphics(),
    _tipoAlvo: 'nave',
    orbita: null,
    _sprite: sprite,
    _ring: ring,
  };
  atualizarSelecaoNave(nave);
  nave.rotaGfx.eventMode = 'none';
  mundo.rotasContainer.addChild(nave.rotaGfx);
  mundo.navesContainer.addChild(nave.gfx);
  mundo.naves.push(nave);
  entrarEmOrbita(nave, planetaOrigem);
  instalarTrail(nave);
  return nave;
}

export function removerNave(mundo: Mundo, nave: Nave): void {
  if (nave.origem?.dados && nave.tipo === 'colonizadora') {
    nave.origem.dados.naves = Math.max(0, nave.origem.dados.naves - 1);
  }
  const idx = mundo.naves.indexOf(nave);
  if (idx >= 0) mundo.naves.splice(idx, 1);
  // Also drop any pending sprite swap so the eventual spritesheet load
  // doesn't try to assign a texture on a destroyed sprite.
  const pendingIdx = _pendingSprites.findIndex((p) => p.sprite === nave._sprite);
  if (pendingIdx >= 0) _pendingSprites.splice(pendingIdx, 1);
  if (nave.rotaGfx) {
    mundo.rotasContainer.removeChild(nave.rotaGfx);
    nave.rotaGfx.destroy();
  }
  if (nave.gfx) {
    mundo.navesContainer.removeChild(nave.gfx);
    // destroy({children:true}) tears down the Container + Sprite + Graphics
    // (including the trail Graphics). The Sprite's texture is a sub-frame
    // backed by the shared sheet — we do NOT want to destroy the texture source.
    nave.gfx.destroy({ children: true });
  }
  destruirTrail(nave);
}

export function atualizarNaves(mundo: Mundo, deltaMs: number): void {
  for (let i = mundo.naves.length - 1; i >= 0; i--) {
    const nave = mundo.naves[i];
    const alvo = nave.alvo;
    if (nave.estado === 'viajando' && alvo) {
      const dx = alvo.x - nave.x;
      const dy = alvo.y - nave.y;
      const dist = Math.hypot(dx, dy);
      const stopDist = obterRaioAlvo(alvo);
      const velReal = VELOCIDADE_NAVE * (cheats.velocidadeNave ? 10 : 1);
      if (dist <= stopDist + velReal * deltaMs) {
        const proximoPontoManual = alvo._tipoAlvo === 'ponto' ? nave.rotaManual.shift() ?? null : null;
        // Colonizadora arrives at any orbit-capable target (planet or star) →
        // enter survey mode instead of colonizing / orbiting immediately.
        if (nave.tipo === 'colonizadora' && (alvo._tipoAlvo === 'planeta' || alvo._tipoAlvo === 'sol')) {
          iniciarSurveyColonizadora(mundo, nave, alvo);
          continue;
        }
        if (nave.tipo === 'cargueira' && alvo._tipoAlvo === 'planeta' && alvo.dados.dono === 'jogador' && totalRecursos(nave.carga) > 0) {
          descarregarRecursosPlaneta(alvo, nave.carga);
          mostrarNotificacao(t('notificacao.cargueira_descarregou', { n: totalRecursos(nave.carga) }), '#60ccff');
          nave.carga = criarCargaVazia();
          nave.origem = alvo;
        }
        if (alvo._tipoAlvo === 'ponto') {
          nave.x = alvo.x; nave.y = alvo.y;
          if (proximoPontoManual) {
            nave.estado = 'viajando';
            nave.alvo = proximoPontoManual;
            nave.orbita = null;
          } else {
            nave.estado = 'parado'; nave.alvo = null; nave.orbita = null;
          }
        } else {
          entrarEmOrbita(nave, alvo);
        }
      } else if (dist > 0) {
        nave.x += (dx / dist) * velReal * deltaMs;
        nave.y += (dy / dist) * velReal * deltaMs;
        // Ships in ships.png are side-profile art: rotation is meaningless,
        // but mirroring the sprite so it faces its travel direction reads
        // correctly. Keep rotation at 0 and flip scale.x based on dx.
        if (nave._sprite) {
          nave._sprite.rotation = 0;
          if (dx !== 0) nave._sprite.scale.x = dx >= 0 ? Math.abs(nave._sprite.scale.x) : -Math.abs(nave._sprite.scale.x);
        }
      }
    }
    if (nave.estado === 'orbitando' && nave.orbita && nave.alvo) {
      const prevX = nave.x;
      nave.orbita.angulo += nave.orbita.velocidade * deltaMs;
      nave.x = nave.alvo.x + Math.cos(nave.orbita.angulo) * nave.orbita.raio;
      nave.y = nave.alvo.y + Math.sin(nave.orbita.angulo) * nave.orbita.raio;
      if (nave._sprite) {
        nave._sprite.rotation = 0;
        const tdx = nave.x - prevX;
        if (tdx !== 0) nave._sprite.scale.x = tdx >= 0 ? Math.abs(nave._sprite.scale.x) : -Math.abs(nave._sprite.scale.x);
      }
    }
    if (nave.estado === 'pilotando') {
      // Real-time thrust: ship moves each frame by thrust * velocity * dt.
      // Zero thrust → ship sits stationary in space. Magnitude was clamped
      // to 1 at setNaveThrust time.
      const tx = nave.thrustX ?? 0;
      const ty = nave.thrustY ?? 0;
      if (tx !== 0 || ty !== 0) {
        const velReal = VELOCIDADE_NAVE * (cheats.velocidadeNave ? 10 : 1);
        nave.x += tx * velReal * deltaMs;
        nave.y += ty * velReal * deltaMs;
        if (nave._sprite) {
          nave._sprite.rotation = 0;
          if (tx !== 0) nave._sprite.scale.x = tx >= 0 ? Math.abs(nave._sprite.scale.x) : -Math.abs(nave._sprite.scale.x);
        }
      }
    }
    if ((nave.estado === 'fazendo_survey' || nave.estado === 'aguardando_decisao') && nave.orbita && nave.alvo) {
      // Hold a slow orbit around the target while the survey counts down.
      const prevX = nave.x;
      nave.orbita.angulo += nave.orbita.velocidade * 0.5 * deltaMs;
      nave.x = nave.alvo.x + Math.cos(nave.orbita.angulo) * nave.orbita.raio;
      nave.y = nave.alvo.y + Math.sin(nave.orbita.angulo) * nave.orbita.raio;
      if (nave._sprite) {
        nave._sprite.rotation = 0;
        const tdx = nave.x - prevX;
        if (tdx !== 0) nave._sprite.scale.x = tdx >= 0 ? Math.abs(nave._sprite.scale.x) : -Math.abs(nave._sprite.scale.x);
      }
      if (nave.estado === 'fazendo_survey') {
        nave.surveyTempoRestanteMs = Math.max(0, (nave.surveyTempoRestanteMs ?? 0) - deltaMs);
        if (nave.surveyTempoRestanteMs <= 0) {
          finalizarSurvey(mundo, nave);
          continue;
        }
      }
    }
    processarLoopCargueira(nave);
    desenharRotaNave(nave);
    // Redraw the ring/pulse every frame while the ship is in an animated
    // state (survey pulse or decision breath). Also redraw on every frame
    // for outpost colonizadoras so their dim teal ring stays visible.
    if (
      nave.estado === 'fazendo_survey'
      || nave.estado === 'aguardando_decisao'
      || (nave.tipo === 'colonizadora' && _ehOutpost(nave))
    ) {
      desenharNaveGfx(nave);
    }
    nave.gfx.x = nave.x;
    nave.gfx.y = nave.y;
    atualizarTrail(nave, deltaMs);
  }
}

function finalizarColonizacao(mundo: Mundo, nave: Nave, planeta: Planeta): void {
  planeta.dados.dono = 'jogador';
  planeta.dados.selecionado = false;
  // Starter bonus: the colonizer's hardware becomes the seed of the colony.
  // One factory, a starter stockpile, zero infra. Tematic + gives the player
  // something to work with immediately instead of a blank slate.
  if (planeta.dados.fabricas < 1) planeta.dados.fabricas = 1;
  planeta.dados.recursos.comum = Math.max(planeta.dados.recursos.comum, 20);
  planeta.dados.recursos.raro = Math.max(planeta.dados.recursos.raro, 5);
  planeta.dados.recursos.combustivel = Math.max(planeta.dados.recursos.combustivel, 5);
  removerNave(mundo, nave);
  notifColonizacao();
  somConquista();
}

function sistemaIdDoAlvo(alvo: Planeta | Sol): number | null {
  if (alvo._tipoAlvo === 'planeta') return alvo.dados.sistemaId;
  // For a star: locate its system by x/y match.
  return null;
}

function iniciarSurveyColonizadora(mundo: Mundo, nave: Nave, alvo: Planeta | Sol): void {
  // Enter a leisurely orbit around the target, then count down the survey.
  entrarEmOrbita(nave, alvo);
  nave.estado = 'fazendo_survey';
  nave.surveyTempoRestanteMs = TEMPO_SURVEY_MS;
  nave.surveyTempoTotalMs = TEMPO_SURVEY_MS;

  // Reveal the entire system immediately when survey begins — the scanning
  // pulse is visual flavor, but the intel is what the player paid for.
  let sistemaId = sistemaIdDoAlvo(alvo);
  if (sistemaId == null) {
    // Star target: find the system whose sol matches this object.
    for (let i = 0; i < mundo.sistemas.length; i++) {
      if (mundo.sistemas[i].sol === alvo) { sistemaId = i; break; }
    }
  }
  if (sistemaId != null) revelarSistemaCompleto(mundo, sistemaId);
}

function finalizarSurvey(mundo: Mundo, nave: Nave): void {
  const alvo = nave.alvo;
  nave.surveyTempoRestanteMs = undefined;
  nave.surveyTempoTotalMs = undefined;
  // If the target is a neutral habitable planet, transition to a pending-
  // decision state. The colony-modal UI polls for this state and prompts the
  // player; the ship stays in slow orbit until they choose.
  if (alvo && alvo._tipoAlvo === 'planeta' && alvo.dados.dono === 'neutro') {
    nave.estado = 'aguardando_decisao';
    return;
  }
  // Otherwise leave the colonizer parked in orbit as a permanent outpost.
  nave.estado = 'orbitando';
  mostrarNotificacao(t('notificacao.survey_sem_alvo'), '#ffcc66');
}

/**
 * Recall a colonizadora back to its origin planet. Safe to call from any
 * state — cancels survey/decision/movement cleanly and arms a new trip
 * back to origem. No-op if origem is missing (shouldn't happen).
 */
export function recolherColonizadoraParaOrigem(mundo: Mundo, nave: Nave): boolean {
  if (nave.tipo !== 'colonizadora' || !nave.origem) return false;
  // Clear any survey/decision state so we can safely redispatch.
  nave.surveyTempoRestanteMs = undefined;
  nave.surveyTempoTotalMs = undefined;
  nave.rotaManual = [];
  nave.estado = 'viajando';
  nave.alvo = nave.origem;
  nave.orbita = null;
  if (nave._ring) nave._ring.clear();
  atualizarSelecaoNave(nave);
  return true;
}

/** Scrap a colonizadora on demand (e.g. when the player gives up on a stuck outpost). */
export function sucatearNave(mundo: Mundo, nave: Nave): void {
  confirmarAcao(t('confirmar.sucatear_nave', { tipo: nave.tipo }), () => {
    removerNave(mundo, nave);
  });
}

/** Called by the colony-modal UI when the player confirms colonization. */
export function confirmarColonizacao(mundo: Mundo, nave: Nave, nomeOverride?: string): boolean {
  const alvo = nave.alvo;
  if (!alvo || alvo._tipoAlvo !== 'planeta') return false;
  if (nomeOverride && nomeOverride.trim()) {
    alvo.dados.nome = nomeOverride.trim();
  }
  finalizarColonizacao(mundo, nave, alvo);
  return true;
}

/** Called by the colony-modal UI when the player chooses to keep the outpost. */
export function manterComoOutpost(nave: Nave): void {
  nave.estado = 'orbitando';
  mostrarNotificacao(t('notificacao.colonizadora_outpost'), '#8ce0ff');
}

export function encontrarNaveNoPonto(mundoX: number, mundoY: number, mundo: Mundo): Nave | null {
  for (let i = mundo.naves.length - 1; i >= 0; i--) {
    const nave = mundo.naves[i];
    const dx = nave.x - mundoX;
    const dy = nave.y - mundoY;
    // Hit-radius scales with the ship's visual size so a 48px colonizadora
    // is as clickable as its sprite suggests, not stuck at a fixed 18px.
    const radius = Math.max(14, (SHIP_DISPLAY_SIZE[nave.tipo] ?? 32) * 0.6);
    if (dx * dx + dy * dy < radius * radius) return nave;
  }
  return null;
}

export function obterNaveSelecionada(mundo: Mundo): Nave | null {
  return mundo.naves.find((n: Nave) => n.selecionado) || null;
}

export function selecionarNave(mundo: Mundo, nave: Nave | null): void {
  // Clear any existing selection (planet or other ship) so only one entity
  // is ever selected at a time. Mirrors selecionarPlaneta in mundo.ts.
  for (const p of mundo.planetas) p.dados.selecionado = false;
  for (const outra of mundo.naves) {
    if (outra === nave) continue;
    if (outra.selecionado) {
      outra.selecionado = false;
      atualizarSelecaoNave(outra);
    }
  }
  if (nave) {
    nave.selecionado = true;
    atualizarSelecaoNave(nave);
  }
}

export function haColonizadoraRumoAoSistema(mundo: Mundo, sistemaId: number, ignorar?: Nave): boolean {
  for (const outra of mundo.naves) {
    if (outra === ignorar) continue;
    if (outra.tipo !== 'colonizadora') continue;
    // Also block while the ship is waiting for the player's decision —
    // otherwise you can queue a second colonizadora into a system whose
    // previous expedition is just sitting in the modal prompt.
    if (
      outra.estado !== 'viajando'
      && outra.estado !== 'fazendo_survey'
      && outra.estado !== 'aguardando_decisao'
    ) continue;
    const alvo = outra.alvo;
    if (!alvo) continue;
    if (alvo._tipoAlvo === 'planeta' && alvo.dados.sistemaId === sistemaId) return true;
    if (alvo._tipoAlvo === 'sol') {
      for (let i = 0; i < mundo.sistemas.length; i++) {
        if (mundo.sistemas[i].sol === alvo && i === sistemaId) return true;
      }
    }
  }
  return false;
}

export function enviarNaveParaAlvo(mundo: Mundo, nave: Nave, alvo: Planeta | Sol | AlvoPonto): boolean {
  if (!nave || !alvo) return false;
  // Guard: re-dispatching a colonizadora mid-survey / mid-decision would
  // silently abort the expedition. Require the caller to cancel first
  // (via cancelarMovimentoNave) if that's actually what they want.
  if (
    nave.tipo === 'colonizadora'
    && (nave.estado === 'fazendo_survey' || nave.estado === 'aguardando_decisao')
  ) {
    mostrarNotificacao(t('notificacao.survey_cancelar_primeiro'), '#ffcc66');
    return false;
  }
  // Cap: only one colonizadora in flight toward a given system at a time.
  if (nave.tipo === 'colonizadora' && (alvo._tipoAlvo === 'planeta' || alvo._tipoAlvo === 'sol')) {
    let targetSistema = alvo._tipoAlvo === 'planeta' ? alvo.dados.sistemaId : -1;
    if (targetSistema < 0) {
      for (let i = 0; i < mundo.sistemas.length; i++) {
        if (mundo.sistemas[i].sol === alvo) { targetSistema = i; break; }
      }
    }
    if (targetSistema >= 0 && haColonizadoraRumoAoSistema(mundo, targetSistema, nave)) {
      mostrarNotificacao(t('notificacao.ja_existe_colonizadora'), '#ffcc66');
      return false;
    }
  }
  nave.rotaManual = [];
  nave.estado = 'viajando';
  nave.alvo = alvo;
  nave.orbita = null;
  return true;
}

export function enviarNaveParaPosicao(mundo: Mundo, nave: Nave, wx: number, wy: number): boolean {
  if (!nave || nave.dono !== 'jogador') return false;
  nave.rotaManual = [];
  nave.estado = 'viajando';
  nave.alvo = { _tipoAlvo: 'ponto', x: wx, y: wy };
  nave.orbita = null;
  return true;
}

export function definirRotaManualNave(nave: Nave, pontos: AlvoPonto[]): boolean {
  if (!nave || nave.dono !== 'jogador' || pontos.length <= 0) return false;
  nave.rotaManual = pontos.map((p) => ({ _tipoAlvo: 'ponto', x: p.x, y: p.y }));
  nave.estado = 'viajando';
  nave.alvo = nave.rotaManual.shift() ?? null;
  nave.orbita = null;
  return !!nave.alvo;
}

export function cancelarMovimentoNave(nave: Nave): void {
  nave.rotaManual = [];
  nave.estado = 'parado';
  nave.alvo = null;
  nave.orbita = null;
  // Clear any ghost survey timers so a cancelled-mid-survey ship doesn't
  // carry stale fields into its next mission (or into the HUD display).
  nave.surveyTempoRestanteMs = undefined;
  nave.surveyTempoTotalMs = undefined;
  nave.thrustX = 0;
  nave.thrustY = 0;
  // Wipe the scan ring / progress arc that may still be on screen.
  if (nave._ring) nave._ring.clear();
  atualizarSelecaoNave(nave);
}

/**
 * Switch a colonizadora into real-time piloting mode. The ship stops
 * following any target/route and starts responding to thrust input each
 * frame (set via setNaveThrust). Call this once when the cockpit panel
 * first takes control; subsequent thrust updates don't need to re-call.
 */
export function iniciarPilotagem(nave: Nave): void {
  if (nave.tipo !== 'colonizadora') return;
  nave.rotaManual = [];
  nave.alvo = null;
  nave.orbita = null;
  nave.estado = 'pilotando';
  nave.thrustX = 0;
  nave.thrustY = 0;
  nave.surveyTempoRestanteMs = undefined;
  nave.surveyTempoTotalMs = undefined;
  if (nave._ring) nave._ring.clear();
  atualizarSelecaoNave(nave);
}

/**
 * Set the ship's thrust vector. Magnitude is clamped to 1 (full thrust
 * in any direction). Zero vector = stopped. Only meaningful while the
 * ship is in 'pilotando' state.
 */
export function setNaveThrust(nave: Nave, tx: number, ty: number): void {
  const mag = Math.hypot(tx, ty);
  if (mag > 1) {
    tx /= mag;
    ty /= mag;
  }
  nave.thrustX = tx;
  nave.thrustY = ty;
}

export function parseAcaoNave(acao: string): AcaoNaveParsed | null {
  if (acao === 'nave_colonizadora') return { tipo: 'colonizadora', tier: 1 };
  const m = acao.match(/^nave_(cargueira|batedora|torreta)_([1-5])$/);
  if (m) return { tipo: m[1], tier: Number(m[2]) };
  return null;
}
