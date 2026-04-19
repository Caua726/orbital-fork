import { Container, Graphics, Text } from 'pixi.js';
import type { Planeta, Mundo, FonteVisao, Camera } from '../types';
import { nomeTipoPlaneta } from './planeta';
import { criarPlanetaProceduralSprite } from './planeta-procedural';
import { calcularBoundsViewport, type ViewportBounds } from './viewport-bounds';

const _fogBoundsScratch: ViewportBounds = {
  esq: 0, dir: 0, cima: 0, baixo: 0, halfW: 0, halfH: 0, margem: 0,
};
import { getConfig } from '../core/config';
import { t } from '../core/i18n/t';

interface MemoriaPlanetaDados {
  dono: string;
  tipoPlaneta: string;
  tamanho: number;
  fabricas: number;
  infraestrutura: number;
  naves: number;
  producao: number;
}

interface MemoriaPlanetaSnapshot {
  x: number;
  y: number;
  frame: number;
  timestamp: number;
  dados: MemoriaPlanetaDados;
}

interface MemoriaPlaneta {
  conhecida: boolean;
  visual: Container;
  fantasma: Container;
  anel: Graphics;
  infoBg: Graphics;
  info: Text;
  tempoLabel: Text;
  dados: MemoriaPlanetaSnapshot | null;
  _textoAnterior: string;
}

const ALPHA_FANTASMA = 0.32;
const ALPHA_FANTASMA_ANEL = 0.3;
const COR_ANEL_FANTASMA = 0x8aa4bd;
const DISTANCIA_LABEL_MEMORIA = 18;

function nomeDonoCurto(dono: string): string {
  if (dono === 'jogador') return 'Seu';
  if (dono === 'neutro') return 'Neutro';
  // AI factions: use their generated name (without the title prefix to fit)
  // Lazy-load to avoid circular import
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPersonalidades } = require('./ia-decisao') as typeof import('./ia-decisao');
    const ia = getPersonalidades().find((p) => p.id === dono);
    if (ia) {
      // Show just the proper noun part (after the title)
      const parts = ia.nome.split(' ');
      return parts.length > 1 ? parts.slice(1).join(' ') : ia.nome;
    }
  } catch { /* circular import — fall through */ }
  return dono || '?';
}

function capturarMemoriaPlaneta(planeta: Planeta): MemoriaPlanetaSnapshot {
  return {
    x: planeta.x,
    y: planeta.y,
    frame: 0,
    timestamp: performance.now(),
    dados: {
      dono: planeta.dados.dono,
      tipoPlaneta: planeta.dados.tipoPlaneta,
      tamanho: planeta.dados.tamanho,
      fabricas: planeta.dados.fabricas,
      infraestrutura: planeta.dados.infraestrutura,
      naves: planeta.dados.naves,
      producao: planeta.dados.producao,
    },
  };
}

function dadosMudaram(anterior: MemoriaPlanetaSnapshot | null, atual: MemoriaPlanetaSnapshot): boolean {
  if (!anterior) return true;
  const a = anterior.dados;
  const b = atual.dados;
  return (
    a.dono !== b.dono ||
    a.tipoPlaneta !== b.tipoPlaneta ||
    a.tamanho !== b.tamanho ||
    a.fabricas !== b.fabricas ||
    a.infraestrutura !== b.infraestrutura ||
    a.naves !== b.naves ||
    a.producao !== b.producao
  );
}

/** Mapa global de memórias: planeta -> memória. Desacoplado do sprite. */
const memorias: WeakMap<Planeta, MemoriaPlaneta> = new WeakMap();

export function getMemoria(planeta: Planeta): MemoriaPlaneta | null {
  return memorias.get(planeta) || null;
}

export function criarCamadaMemoria(): Container {
  const container = new Container();
  container.eventMode = 'none';
  return container;
}

