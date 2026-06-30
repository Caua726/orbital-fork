import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Camera } from '../types';
import { Graphics as WeydraGraphics, Text as WeydraText, FONT_SMALL } from '@weydra/renderer';
import { Z } from '../core/render-order';
import { getWeydraRenderer } from '../weydra-loader';
import { registerOverlay } from './overlay-registry';

const TAMANHO_MAPA = 210;
const MARGEM = 16;

const SP = {
  panelBg: 0x101830,
  panelBgDark: 0x0a1020,
  panelBorder: 0x2a4070,
  cornerAccent: 0x4a80cc,
  titleBg: 0x1a3060,
  titleBgLight: 0x2a5090,
  titleText: 0xa0d0ff,
  diamond: 0x60ccff,
  fieldBg: 0x040810,
  fieldBorder: 0x1a2848,
};

const CORES_DONO: Record<string, number> = {
  neutro: 0x666666,
  jogador: 0x60ccff,
};

interface MinimapContainer extends Container {
  _frame: Graphics;
  _dots: Graphics;
  _fleetLines: Graphics;
  _viewport: Graphics;
  _mundo: Mundo;
  // M9 weydra handles. Null on the Pixi path. Released in
  // destruirMinimapa() so the weydra SlotMap doesn't leak.
  _weydra?: {
    frame: WeydraGraphics;
    dots: WeydraGraphics;
    fleetLines: WeydraGraphics;
    viewport: WeydraGraphics;
    title: WeydraText;
    unregister: () => void;
  };
}

let _clickCallback: ((worldX: number, worldY: number) => void) | null = null;

export function onMinimapClick(cb: (worldX: number, worldY: number) => void): void {
  _clickCallback = cb;
}

/** Destroy a minimap. Public so callers that wire their own
 *  destruir can release the weydra handles + DOM listener. */
export function destruirMinimapa(minimapa: MinimapContainer): void {
  const w = minimapa._weydra;
  if (w) {
    w.unregister();
    const r = getWeydraRenderer();
    if (r) {
      r.destroyGraphics(w.frame);
      r.destroyGraphics(w.dots);
      r.destroyGraphics(w.fleetLines);
      r.destroyGraphics(w.viewport);
      r.destroyText(w.title);
    }
    minimapa._weydra = undefined;
  }
}

export function criarMinimapa(app: Application, mundo: Mundo): MinimapContainer {
  const container = new Container() as MinimapContainer;

  container.x = app.screen.width - TAMANHO_MAPA - MARGEM;
  container.y = app.screen.height - TAMANHO_MAPA - 50;

  // M10: weydra-only. Pixi fallback removed.
  const r = getWeydraRenderer();
  if (r) {
    {
      const frame = r.createGraphics(false);
      const dots = r.createGraphics(false);
      const fleetLines = r.createGraphics(false);
      const viewport = r.createGraphics(false);
      const title = r.createText(FONT_SMALL, 32, false);
      frame.zOrder = Z.UI_BACKGROUND;
      dots.zOrder = Z.UI_GRAPHICS;
      fleetLines.zOrder = Z.UI_GRAPHICS;
      viewport.zOrder = Z.UI_HOVER;
      title.zOrder = Z.UI_TEXT;
      title.text = 'MINIMAP';

      // DOM click — bounds in CSS pixels match Pixi's container.x/y.
      // Hit-test uses CSS coords (PointerEvent.clientX/Y is CSS px);
      // weydra Graphics coords are physical px (canvas.width = cssW * dpr).
      // For an in-panel map (no world transform) the visual position
      // equals the CSS coord offset by canvas rect.
      const canvas = app.canvas;
      const ac = new AbortController();
      minimapAbortControllers.add(ac);
      const cx0 = container.x;
      const cy0 = container.y;
      canvas.addEventListener('pointerdown', (e: PointerEvent) => {
        if (!_clickCallback) return;
        if (e.clientX < cx0 || e.clientX > cx0 + TAMANHO_MAPA) return;
        if (e.clientY < cy0 || e.clientY > cy0 + TAMANHO_MAPA) return;
        // M10 review: cx0 / cy0 / mapX / mapY / TAMANHO_MAPA are CSS
        // pixels; e.clientX is also CSS pixels. Don't call toCanvasXY
        // here — that converts to physical pixels which would mix units
        // with the world-coord calculation below.
        const mapX = 6;
        const mapY = 28;
        const mapSize = TAMANHO_MAPA - 12;
        const escala = mapSize / mundo.tamanho;
        const localCssX = e.clientX - cx0 - mapX;
        const localCssY = e.clientY - cy0 - mapY;
        const worldX = localCssX / escala;
        const worldY = localCssY / escala;
        _clickCallback(worldX, worldY);
      }, { signal: ac.signal });

      const overlay = {
        destruir: () => destruirMinimapa(container),
      };
      const unregister = registerOverlay(overlay);
      container._weydra = { frame, dots, fleetLines, viewport, title, unregister };
    }
  }
  // M10: Pixi fallback removed. container._mundo / _frame / _dots etc.
  // stay as empty / no-op fields so the type still has the shape
  // callers expect.
  container._mundo = mundo;
  return container;
}

