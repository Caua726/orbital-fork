/**
 * Render-matrix harness hooks (`window.__render`).
 *
 * Driven by `tests/render-matrix.mjs`, which screenshots every in-canvas
 * element one layer at a time under each engine/backend/driver and diffs
 * them against the Pixi/WebGL hardware reference. Two capabilities the
 * existing `window.__test` hooks lack:
 *
 *  - a LAYER MASK that hides everything except the layers under test, in
 *    both engines. Weydra filters inside its render pass
 *    (`Renderer.setLayerMask`); Pixi gets `renderable = false` on the
 *    containers/objects of each masked layer. `renderable` (unlike
 *    `visible`) is never written by the game loops, so the mask survives
 *    the per-frame visibility updates;
 *  - FREEZING every clock and replacing wall time with FIXED STEPS: the
 *    starfield advances per frame, planets/suns would sit at whatever `uTime`
 *    each engine reached before the pause, and trails/beams/particles depend
 *    on frame timing. In fixed-step mode the sim only advances through
 *    `step(n, dtMs)`, and render-visible timers read a virtual clock
 *    (src/core/relogio.ts), so dynamic scenes are pixel-comparable too.
 *
 * Installed in every build (the render lab page drives deployed builds too)
 * but inert until called: the mask defaults to "all layers" and the tick
 * stays on wall time until `freeze()`.
 */

import type { Container } from 'pixi.js';
import type { Mundo } from '../types';
import { LAYER_ALL, LAYER_BIT, layerBitForZ } from '../core/render-order';
import { getEngineRuntime } from '../core/engine-runtime';
import { getWeydraRenderer } from '../weydra-loader';
import { fixarTempoFundo } from './fundo';
import { rasterizarPlanetaCpu, renderPlanetaParaCanvas } from './planeta-procedural';
import { fixarRelogioVirtual } from '../core/relogio';

let _mask = LAYER_ALL;
let _raf = 0;
let _getMundo: () => Mundo | null = () => null;

// Fixed-step mode: null = normal wall-clock play.
let _relogioMs: number | null = null;
let _passosPendentes = 0;
let _dtPasso = 1000 / 60;
let _aoTerminarPassos: (() => void)[] = [];

/**
 * Called by the game tick once per frame. Returns null in normal play (one
 * comparison — the tick keeps wall time and the game speed), else the
 * simulation delta/speed for this frame: one fixed step while steps are
 * pending, paused otherwise.
 */
export function passoFixoRenderMatrix(): { dt: number; speed: number } | null {
  if (_relogioMs === null) return null;
  if (_passosPendentes === 0) return { dt: 0, speed: 0 };
  _passosPendentes--;
  _relogioMs += _dtPasso;
  fixarRelogioVirtual(_relogioMs);
  if (_passosPendentes === 0 && _aoTerminarPassos.length) {
    const fins = _aoTerminarPassos;
    _aoTerminarPassos = [];
    // Resolve after this frame's update AND render have run.
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const f of fins) f(); }));
  }
  return { dt: _dtPasso, speed: 1 };
}

function bitDoPixi(obj: any, padrao: number): number {
  return typeof obj?.__zOrder === 'number' ? layerBitForZ(obj.__zOrder) : padrao;
}

function marcar(obj: any, bit: number): void {
  if (obj) obj.renderable = (_mask & bit) !== 0;
}

/**
 * Children of a FILTERED parent (the baseline's half-res planet filter) are
 * masked by alpha instead: in Pixi a non-renderable child of a filtered
 * mesh empties the filter's bounds and the planet itself disappears.
 */
function marcarFilho(pai: any, filho: any, bit: number): void {
  if (!filho) return;
  if (!pai?.filters?.length) { marcar(filho, bit); return; }
  // Save the game's alpha only while masking, so later game writes (fades)
  // are never overwritten by a stale copy.
  if ((_mask & bit) !== 0) {
    if (filho.__alphaOrig !== undefined) { filho.alpha = filho.__alphaOrig; filho.__alphaOrig = undefined; }
  } else {
    if (filho.__alphaOrig === undefined) filho.__alphaOrig = filho.alpha;
    filho.alpha = 0;
  }
}

/** Applies the mask to the Pixi scene graph of the live world. */
function aplicarMascaraPixi(): void {
  const mundo = _getMundo() as any;
  if (!mundo?.container) return;
  const fundo = mundo.fundo;
  const especiais = new Set<Container>([
    fundo, mundo.orbitasContainer, mundo.navesContainer, mundo.rotasContainer,
    mundo.visaoContainer, mundo.memoriaPlanetasContainer, mundo.frotasContainer,
  ].filter(Boolean));

  if (fundo?._mesh) {
    marcar(fundo._mesh, LAYER_BIT.STARFIELD);
    marcar(fundo._brightTiles, LAYER_BIT.STARFIELD_BRIGHT);
  } else if (fundo) {
    // CPU background (canvas backend / software GPU): both layers live in one
    // canvas, so the mask is handed to its painter (fundo-canvas.ts).
    fundo._camadas = {
      starfield: (_mask & LAYER_BIT.STARFIELD) !== 0,
      bright: (_mask & LAYER_BIT.STARFIELD_BRIGHT) !== 0,
    };
  }
  marcar(mundo.orbitasContainer, LAYER_BIT.ORBITS);
  for (const filho of mundo.rotasContainer?.children ?? []) {
    marcar(filho, bitDoPixi(filho, LAYER_BIT.ROUTES));
  }
  for (const nave of mundo.naves ?? []) {
    for (const filho of nave.gfx?.children ?? []) {
      marcar(filho, filho === nave._trail ? LAYER_BIT.SHIP_TRAILS : bitDoPixi(filho, LAYER_BIT.SHIPS));
    }
  }
  marcar(mundo.visaoContainer, LAYER_BIT.FOG);
  marcar(mundo.memoriaPlanetasContainer, LAYER_BIT.FOG_MEMORY);
  // Everything else at the top level is a sun, a planet mesh, its baked
  // sprite or its selection ring (tagged with its own Z band). Tagged
  // children follow their own band — but a non-renderable parent still
  // hides them in Pixi.
  for (const filho of mundo.container.children as any[]) {
    if (especiais.has(filho)) continue;
    marcar(filho, bitDoPixi(filho, LAYER_BIT.PLANETS));
    for (const neto of filho.children ?? []) {
      if (typeof neto.__zOrder === 'number') marcarFilho(filho, neto, layerBitForZ(neto.__zOrder));
    }
  }
}