export function criarMemoriaVisualPlaneta(mundo: Mundo, planeta: Planeta): void {
  const container = new Container();
  container.visible = false;
  container.eventMode = 'none';
  container.alpha = 0;

  const fantasma = criarPlanetaProceduralSprite(
    0,
    0,
    planeta.dados.tamanho,
    planeta.dados.tipoPlaneta,
  );
  fantasma.alpha = ALPHA_FANTASMA;
  container.addChild(fantasma);

  const anel = new Graphics();
  container.addChild(anel);

  const infoBg = new Graphics();
  container.addChild(infoBg);

  const info = new Text({
    text: '',
    style: {
      fontSize: 11,
      fill: 0xcfe3ff,
      fontFamily: 'monospace',
      align: 'center',
    },
  });
  info.anchor.set(0.5, 0);
  container.addChild(info);

  const tempoLabel = new Text({
    text: '',
    style: {
      fontSize: 9,
      fill: 0x8899aa,
      fontFamily: 'monospace',
      align: 'center',
    },
  });
  tempoLabel.anchor.set(0.5, 0);
  container.addChild(tempoLabel);

  mundo.memoriaPlanetasContainer.addChild(container);

  const memoria = {
    conhecida: false,
    visual: container,
    fantasma,
    anel,
    infoBg,
    info,
    tempoLabel,
    dados: null,
    _textoAnterior: '',
  };

  memorias.set(planeta, memoria);
}

function redesenharVisualMemoria(memoria: MemoriaPlaneta): void {
  const { dados } = memoria;
  if (!dados) return;

  const tamanho = dados.dados.tamanho;

  memoria.fantasma.width = tamanho;
  memoria.fantasma.height = tamanho;
  memoria.fantasma.alpha = ALPHA_FANTASMA;

  memoria.anel.clear();
  const larguraAnel = 1.1;
  const raioAnel = Math.max(10, tamanho * 0.42 - larguraAnel * 0.5);
  memoria.anel.circle(0, 0, raioAnel).stroke({
    color: COR_ANEL_FANTASMA,
    width: larguraAnel,
    alpha: ALPHA_FANTASMA_ANEL,
  });

  const novoTexto =
    `${nomeDonoCurto(dados.dados.dono)} | ${nomeTipoPlaneta(dados.dados.tipoPlaneta)}\n` +
    `Fab ${dados.dados.fabricas}  Inf ${dados.dados.infraestrutura}  Nv ${dados.dados.naves}`;

  if (novoTexto !== memoria._textoAnterior) {
    memoria.info.text = novoTexto;
    memoria._textoAnterior = novoTexto;
  }

  memoria.info.y = tamanho / 2 + DISTANCIA_LABEL_MEMORIA;

  const largura = memoria.info.width + 12;
  const altura = memoria.info.height + 8;
  memoria.infoBg.clear();
  memoria.infoBg.roundRect(-largura / 2, memoria.info.y - 4, largura, altura, 4).fill({
    color: 0x08111f,
    alpha: 0.62,
  });

  memoria.tempoLabel.y = memoria.info.y + altura + 2;
}

export function registrarMemoriaPlaneta(planeta: Planeta): void {
  const memoria = memorias.get(planeta);
  if (!memoria) return;

  const novoSnapshot = capturarMemoriaPlaneta(planeta);
  const mudou = dadosMudaram(memoria.dados, novoSnapshot);

  memoria.conhecida = true;
  memoria.dados = novoSnapshot;

  if (mudou) {
    redesenharVisualMemoria(memoria);
  }
}

/**
 * Used by save/reconstruir to restore fog-of-war state after load.
 * Takes a previously-captured snapshot (with rebased timestamp) and
 * installs it into the WeakMap. Does NOT regenerate the visual layer —
 * caller must have already run criarMemoriaVisualPlaneta.
 */
