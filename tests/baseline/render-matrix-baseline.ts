/**
 * Render-matrix hooks for the PRE-WEYDRA baseline (d51623e), injected by
 * tests/baseline/prepare-baseline.mjs into a throwaway worktree. Same
 * `window.__render` / `window.__test` surface as src/world/render-matrix.ts
 * + the `__test` block of src/main.ts, so tests/render-matrix.mjs drives the
 * baseline exactly like the current engines. Baseline is Pixi-only: the
 * layer mask is `renderable` on the scene graph.
 */
import type { Container } from 'pixi.js';
import type { Mundo } from '../types';
import { fixarTempoFundo } from './fundo';
import { fixarRelogioVirtual } from '../core/relogio';
import { setGameSpeed } from '../ui/debug-menu';
import { criarNave, enviarNaveParaPosicao, enviarNaveParaAlvo, removerNave } from './naves';
import { getMemoria } from './nevoa';
import { getCombateMemoryBytes } from './combate-resolucao';
import { setCameraPos, setZoom } from '../core/player';

const LAYER = Object.freeze({
  STARFIELD: 1 << 0, STARFIELD_BRIGHT: 1 << 1, PLANETS: 1 << 2, ORBITS: 1 << 3,
  ROUTES: 1 << 4, SHIP_TRAILS: 1 << 5, SHIPS: 1 << 6, BEAMS: 1 << 7,
  FOG: 1 << 8, FOG_MEMORY: 1 << 9, UI: 1 << 10,
});
const ALL = 0xffffffff;

let _mask = ALL;
let _raf = 0;
let _getMundo: () => Mundo | null = () => null;
let _relogioMs: number | null = null;
let _passos = 0;
let _dt = 1000 / 60;
let _fim: (() => void) | null = null;

export function passoFixoRenderMatrix(): number | null {
  if (_relogioMs === null) return null;
  if (_passos === 0) return 0;
  _passos--;
  _relogioMs += _dt;
  fixarRelogioVirtual(_relogioMs);
  if (_passos === 0 && _fim) {
    const f = _fim;
    _fim = null;
    requestAnimationFrame(() => requestAnimationFrame(f));
  }
  return _dt;
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
  if ((_mask & bit) !== 0) {
    if (filho.__alphaOrig !== undefined) { filho.alpha = filho.__alphaOrig; filho.__alphaOrig = undefined; }
  } else {
    if (filho.__alphaOrig === undefined) filho.__alphaOrig = filho.alpha;
    filho.alpha = 0;
  }
}

function aplicar(): void {
  const m = _getMundo() as any;
  if (!m?.container) return;
  const esp = new Set<Container>([m.fundo, m.orbitasContainer, m.navesContainer, m.rotasContainer,
    m.visaoContainer, m.memoriaPlanetasContainer, m.frotasContainer].filter(Boolean));
  if (m.fundo?._mesh) {
    marcar(m.fundo._mesh, LAYER.STARFIELD);
    marcar(m.fundo._brightTiles, LAYER.STARFIELD_BRIGHT);
  } else marcar(m.fundo, LAYER.STARFIELD);
  marcar(m.orbitasContainer, LAYER.ORBITS);
  const rotas = new Set((m.naves ?? []).map((n: any) => n.rotaGfx));
  for (const c of m.rotasContainer?.children ?? []) marcar(c, rotas.has(c) ? LAYER.ROUTES : LAYER.BEAMS);
  for (const n of m.naves ?? []) {
    for (const c of n.gfx?.children ?? []) marcar(c, c === n._trail ? LAYER.SHIP_TRAILS : LAYER.SHIPS);
  }
  marcar(m.visaoContainer, LAYER.FOG);
  marcar(m.memoriaPlanetasContainer, LAYER.FOG_MEMORY);
  for (const c of m.container.children as any[]) {
    if (esp.has(c)) continue;
    marcar(c, LAYER.PLANETS);
    if (c._anel) marcarFilho(c, c._anel, LAYER.UI);
  }
}

function loop(): void {
  aplicar();
  _raf = _mask === ALL ? 0 : requestAnimationFrame(loop);
}

function fixarTempos(seg: number): void {
  fixarTempoFundo(seg * 1000);
  const m = _getMundo() as any;
  for (const c of [...(m?.planetas ?? []), ...(m?.sois ?? [])]) {
    const u = c._planetShader?.resources?.planetUniforms?.uniforms;
    if (u) { u.uTime = seg; u.uRotation = 0; }
  }
}

export function instalarRenderMatrixHooks(app: any, getMundo: () => Mundo | null): void {
  _getMundo = getMundo;
  const w = window as any;
  w.__mundo = () => getMundo();
  w.__setCam = (x: number, y: number) => setCameraPos(x, y);
  w.__setZoom = (z: number) => setZoom(z);
  const home = () => getMundo()?.planetas.find((p) => p.dados.dono === 'jogador');
  w.__test = {
    spawn: (tipo: string, n = 1) => {
      const m = getMundo(); const h = home();
      if (!m || !h) return 'no mundo';
      return Array.from({ length: n }, () => criarNave(m, h, tipo, 1).id);
    },
    send: (id: string, x: number, y: number) => {
      const m = getMundo(); const nv = m?.naves.find((n) => n.id === id);
      return m && nv ? enviarNaveParaPosicao(m, nv, x, y) : 'no ship';
    },
    sendToPlanet: (id: string, pid: string) => {
      const m = getMundo(); const nv = m?.naves.find((n) => n.id === id); const pl = m?.planetas.find((p) => p.id === pid);
      return m && nv && pl ? enviarNaveParaAlvo(m, nv, pl) : 'not found';
    },
    removeShip: (id: string) => {
      const m = getMundo(); const nv = m?.naves.find((n) => n.id === id);
      if (!m || !nv) return 'no ship';
      removerNave(m, nv);
      return 'ok';
    },
    speed: (n: number) => { setGameSpeed(n); return 'ok'; },
    combatBytes: () => getCombateMemoryBytes(),
    ghost: (pid: string) => {
      const pl = getMundo()?.planetas.find((p) => p.id === pid);
      const mem = pl ? getMemoria(pl) : null;
      return mem ? { hasMemoria: true, conhecida: (mem as any).conhecida } : { hasMemoria: false };
    },
  };
  w.__render = {
    LAYER, ALL,
    setLayers: (mask: number) => {
      _mask = mask >>> 0;
      if (_raf === 0) loop(); else if (_mask === ALL) aplicar();
      return 'ok';
    },
    freeze: (seg = 10) => {
      setGameSpeed(0);
      if (_relogioMs === null) { _relogioMs = performance.now(); fixarRelogioVirtual(_relogioMs); }
      fixarTempos(seg);
      return 'ok';
    },
    step: (n: number, dtMs = 1000 / 60): Promise<string> => {
      if (_relogioMs === null || n <= 0) return Promise.resolve('ok');
      _dt = dtMs; _passos = Math.floor(n);
      return new Promise((res) => { _fim = () => res('ok'); });
    },
    unfreeze: () => { _relogioMs = null; _passos = 0; fixarRelogioVirtual(null); fixarTempoFundo(null); setGameSpeed(1); return 'ok'; },
    info: () => ({ engine: 'baseline-pixi', requested: 'webgl', effective: app.renderer?.type === 2 ? 'webgpu' : 'webgl' }),
  };
}
