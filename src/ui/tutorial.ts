import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { criarText } from './_text-helper';
import type { Application } from 'pixi.js';
import type { Mundo } from '../types';
import { isTouchMode } from '../core/ui-mode';
import { Z } from '../core/render-order';
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import { rgbaWithAlpha, toCanvasXY } from './_dom-helpers';
import { registerOverlay } from './overlay-registry';

interface TutorialContainer extends Container {
  _fadeOut: boolean;
  _alpha: number;
  _targetY: number;
  _slideIn: boolean;
  _persisted: boolean;
}

const SP = {
  panelBg: 0x101830,
  panelBgDark: 0x0a1020,
  panelBorder: 0x2a4070,
  cornerAccent: 0x4a80cc,
  titleBg: 0x1a3060,
  titleBgLight: 0x2a5090,
  titleText: 0xa0d0ff,
  diamond: 0x60ccff,
  fieldBg: 0x060c1a,
  fieldBorder: 0x1a2848,
  textValue: 0x90ccff,
};

const TUTORIAL_SEEN_KEY = 'orbital-tutorial-seen';

function markSeen(): void {
  try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch { /* ignore quota */ }
}

function alreadySeen(): boolean {
  try { return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'; } catch { return false; }
}

export function criarTutorial(app: Application): TutorialContainer | null {
  if (alreadySeen()) return null;
  const tutorial = new Container() as TutorialContainer;

  const touch = isTouchMode();
  // Responsive sizing — cap at 520 but shrink below on phones.
  const largura = Math.min(app.screen.width * 0.9, 520);
  const altura = Math.min(app.screen.height * 0.55, 310);

  const bg = new Graphics();

  bg.rect(-largura / 2, -altura / 2, largura, altura / 2).fill({ color: SP.panelBg });
  bg.rect(-largura / 2, 0, largura, altura / 2).fill({ color: SP.panelBgDark });
  bg.roundRect(-largura / 2, -altura / 2, largura, altura, 4).stroke({ color: SP.panelBorder, width: 2 });

  const hW = largura / 2;
  const hH = altura / 2;
  const s = 10;
  bg.moveTo(-hW, -hH + s).lineTo(-hW, -hH).lineTo(-hW + s, -hH).stroke({ color: SP.cornerAccent, width: 2 });
  bg.moveTo(hW - s, -hH).lineTo(hW, -hH).lineTo(hW, -hH + s).stroke({ color: SP.cornerAccent, width: 2 });
  bg.moveTo(-hW, hH - s).lineTo(-hW, hH).lineTo(-hW + s, hH).stroke({ color: SP.cornerAccent, width: 2 });
  bg.moveTo(hW - s, hH).lineTo(hW, hH).lineTo(hW, hH - s).stroke({ color: SP.cornerAccent, width: 2 });

  bg.rect(-hW + 2, -hH + 2, largura - 4, 22).fill({ color: SP.titleBg });
  bg.rect(-hW + 2 + (largura - 4) / 3, -hH + 2, (largura - 4) * 2 / 3, 22).fill({ color: SP.titleBgLight, alpha: 0.5 });
  bg.moveTo(-hW + 2, -hH + 24).lineTo(hW - 2, -hH + 24).stroke({ color: SP.panelBorder, width: 1 });

  const dx = -hW + 12;
  const dy = -hH + 13;
  bg.moveTo(dx, dy - 3).lineTo(dx + 3, dy).lineTo(dx, dy + 3).lineTo(dx - 3, dy).lineTo(dx, dy - 3).fill({ color: SP.diamond });

  const fx = -hW + 8;
  const fy = -hH + 28;
  const fw = largura - 16;
  const fh = altura - 38;
  bg.rect(fx, fy, fw, fh).fill({ color: SP.fieldBg });
  bg.rect(fx, fy, fw, fh).stroke({ color: SP.fieldBorder, width: 1 });

  tutorial.addChild(bg);

  const titleText = criarText('Tutorial', 15, SP.titleText)
  titleText.anchor.set(0, 0.5);
  titleText.x = -hW + 22;
  titleText.y = -hH + 13;
  tutorial.addChild((titleText)._pixi ?? ((titleText) as unknown as Container));;

  // Instructions diverge by input modality — scroll/click vs pinch/tap.
  const linhas = touch ? [
    'Toque em um planeta para abrir suas opcoes',
    'Fabrica T1 libera a nave Colonizadora',
    'Toque na colonizadora e depois em um sol ou planeta neutro',
    'Arraste em area vazia do espaco para mover a camera',
    'Pinca para dar zoom (ou toque duplo)',
  ] : [
    'Clique em um planeta para abrir as opcoes dele',
    'Fabrica T1 libera a colonizadora',
    'Clique na colonizadora e depois em um planeta neutro ou sol',
    'Arraste em area vazia para mover a camera',
    'Scroll do mouse para dar zoom',
  ];

  const estilo = {
    fontSize: touch ? 15 : 16,
    fill: SP.textValue,
    fontFamily: 'monospace',
    wordWrap: true,
    wordWrapWidth: largura - 50,
  };

  // Distribute lines in available body space instead of fixed 36px stride.
  const bodyTop = -hH + 44;
  const bodyBottom = hH - (touch ? 56 : 42);
  const stride = Math.min(38, Math.max(22, (bodyBottom - bodyTop) / (linhas.length + 0.5)));
  for (let i = 0; i < linhas.length; i++) {
    const t = criarText(`- ${linhas[i]}`, 14, SP.textValue);
    t.anchor.set(0.5, 0.5);
    t.x = 0;
    t.y = bodyTop + i * stride + stride * 0.5;
    tutorial.addChild((t)._pixi ?? ((t) as unknown as Container));;
  }

  // Bigger tap target for touch (160×44 meets Fitts' 44px minimum).
  const btnW = touch ? 160 : 120;
  const btnH = touch ? 44 : 26;
  const closeBtn = new Container();
  closeBtn.eventMode = 'static';
  closeBtn.cursor = 'pointer';
  closeBtn.hitArea = new Rectangle(0, 0, btnW, btnH);
  const closeBg = new Graphics();
  closeBg.rect(0, 0, btnW, btnH).fill({ color: 0x1a2848 });
  closeBg.rect(0, 0, btnW, btnH).stroke({ color: 0x2a4878, width: 1 });
  closeBg.moveTo(4, 0).lineTo(btnW - 4, 0).stroke({ color: 0x3a6098, width: 1, alpha: 0.4 });
  closeBtn.addChild(closeBg);
  const closeTxt = criarText('Fechar', touch ? 17 : 15, SP.textValue);
  closeTxt.anchor.set(0.5);
  closeTxt.x = btnW / 2;
  closeTxt.y = btnH / 2;
  closeBtn.addChild((closeTxt)._pixi ?? ((closeTxt) as unknown as Container));;
  closeBtn.x = -btnW / 2;
  closeBtn.y = hH - btnH - 10;
  tutorial.addChild(closeBtn);

  // M7: Pixi eventMode + .on('pointertap') replaced by a DOM
  // pointerdown listener. Hit-test the button's CSS-pixel bounds,
  // which equal (tutorial.x + closeBtn.x, tutorial.y + closeBtn.y)
  // and size (btnW × btnH). AbortController-backed so world resets
  // release the listener.
  const closeBtnBounds = () => {
    const left = tutorial.x + closeBtn.x;
    const top = tutorial.y + closeBtn.y;
    return { left, top, right: left + btnW, bottom: top + btnH };
  };
  const ac = new AbortController();
  tutorialAbortControllers.add(ac);
  app.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!(e.target as HTMLElement)?.closest?.('canvas')) return;
    const b = closeBtnBounds();
    if (e.clientX < b.left || e.clientX > b.right) return;
    if (e.clientY < b.top || e.clientY > b.bottom) return;
    markSeen();
    tutorial._persisted = true;
    tutorial._fadeOut = true;
  }, { signal: ac.signal });

  tutorial.x = app.screen.width / 2;
  tutorial.y = app.screen.height / 2;
  tutorial._fadeOut = false;
  tutorial._alpha = 1;
  tutorial._persisted = false;

  tutorial._targetY = tutorial.y;
  tutorial.y = tutorial._targetY - 30;
  tutorial._slideIn = true;

  // M9: weydra path. Reuse the M7 Graphics pipeline (worldSpace=false)
  // for the frame + close-bg; weydra Text for title/lines/close.
  // Frame anchor matches the Pixi path (-largura/2, -altura/2).
  if (getConfig().weydra.ui) {
    const r = getWeydraRenderer();
    if (r) {
      const frame = r.createGraphics(false);
      frame.zOrder = Z.UI_BACKGROUND;
      const titleT = criarText('Tutorial', 15, SP.titleText);
      if (titleT._weydra) titleT._weydra.zOrder = Z.UI_TEXT;
      const lineTs = linhas.map((s) => criarText(`- ${s}`, 14, SP.textValue));
      for (const lt of lineTs) if (lt._weydra) lt._weydra.zOrder = Z.UI_TEXT;
      const closeBg = r.createGraphics(false);
      closeBg.zOrder = Z.UI_GRAPHICS;
      const closeT = criarText('Fechar', touch ? 17 : 15, SP.textValue);
      if (closeT._weydra) closeT._weydra.zOrder = Z.UI_TEXT;

      const dpr = window.devicePixelRatio || 1;
      const dpr2 = (n: number) => n * dpr;
      let currentAlpha = 0;
      const closeRect = { x: 0, y: 0, w: 0, h: 0 };

      const redraw = (): void => {
        const cx = app.screen.width / 2 * dpr;
        const cy = (tutorial._targetY + (tutorial.y - tutorial._targetY)) * dpr;
        const fx0 = cx - dpr2(largura) / 2;
        const fy0 = cy - dpr2(altura) / 2;
        frame.clear();
        frame.rect(fx0, fy0, dpr2(largura), dpr2(altura) / 2).fill({ color: SP.panelBg });
        frame.rect(fx0, fy0 + dpr2(altura) / 2, dpr2(largura), dpr2(altura) / 2).fill({ color: SP.panelBgDark });
        frame.roundRect(fx0, fy0, dpr2(largura), dpr2(altura), 4 * dpr).stroke({ color: SP.panelBorder, width: 2 });
        const s = 10 * dpr;
        frame.moveTo(fx0, fy0 + s).lineTo(fx0, fy0).lineTo(fx0 + s, fy0).stroke({ color: SP.cornerAccent, width: 2 });
        frame.moveTo(fx0 + dpr2(largura) - s, fy0).lineTo(fx0 + dpr2(largura), fy0).lineTo(fx0 + dpr2(largura), fy0 + s).stroke({ color: SP.cornerAccent, width: 2 });
        frame.moveTo(fx0, fy0 + dpr2(altura) - s).lineTo(fx0, fy0 + dpr2(altura)).lineTo(fx0 + s, fy0 + dpr2(altura)).stroke({ color: SP.cornerAccent, width: 2 });
        frame.moveTo(fx0 + dpr2(largura) - s, fy0 + dpr2(altura)).lineTo(fx0 + dpr2(largura), fy0 + dpr2(altura)).lineTo(fx0 + dpr2(largura), fy0 + dpr2(altura) - s).stroke({ color: SP.cornerAccent, width: 2 });
        frame.rect(fx0 + 2 * dpr, fy0 + 2 * dpr, dpr2(largura) - 4 * dpr, 22 * dpr).fill({ color: SP.titleBg });
        frame.rect(fx0 + 2 * dpr + (dpr2(largura) - 4 * dpr) / 3, fy0 + 2 * dpr, (dpr2(largura) - 4 * dpr) * 2 / 3, 22 * dpr).fill({ color: SP.titleBgLight, alpha: 0.5 });
        frame.moveTo(fx0 + 2 * dpr, fy0 + 24 * dpr).lineTo(fx0 + dpr2(largura) - 2 * dpr, fy0 + 24 * dpr).stroke({ color: SP.panelBorder, width: 1 });
        const dx = fx0 + 12 * dpr;
        const dy = fy0 + 13 * dpr;
        frame.moveTo(dx, dy - 3 * dpr).lineTo(dx + 3 * dpr, dy).lineTo(dx, dy + 3 * dpr).lineTo(dx - 3 * dpr, dy).lineTo(dx, dy - 3 * dpr).fill({ color: SP.diamond });
        frame.rect(fx0 + 8 * dpr, fy0 + 28 * dpr, dpr2(largura) - 16 * dpr, dpr2(altura) - 38 * dpr).fill({ color: SP.fieldBg });
        frame.rect(fx0 + 8 * dpr, fy0 + 28 * dpr, dpr2(largura) - 16 * dpr, dpr2(altura) - 38 * dpr).stroke({ color: SP.fieldBorder, width: 1 });

        if (titleT._weydra) {
          titleT._weydra.x = fx0 + 22 * dpr;
          titleT._weydra.y = fy0 + 13 * dpr;
          titleT._weydra.color = rgbaWithAlpha(SP.titleText, currentAlpha);
        }
        for (let i = 0; i < lineTs.length; i++) {
          const w = lineTs[i]._weydra;
          if (w) {
            w.x = cx;
            w.y = fy0 + 44 * dpr + i * 22 * dpr;
            w.color = rgbaWithAlpha(SP.textValue, currentAlpha);
          }
        }

        const btnW = dpr2(touch ? 160 : 120);
        const btnH = dpr2(touch ? 44 : 26);
        const btnX = cx - btnW / 2;
        const btnY = fy0 + dpr2(altura) - btnH - 10 * dpr;
        closeBg.clear();
        closeBg.rect(btnX, btnY, btnW, btnH).fill({ color: 0x1a2848 });
        closeBg.rect(btnX, btnY, btnW, btnH).stroke({ color: 0x2a4878, width: 1 });
        closeBg.moveTo(btnX + 4 * dpr, btnY).lineTo(btnX + btnW - 4 * dpr, btnY).stroke({ color: 0x3a6098, width: 1, alpha: 0.4 });
        if (closeT._weydra) {
          closeT._weydra.x = btnX + btnW / 2;
          closeT._weydra.y = btnY + btnH / 2;
          closeT._weydra.color = rgbaWithAlpha(SP.textValue, currentAlpha);
        }
        closeRect.x = btnX;
        closeRect.y = btnY;
        closeRect.w = btnW;
        closeRect.h = btnH;
      };

      const tick = (dtSec: number): void => {
        const k = Math.min(1, dtSec * 10);
        if (tutorial._alpha < 1) tutorial._alpha += (1 - tutorial._alpha) * k;
        currentAlpha = tutorial._alpha;
        const yDiff = tutorial._targetY - tutorial.y;
        if (Math.abs(yDiff) > 0.5) tutorial.y += yDiff * k;
        if (Math.abs(yDiff) <= 0.5 && tutorial._slideIn) {
          tutorial.y = tutorial._targetY;
          tutorial._slideIn = false;
        }
        redraw();
      };

      const destruir = (): void => {
        r.destroyGraphics(frame);
        r.destroyGraphics(closeBg);
        for (const lt of lineTs) if (lt._weydra) r.destroyText(lt._weydra);
        if (titleT._weydra) r.destroyText(titleT._weydra);
        if (closeT._weydra) r.destroyText(closeT._weydra);
        unregister();
      };
      const unregister = registerOverlay({ tick, destruir });
      (tutorial as unknown as { _weydra: { destruir: () => void } })._weydra = { destruir };
    }
  }

  return tutorial;
}