const minimapAbortControllers = new Set<AbortController>();
export function abortarListenersMinimapa(): void {
  for (const ac of minimapAbortControllers) ac.abort();
  minimapAbortControllers.clear();
}

export function atualizarMinimapa(minimapa: MinimapContainer, camera: Camera, app: Application): void {
  const mundo = minimapa._mundo;
  const totalW = TAMANHO_MAPA;
  const totalH = TAMANHO_MAPA + 26;
  const mapX = 6;
  const mapY = 28;
  const mapSize = TAMANHO_MAPA - 12;
  const escala = mapSize / mundo.tamanho;

  // Reposition (container.x/y may have changed via camera resize).
  minimapa.x = app.screen.width - TAMANHO_MAPA - MARGEM;
  minimapa.y = app.screen.height - totalH - MARGEM;

  // M9: weydra path. We need to draw in physical-pixel coords because
  // the canvas backing store is `cssW * dpr` wide; container.x/y is in
  // CSS pixels. Multiply by dpr for the draw calls. Graphics is
  // positioned via the per-frame `redraw` closure below; the container
  // positioning is just for DOM hit-test.
  const w = minimapa._weydra;
  if (w) {
    const r = getWeydraRenderer();
    if (r) {
      const dpr = window.devicePixelRatio || 1;
      const ox = minimapa.x * dpr;
      const oy = minimapa.y * dpr;
      const tw = totalW * dpr;
      const th = totalH * dpr;
      const mxp = mapX * dpr + ox;
      const myp = mapY * dpr + oy;
      const msz = mapSize * dpr;
      w.frame.clear();
      w.frame.rect(ox, oy, tw, th / 2).fill({ color: SP.panelBg });
      w.frame.rect(ox, oy + th / 2, tw, th / 2).fill({ color: SP.panelBgDark });
      w.frame.roundRect(ox, oy, tw, th, 4).stroke({ color: SP.panelBorder, width: 2 });
      const s = 8 * dpr;
      w.frame.moveTo(ox, oy + s).lineTo(ox, oy).lineTo(ox + s, oy).stroke({ color: SP.cornerAccent, width: 2 });
      w.frame.moveTo(ox + tw - s, oy).lineTo(ox + tw, oy).lineTo(ox + tw, oy + s).stroke({ color: SP.cornerAccent, width: 2 });
      w.frame.moveTo(ox, oy + th - s).lineTo(ox, oy + th).lineTo(ox + s, oy + th).stroke({ color: SP.cornerAccent, width: 2 });
      w.frame.moveTo(ox + tw - s, oy + th).lineTo(ox + tw, oy + th).lineTo(ox + tw, oy + th - s).stroke({ color: SP.cornerAccent, width: 2 });
      w.frame.rect(ox + 2 * dpr, oy + 2 * dpr, tw - 4 * dpr, 22 * dpr).fill({ color: SP.titleBg });
      w.frame.rect(
        ox + 2 * dpr + (tw - 4 * dpr) / 3,
        oy + 2 * dpr,
        (tw - 4 * dpr) * 2 / 3,
        22 * dpr,
      ).fill({ color: SP.titleBgLight, alpha: 0.5 });
      w.frame.moveTo(ox + 2 * dpr, oy + 24 * dpr).lineTo(ox + tw - 2 * dpr, oy + 24 * dpr).stroke({ color: SP.panelBorder, width: 1 });
      const dx = ox + 12 * dpr;
      const dy = oy + 13 * dpr;
      w.frame.moveTo(dx, dy - 3 * dpr).lineTo(dx + 3 * dpr, dy).lineTo(dx, dy + 3 * dpr).lineTo(dx - 3 * dpr, dy).lineTo(dx, dy - 3 * dpr).fill({ color: SP.diamond });
      w.frame.rect(mxp, myp, msz, msz).fill({ color: SP.fieldBg });
      w.frame.rect(mxp, myp, msz, msz).stroke({ color: SP.fieldBorder, width: 1 });
      w.frame.rect(mxp, myp + msz, msz, 4 * dpr).fill({ color: SP.panelBgDark });

      w.dots.clear();
      for (const sol of mundo.sois) {
        if (!sol._visivelAoJogador) continue;
        w.dots.circle(mxp + sol.x * escala, myp + sol.y * escala, 2.5 * dpr)
          .fill({ color: sol._cor || 0xffdd88, alpha: 0.9 });
      }
      for (const p of mundo.planetas) {
        if (!p._visivelAoJogador) continue;
        const mx = mxp + p.x * escala;
        const my = myp + p.y * escala;
        const r2 = Math.max(2 * dpr, (p.dados.tamanho * escala) / 2);
        const cor = CORES_DONO[p.dados.dono] || 0x666666;
        w.dots.circle(mx, my, Math.min(r2, 5 * dpr)).fill({ color: cor });
      }
      for (const nave of mundo.naves) {
        w.dots.circle(mxp + nave.x * escala, myp + nave.y * escala, 1.4 * dpr)
          .fill({ color: 0xffffff, alpha: 0.95 });
      }

      w.fleetLines.clear();

      w.viewport.clear();
      const zoom = camera.zoom || 1;
      const vx = mxp + camera.x * escala;
      const vy = myp + camera.y * escala;
      const vw = (app.screen.width / zoom) * escala;
      const vh = (app.screen.height / zoom) * escala;
      w.viewport.rect(vx, vy, vw, vh).stroke({ color: 0x60ccff, width: 0.8, alpha: 0.4 });

      w.title.x = ox + 22 * dpr;
      w.title.y = oy + 5 * dpr;
    }
    return;
  }

  // Pixi fallback path.
  const frame = minimapa._frame;
  frame.clear();
  frame.rect(0, 0, totalW, totalH / 2).fill({ color: SP.panelBg });
  frame.rect(0, totalH / 2, totalW, totalH / 2).fill({ color: SP.panelBgDark });
  frame.roundRect(0, 0, totalW, totalH, 4).stroke({ color: SP.panelBorder, width: 2 });
  const s = 8;
  frame.moveTo(0, s).lineTo(0, 0).lineTo(s, 0).stroke({ color: SP.cornerAccent, width: 2 });
  frame.moveTo(totalW - s, 0).lineTo(totalW, 0).lineTo(totalW, s).stroke({ color: SP.cornerAccent, width: 2 });
  frame.moveTo(0, totalH - s).lineTo(0, totalH).lineTo(s, totalH).stroke({ color: SP.cornerAccent, width: 2 });
  frame.moveTo(totalW - s, totalH).lineTo(totalW, totalH).lineTo(totalW, totalH - s).stroke({ color: SP.cornerAccent, width: 2 });
  frame.rect(2, 2, totalW - 4, 22).fill({ color: SP.titleBg });
  frame.rect(2 + (totalW - 4) / 3, 2, (totalW - 4) * 2 / 3, 22).fill({ color: SP.titleBgLight, alpha: 0.5 });
  frame.moveTo(2, 24).lineTo(totalW - 2, 24).stroke({ color: SP.panelBorder, width: 1 });
  const dx = 12;
  const dy = 13;
  frame.moveTo(dx, dy - 3).lineTo(dx + 3, dy).lineTo(dx, dy + 3).lineTo(dx - 3, dy).lineTo(dx, dy - 3).fill({ color: SP.diamond });
  frame.rect(mapX, mapY, mapSize, mapSize).fill({ color: SP.fieldBg });
  frame.rect(mapX, mapY, mapSize, mapSize).stroke({ color: SP.fieldBorder, width: 1 });
  frame.rect(mapX, mapY + mapSize, mapSize, 4).fill({ color: SP.panelBgDark });

  const dots = minimapa._dots;
  dots.clear();
  for (const sol of mundo.sois) {
    if (!sol._visivelAoJogador) continue;
    dots.circle(mapX + sol.x * escala, mapY + sol.y * escala, 2.5).fill({ color: sol._cor || 0xffdd88, alpha: 0.9 });
  }
  for (const p of mundo.planetas) {
    if (!p._visivelAoJogador) continue;
    const mx = mapX + p.x * escala;
    const my = mapY + p.y * escala;
    const r2 = Math.max(2, (p.dados.tamanho * escala) / 2);
    const cor = CORES_DONO[p.dados.dono] || 0x666666;
    dots.circle(mx, my, Math.min(r2, 5)).fill({ color: cor });
  }
  for (const nave of mundo.naves) {
    dots.circle(mapX + nave.x * escala, mapY + nave.y * escala, 1.4).fill({ color: 0xffffff, alpha: 0.95 });
  }

  const fl = minimapa._fleetLines;
  fl.clear();

  const vp = minimapa._viewport;
  vp.clear();
  const zoom = camera.zoom || 1;
  const vx = mapX + camera.x * escala;
  const vy = mapY + camera.y * escala;
  const vw = (app.screen.width / zoom) * escala;
  const vh = (app.screen.height / zoom) * escala;
  vp.rect(vx, vy, vw, vh).stroke({ color: 0x60ccff, width: 0.8, alpha: 0.4 });
}