export function restaurarMemoriaPlaneta(
  planeta: Planeta,
  snapshot: {
    conhecida: boolean;
    x: number;
    y: number;
    timestamp: number;
    dados: {
      dono: string;
      tipoPlaneta: string;
      tamanho: number;
      fabricas: number;
      infraestrutura: number;
      naves: number;
      producao: number;
    };
  },
): void {
  const memoria = memorias.get(planeta);
  if (!memoria) return;
  memoria.conhecida = snapshot.conhecida;
  memoria.dados = {
    x: snapshot.x,
    y: snapshot.y,
    frame: 0,
    timestamp: snapshot.timestamp,
    dados: { ...snapshot.dados },
  };
  redesenharVisualMemoria(memoria);
}



function formatarTempoPassado(ms: number): string {
  const seg = Math.floor(ms / 1000);
  if (seg < 60) return t('tempo.segundos_atras', { n: seg });
  const min = Math.floor(seg / 60);
  if (min < 60) return t('tempo.minutos_atras', { n: min });
  return t('tempo.horas_atras', { n: Math.floor(min / 60) });
}

export function atualizarVisibilidadeMemoria(planeta: Planeta, visivelAoJogador: boolean, esq: number, dir: number, cima: number, baixo: number, maxFantasmas: number): void {
  const memoria = memorias.get(planeta);
  if (!memoria) return;

  if (maxFantasmas === 0) {
    memoria.visual.visible = false;
    return;
  }

  const memoriaDados = memoria.dados;
  const deveMostrar = memoria.conhecida && !visivelAoJogador && !!memoriaDados;
  const memoriaNaTela = deveMostrar &&
    memoriaDados.x > esq && memoriaDados.x < dir &&
    memoriaDados.y > cima && memoriaDados.y < baixo;

  if (deveMostrar && memoriaNaTela) {
    memoria.visual.visible = true;
    memoria.visual.x = memoriaDados.x;
    memoria.visual.y = memoriaDados.y;
    memoria.visual.alpha = ALPHA_FANTASMA + 0.15;

    const agora = performance.now();
    const tempoTexto = formatarTempoPassado(agora - memoriaDados.timestamp);
    if (memoria.tempoLabel.text !== tempoTexto) {
      memoria.tempoLabel.text = tempoTexto;
    }
  } else {
    memoria.visual.visible = false;
  }
}

/**
 * Enforces the max-fantasmas cap. Called once per frame (from
 * atualizarMundo) after all individual atualizarVisibilidadeMemoria
 * calls. Visible ghosts beyond the cap are hidden, ordered by timestamp
 * desc (most recent wins).
 */
// Reused scratch buffer for fantasma cap enforcement. Pre-allocated
// entries prevent per-frame {planeta, ts} object creation at 60 Hz,
// which otherwise produces millions of short-lived objects during
// long idle play sessions (user reported 10h runs tanking FPS).
interface _FantasmaEntry { planeta: Planeta | null; ts: number }
const _visiveisBuffer: _FantasmaEntry[] = [];

export function aplicarLimiteFantasmas(mundo: Mundo): void {
  const max = getConfig().graphics.maxFantasmas;
  if (max < 0) return; // unlimited
  if (max === 0) return; // already handled in atualizarVisibilidadeMemoria

  let count = 0;
  for (const p of mundo.planetas) {
    const m = memorias.get(p);
    if (!m || !m.visual.visible || !m.dados) continue;
    if (count < _visiveisBuffer.length) {
      _visiveisBuffer[count].planeta = p;
      _visiveisBuffer[count].ts = m.dados.timestamp;
    } else {
      _visiveisBuffer.push({ planeta: p, ts: m.dados.timestamp });
    }
    count++;
  }
  if (count <= max) return;

  // Partial sort (insertion) over the active prefix; avoids
  // Array.prototype.sort allocating a sorted copy or invoking the
  // comparator on already-settled items.
  for (let i = 1; i < count; i++) {
    const cur = _visiveisBuffer[i];
    const curTs = cur.ts;
    let j = i - 1;
    while (j >= 0 && _visiveisBuffer[j].ts < curTs) {
      _visiveisBuffer[j + 1] = _visiveisBuffer[j];
      j--;
    }
    _visiveisBuffer[j + 1] = cur;
  }
  for (let i = max; i < count; i++) {
    const p = _visiveisBuffer[i].planeta;
    if (!p) continue;
    const m = memorias.get(p);
    if (m) m.visual.visible = false;
  }
}