/**
 * AbortControllers for every tutorial DOM listener ever registered.
 * Pair with `abortarListenersMinimapa()` from the world-destroy path.
 */
const tutorialAbortControllers = new Set<AbortController>();
export function abortarListenersTutorial(): void {
  for (const ac of tutorialAbortControllers) ac.abort();
  tutorialAbortControllers.clear();
}

export function atualizarTutorial(tutorial: TutorialContainer, mundo: Mundo): void {
  if (!tutorial.visible) return;

  if (tutorial._slideIn) {
    tutorial.y += (tutorial._targetY - tutorial.y) * 0.08;
    if (Math.abs(tutorial.y - tutorial._targetY) < 0.5) {
      tutorial.y = tutorial._targetY;
      tutorial._slideIn = false;
    }
  }

  const temPlanetaSelecionado = mundo.planetas.some((p) => p.dados.selecionado);
  const temNaveSelecionada = mundo.naves?.some((n) => n.selecionado);
  if (!tutorial._fadeOut && (temPlanetaSelecionado || temNaveSelecionada)) {
    tutorial._fadeOut = true;
    // The user followed the tutorial — mark as seen so it doesn't reappear.
    if (!tutorial._persisted) {
      markSeen();
      tutorial._persisted = true;
    }
  }

  if (tutorial._fadeOut) {
    tutorial._alpha -= 1 / 60;
    if (tutorial._alpha <= 0) {
      tutorial.visible = false;
      tutorial._alpha = 0;
    }
    tutorial.alpha = tutorial._alpha;
  }
}