function loopMascara(): void {
  aplicarMascaraPixi();
  _raf = _mask === LAYER_ALL ? 0 : requestAnimationFrame(loopMascara);
}

export function setLayerMask(mask: number): void {
  _mask = mask >>> 0;
  getWeydraRenderer()?.setLayerMask(_mask);
  if (getEngineRuntime()?.engine !== 'pixi') return;
  // New objects (trails, beams, ghosts) appear over time, so keep
  // re-applying while a mask is active; one last pass restores LAYER_ALL.
  if (_raf === 0) loopMascara();
  else if (_mask === LAYER_ALL) aplicarMascaraPixi();
}

/** Pins every render clock to `tempoSeg` (sim speed must already be 0). */
function fixarTempos(tempoSeg: number): void {
  fixarTempoFundo(tempoSeg * 1000);
  const mundo = _getMundo() as any;
  if (!mundo) return;
  const corpos: any[] = [...(mundo.planetas ?? []), ...(mundo.sois ?? [])];
  for (const corpo of corpos) {
    if (corpo._weydraPlanet) {
      corpo._uTime = tempoSeg;
      corpo._uRotation = 0;
      corpo._weydraPlanet.uTime = tempoSeg;
      corpo._weydraPlanet.uRotation = 0;
    }
    const uniforms = corpo._planetShader?.resources?.planetUniforms?.uniforms;
    if (uniforms) {
      uniforms.uTime = tempoSeg;
      uniforms.uRotation = 0;
    }
    // Canvas-2D backend: CPU-rendered planets keep their clock here.
    const cpu = corpo._canvasRender?.state;
    if (cpu) {
      cpu.uTime = tempoSeg;
      cpu.uRotation = 0;
    }
  }
}

export function instalarRenderMatrixHooks(
  getMundo: () => Mundo | null,
  setGameSpeed: (n: number) => void,
): void {
  _getMundo = getMundo;
  (window as any).__render = {
    LAYER: LAYER_BIT,
    ALL: LAYER_ALL,
    setLayers: (mask: number) => { setLayerMask(mask); return 'ok'; },
    freeze: (tempoSeg = 10) => {
      setGameSpeed(0);
      if (_relogioMs === null) {
        _relogioMs = performance.now();
        fixarRelogioVirtual(_relogioMs);
      }
      fixarTempos(tempoSeg);
      return 'ok';
    },
    /** Advances the sim exactly `n` frames of `dtMs` each (fixed-step mode). */
    step: (n: number, dtMs = 1000 / 60): Promise<string> => {
      if (_relogioMs === null) return Promise.resolve('not frozen');
      if (n <= 0) return Promise.resolve('ok');
      // Overlapping calls queue up: steps add, every caller resolves once the
      // queue drains.
      _dtPasso = dtMs;
      _passosPendentes += Math.floor(n);
      return new Promise((res) => { _aoTerminarPassos.push(() => res('ok')); });
    },
    unfreeze: () => {
      _relogioMs = null;
      _passosPendentes = 0;
      for (const f of _aoTerminarPassos) f();
      _aoTerminarPassos = [];
      fixarRelogioVirtual(null);
      fixarTempoFundo(null);
      setGameSpeed(1);
      return 'ok';
    },
    /**
     * Same body rendered by the engine's portrait path (GPU readback on Pixi
     * WebGL) and by the CPU port (planeta-canvas.ts) — PNG data URLs, so the
     * harness can diff the CPU port against the shader.
     */
    retratos: (alvo: 'planeta' | 'sol', tamanho = 256) => {
      const mundo = _getMundo() as any;
      const corpo = alvo === 'sol'
        ? mundo?.sois?.[0]
        : mundo?.planetas?.find((p: any) => p.dados?.dono === 'jogador');
      if (!corpo) return null;
      const gpu = renderPlanetaParaCanvas(corpo, tamanho);
      const cpu = rasterizarPlanetaCpu(corpo, tamanho);
      return { gpu: gpu?.toDataURL() ?? null, cpu: cpu?.toDataURL() ?? null };
    },
    /**
     * Renders one frame and reads it back in the same task (WebGL drawing
     * buffers are only readable before compositing) — PNG data URL. The
     * render lab diffs two engines with it.
     */
    capturar: (): string | null => {
      const rt = getEngineRuntime();
      if (!rt) return null;
      if (rt.engine === 'pixi') rt.app.renderer.render(rt.app.stage);
      else getWeydraRenderer()?.render();
      return rt.canvas.toDataURL('image/png');
    },
    info: () => {
      const rt = getEngineRuntime();
      return rt
        ? { engine: rt.engine, requested: rt.requestedBackend, effective: rt.effectiveBackend }
        : null;
    },
  };
}