export function atualizarEscalaLabelMemoria(planeta: Planeta, zoom: number): void {
  const memoria = memorias.get(planeta);
  if (!memoria?.visual.visible) return;

  const escalaInversa = 1 / Math.max(zoom, 0.1);
  const escala = Math.min(Math.max(escalaInversa, 0.5), 2.5);
  memoria.info.scale.set(escala);
  memoria.infoBg.scale.set(escala);
  memoria.tempoLabel.scale.set(escala);
}

export function removerMemoriaPlaneta(mundo: Mundo, planeta: Planeta): void {
  const memoria = memorias.get(planeta);
  if (!memoria) return;
  mundo.memoriaPlanetasContainer.removeChild(memoria.visual);
  memoria.visual.destroy({ children: true });
  memorias.delete(planeta);
}

import { Sprite, Texture, ImageSource } from 'pixi.js';
import { config } from '../ui/debug';
import { profileMark, profileAcumular } from './profiling';

// Fog resolution scales with graphics preset. Software rasterizers
// (WARP/SwiftShader) pay for every pixel uploaded, and the fog blits
// fullscreen each fogThrottle cycle — so at 'minimo' we drop to 1/9
// the pixel count (320×180 vs 960×540). The visual trade-off is
// soft edges on visibility circles, which actually reads FINE for
// fog-of-war; it wasn't pixel-perfect to begin with.
const FOG_BASE_W = 960;
const FOG_BASE_H = 540;
const FOG_MIN_W = 320;
const FOG_MIN_H = 180;

function fogDims(): { w: number; h: number } {
  const nivel = getConfig().graphics.qualidadeEfeitos;
  if (nivel === 'minimo') return { w: FOG_MIN_W, h: FOG_MIN_H };
  if (nivel === 'baixo') return { w: 640, h: 360 };
  return { w: FOG_BASE_W, h: FOG_BASE_H };
}

/**
 * Approximate bytes held by fog-of-war resources — the backing 2D
 * canvas plus its uploaded GPU texture. Returns 0 before the first
 * frame draws anything. Used by the RAM HUD estimate.
 */
export function getFogMemoryBytes(): number {
  if (!_fogCanvas) return 0;
  // Canvas bytes + GPU upload ≈ 2× the pixel data.
  return _fogCanvas.width * _fogCanvas.height * 4 * 2;
}

let _fogCanvas: HTMLCanvasElement | null = null;
let _fogCtx: CanvasRenderingContext2D | null = null;
let _fogSprite: Sprite | null = null;
let _fogSource: ImageSource | null = null;
let _fogTexture: Texture | null = null;
let _fogFrame: number = 0;
let _fogW: number = FOG_BASE_W;
let _fogH: number = FOG_BASE_H;

/** Sub-profiling do fog */
interface FogProfiling {
  canvas: number;
  upload: number;
}

export const fogProfiling: FogProfiling = { canvas: 0, upload: 0 };
let _fogProfSoma: FogProfiling = { canvas: 0, upload: 0 };
let _fogProfFrames: number = 0;

export function desenharNeblinaVisao(mundo: Mundo, fontesVisao: FonteVisao[], camera: Camera, screenW: number, screenH: number, zoom: number): void {
  _fogFrame++;

  // margemMin=0 (sem piso constante), margemMultiplier=1500 (replica
  // exatamente o comportamento original margem=1500*invZoom).
  const bounds = calcularBoundsViewport(camera.x, camera.y, zoom, screenW, screenH, 0, 1500, _fogBoundsScratch);
  const worldX = bounds.esq;
  const worldY = bounds.cima;
  const worldW = bounds.dir - bounds.esq;
  const worldH = bounds.baixo - bounds.cima;

  // Resolução do canvas depende do preset atual. Se o usuário mudar
  // de preset em runtime, destruímos o canvas/texture/sprite antigos
  // e o próximo frame recria no tamanho novo.
  const { w: canvasW, h: canvasH } = fogDims();
  if (_fogCanvas && (_fogW !== canvasW || _fogH !== canvasH)) {
    destruirFog();
  }
  const scaleX = canvasW / worldW;
  const scaleY = canvasH / worldH;

  if (!_fogCanvas) {
    _fogCanvas = document.createElement('canvas');
    _fogCanvas.width = canvasW;
    _fogCanvas.height = canvasH;
    _fogCtx = _fogCanvas.getContext('2d');
    _fogW = canvasW;
    _fogH = canvasH;
  }

  // Só redesenhar canvas a cada N frames (fogThrottle >= 1 sempre)
  const gfxCfg = getConfig().graphics;
  const fogT = Math.max(1, gfxCfg.fogThrottle);
  const redesenhar = _fogFrame % fogT === 0;

  if (redesenhar) {
    const tCanvas0 = profileMark();
    const ctx = _fogCtx!;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(2, 5, 16, ${config.fogAlpha})`;
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'white';
    for (const fonte of fontesVisao) {
      const cx = (fonte.x - worldX) * scaleX;
      const cy = (fonte.y - worldY) * scaleY;
      const rx = fonte.raio * scaleX;
      const ry = fonte.raio * scaleY;

      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    profileAcumular('fog_canvas', tCanvas0);

    // Upload textura
    const tUp0 = profileMark();
    const visao = mundo.visaoContainer;

    if (!_fogSprite) {
      _fogSource = new ImageSource({ resource: _fogCanvas });
      _fogTexture = new Texture({ source: _fogSource });
      _fogSprite = new Sprite(_fogTexture);
    }

    // Re-adicionar se foi removido (ex: visaoTotal toggle)
    if (!_fogSprite.parent) {
      visao.addChild(_fogSprite);
    }

    _fogSource!.resource = _fogCanvas;
    _fogSource!.update();
    profileAcumular('fog_upload', tUp0);

    // Legacy averaged view still exported for any HUD consumer that
    // hasn't migrated to the global profiling buckets yet.
    const dt = performance.now() - tCanvas0;
    _fogProfSoma.canvas += dt;
    _fogProfFrames++;
    if (_fogProfFrames >= 10) {
      fogProfiling.canvas = _fogProfSoma.canvas / _fogProfFrames;
      fogProfiling.upload = 0;
      _fogProfSoma = { canvas: 0, upload: 0 };
      _fogProfFrames = 0;
    }
  }

  // Posição do sprite atualiza todo frame (câmera move)
  if (_fogSprite) {
    _fogSprite.x = worldX;
    _fogSprite.y = worldY;
    _fogSprite.width = worldW;
    _fogSprite.height = worldH;
  }
}

/**
 * Release the module-level fog singletons — sprite, texture, image
 * source, and the backing 2D canvas. Must be called from destruirMundo
 * so that leaving a world (new game, load, return to menu) doesn't
 * leave a dangling RGBA texture + canvas in memory.
 */
export function destruirFog(): void {
  if (_fogSprite) {
    try { _fogSprite.destroy(); } catch { /* best-effort */ }
    _fogSprite = null;
  }
  if (_fogTexture) {
    try { _fogTexture.destroy(true); } catch { /* best-effort */ }
    _fogTexture = null;
  }
  if (_fogSource) {
    try { _fogSource.destroy(); } catch { /* best-effort */ }
    _fogSource = null;
  }
  _fogCanvas = null;
  _fogCtx = null;
  _fogFrame = 0;
  // Reset the cached dims so the next session's preset-switch guard
  // compares against a clean baseline instead of whatever the last
  // session happened to leave behind.
  _fogW = FOG_BASE_W;
  _fogH = FOG_BASE_H;
}
