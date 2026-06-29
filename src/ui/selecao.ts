import { Container, Graphics, Text } from 'pixi.js';
import { criarText, type TextLike } from './_text-helper';
import type { Application, TipoJogador } from '../types';
import { TIPO_PLANETA } from '../world/planeta';
import { criarPlanetaProceduralSprite } from '../world/planeta-procedural';
import { Graphics as WeydraGraphics, Text as WeydraText, type Renderer as WeydraRenderer } from '@weydra/renderer';
import { Z } from '../core/render-order';
import { getConfig } from '../core/config';
import { getWeydraRenderer } from '../weydra-loader';
import { toCanvasXY, rgbaWithAlpha } from './_dom-helpers';
import { registerOverlay } from './overlay-registry';

interface AnimatedCard extends Container {
  _baseY: number;
  _animDelay: number;
  _animDone: boolean;
  _planeta: Container;
}

const W95 = {
  bg: 0xd4d0c8,
  bgLight: 0xdfdfdf,
  bgDark: 0x404040,
  border: 0x808080,
  white: 0xffffff,
  black: 0x000000,
  titleLeft: 0x0a246a,
  titleRight: 0x3a6ea5,
  field: 0xffffff,
  textDark: 0x222222,
  textLabel: 0x666666,
  btnFace: 0xd4d0c8,
};

const TIPOS: TipoJogador[] = [
  {
    nome: 'Industrial',
    desc: 'Producao +50%',
    cor: 0xcc6600,
    bonus: { producao: 1.5 },
  },
  {
    nome: 'Militar',
    desc: 'Infraestrutura inicial +1',
    cor: 0xcc0000,
    bonus: { infraestruturaInicial: 1 },
  },
  {
    nome: 'Expansionista',
    desc: 'Fabrica inicial T1',
    cor: 0x008844,
    bonus: { fabricasIniciais: 1 },
  },
];

export function getTipos(): TipoJogador[] {
  return TIPOS;
}

export async function criarTelaSelecao(app: Application): Promise<TipoJogador> {
  // M10: weydra-only. Pixi fallback below is DEAD CODE.
  const r = getWeydraRenderer();
  if (r) return criarTelaSelecaoWeydra(app, r);
  return new Promise<TipoJogador>((resolve) => {

    const overlay = new Container();

    // Dark space background
    const bg = new Graphics();
    bg.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x0a0a18, alpha: 0.95 });
    overlay.addChild(bg);

    // Main dialog window
    const largCard = 220;
    const altCard = 280;
    const gap = 20;
    const dialogPad = 30;
    const totalCardsW = TIPOS.length * largCard + (TIPOS.length - 1) * gap;
    const dialogW = totalCardsW + dialogPad * 2;
    const dialogH = altCard + 120;
    const dialogX = (app.screen.width - dialogW) / 2;
    const dialogY = (app.screen.height - dialogH) / 2;

    const dialog = new Container();
    dialog.x = dialogX;
    dialog.y = dialogY;

    // Window frame
    const dialogBg = new Graphics();
    dialogBg.rect(0, 0, dialogW, dialogH).fill({ color: W95.bg });
    dialogBg.moveTo(0, dialogH).lineTo(0, 0).lineTo(dialogW, 0).stroke({ color: W95.bgLight, width: 2 });
    dialogBg.moveTo(dialogW, 0).lineTo(dialogW, dialogH).lineTo(0, dialogH).stroke({ color: W95.bgDark, width: 2 });
    // Title bar
    dialogBg.rect(4, 3, dialogW - 8, 22).fill({ color: W95.titleLeft });
    dialogBg.rect(4 + (dialogW - 8) / 3, 3, (dialogW - 8) * 2 / 3, 22).fill({ color: W95.titleRight, alpha: 0.7 });
    dialog.addChild(dialogBg);

    const titulo = criarText('Escolha seu Imperio', 16, W95.white)
    titulo.x = 10;
    titulo.y = 5;
    dialog.addChild((titulo)._pixi ?? ((titulo) as unknown as Container));;

    const subtitulo = criarText('O tipo define os bonus do seu imperio', 14, W95.textLabel)
    subtitulo.anchor.set(0.5);
    subtitulo.x = dialogW / 2;
    subtitulo.y = 42;
    dialog.addChild((subtitulo)._pixi ?? ((subtitulo) as unknown as Container));;

    // Slide-in animation state
    dialog.alpha = 0;
    (dialog as Container & { _animTime: number })._animTime = 0;
    const targetY = dialogY;
    dialog.y = dialogY + 30;

    const cardStartX = dialogPad;
    const cardY = 60;

    TIPOS.forEach((tipo, i) => {
      const card = new Container() as AnimatedCard;
      card.x = cardStartX + i * (largCard + gap);
      card.y = cardY;
      card.eventMode = 'static';
      card.cursor = 'pointer';

      // M7: card interactions move to DOM events. The Pixi eventMode
      // path stays in place for the Pixi fallback (cfg.weydra.graphics
      // off); the DOM hit-test registry at the bottom of the file
      // covers the weydra path. Both paths call the same per-card
      // hover/press handlers.

      // Card initial offset for staggered animation
      card._baseY = cardY;
      card._animDelay = i * 0.15;
      card._animDone = false;
      card.alpha = 0;
      card.y = cardY + 20;

      const fundo = new Graphics();
      const drawCard = (hover: boolean): void => {
        fundo.clear();
        // Outset card
        fundo.rect(0, 0, largCard, altCard).fill({ color: hover ? 0xe8e8e8 : W95.bg });
        fundo.moveTo(0, altCard).lineTo(0, 0).lineTo(largCard, 0).stroke({ color: W95.bgLight, width: 2 });
        fundo.moveTo(largCard, 0).lineTo(largCard, altCard).lineTo(0, altCard).stroke({ color: W95.bgDark, width: 2 });
        // Colored accent line at top
        fundo.rect(4, 4, largCard - 8, 3).fill({ color: tipo.cor });
      };
      drawCard(false);
      card.addChild(fundo);;

      // Planet in a sunken field
      const planetField = new Graphics();
      planetField.rect(largCard / 2 - 45, 20, 90, 90).fill({ color: 0xf8f8f8 });
      planetField.moveTo(largCard / 2 - 45, 110).lineTo(largCard / 2 - 45, 20).lineTo(largCard / 2 + 45, 20).stroke({ color: W95.bgDark, width: 1 });
      planetField.moveTo(largCard / 2 + 45, 20).lineTo(largCard / 2 + 45, 110).lineTo(largCard / 2 - 45, 110).stroke({ color: W95.bgLight, width: 1 });
      card.addChild(planetField);;

      const planeta = criarPlanetaProceduralSprite(largCard / 2, 65, 70, TIPO_PLANETA.COMUM, 1.0 + i * 2.5);
      planeta.tint = tipo.cor;
      card.addChild(planeta);

      // Groove separator
      const sep = new Graphics();
      sep.moveTo(12, 120).lineTo(largCard - 12, 120).stroke({ color: W95.border, width: 1 });
      sep.moveTo(12, 121).lineTo(largCard - 12, 121).stroke({ color: W95.white, width: 1 });
      card.addChild(sep);;

      const nome = criarText(tipo.nome, 18, tipo.cor)
      nome.anchor.set(0.5);
      nome.x = largCard / 2;
      nome.y = 145;
      card.addChild((nome)._pixi ?? ((nome) as unknown as Container));;

      const desc = criarText(tipo.desc, 14, W95.textDark)
      desc.anchor.set(0.5);
      desc.x = largCard / 2;
      desc.y = 195;
      card.addChild((desc)._pixi ?? ((desc) as unknown as Container));;

      // Win95-style button at bottom
      const btnW = largCard - 40;
      const btnH = 28;
      const btnX = 20;
      const btnY = altCard - 42;
      const btnBg = new Graphics();
      const drawBtn = (pressed: boolean): void => {
        btnBg.clear();
        btnBg.rect(btnX, btnY, btnW, btnH).fill({ color: W95.btnFace || W95.bg });
        if (pressed) {
          btnBg.moveTo(btnX, btnY + btnH).lineTo(btnX, btnY).lineTo(btnX + btnW, btnY).stroke({ color: W95.bgDark, width: 2 });
          btnBg.moveTo(btnX + btnW, btnY).lineTo(btnX + btnW, btnY + btnH).lineTo(btnX, btnY + btnH).stroke({ color: W95.bgLight, width: 2 });
        } else {
          btnBg.moveTo(btnX, btnY + btnH).lineTo(btnX, btnY).lineTo(btnX + btnW, btnY).stroke({ color: W95.bgLight, width: 2 });
          btnBg.moveTo(btnX + btnW, btnY).lineTo(btnX + btnW, btnY + btnH).lineTo(btnX, btnY + btnH).stroke({ color: W95.bgDark, width: 2 });
        }
      };
      drawBtn(false);
      card.addChild(btnBg);;

      const hint = criarText('Selecionar', 14, W95.textDark)
      hint.anchor.set(0.5);
      hint.x = largCard / 2;
      hint.y = btnY + btnH / 2;
      card.addChild((hint)._pixi ?? ((hint) as unknown as Container));;

      card.on('pointerover', () => {
        drawCard(true);
        drawBtn(false);
        hint.style.fill = tipo.cor;
      });

      card.on('pointerout', () => {
        drawCard(false);
        drawBtn(false);
        hint.style.fill = W95.textDark;
      });

      card.on('pointerdown', () => {
        drawBtn(true);
      });

      card.on('pointerup', () => {
        drawBtn(false);
      });

      // M7: extract the tap handler to a closure so the DOM event
      // path (see `registrarCard`) can fire the same logic.
      const onTap = (): void => {
        let closeAlpha = 1;
        const closeTicker = (): void => {
          closeAlpha -= 0.05;
          dialog.alpha = Math.max(0, closeAlpha);
          dialog.y += 2;
          if (closeAlpha <= 0) {
            app.ticker.remove(closeTicker);
            app.stage.removeChild(overlay);
            resolve(tipo);
          }
        };
        app.ticker.add(closeTicker);
      };
      card.on('pointertap', onTap);

      card._planeta = planeta;
      // M7: register the card for DOM hit-test (the weydra.graphics path).
      // Pixi eventMode path stays for the fallback.
      registrarCard(card, dialogX + card.x, dialogY + card.y, largCard, altCard, {
        onHoverChange: (h: boolean) => {
          drawCard(h);
          drawBtn(false);
          hint.style.fill = h ? tipo.cor : W95.textDark;
        },
        onPressChange: (p: boolean) => {
          drawBtn(p);
        },
        onTap,
      });
      dialog.addChild(card);;
    });

    overlay.addChild(dialog);

    // Animate dialog in
    let animTime = 0;
    const animIn = (): void => {
      animTime += 1 / 60;

      // Dialog fade + slide
      const dialogProgress = Math.min(1, animTime * 3);
      const ease = 1 - Math.pow(1 - dialogProgress, 3);
      dialog.alpha = ease;
      dialog.y = targetY + 30 * (1 - ease);

      // Staggered cards
      for (let i = 0; i < dialog.children.length; i++) {
        const child = dialog.children[i] as Partial<AnimatedCard> & Container;
        if (child._animDelay !== undefined && !child._animDone) {
          const cardTime = animTime - child._animDelay;
          if (cardTime > 0) {
            const cp = Math.min(1, cardTime * 4);
            const ce = 1 - Math.pow(1 - cp, 3);
            child.alpha = ce;
            child.y = (child._baseY ?? 0) + 20 * (1 - ce);
            if (cp >= 1) child._animDone = true;
          }
        }
      }

      if (animTime > 1.5) {
        app.ticker.remove(animIn);
      }
    };
    app.ticker.add(animIn);

    app.stage.addChild(overlay);
  });
}

// ─── M7: DOM event registry for the type-selection cards ─────────────

interface CardCallbacks {
  onHoverChange: (hovered: boolean) => void;
  onPressChange: (pressed: boolean) => void;
  onTap: () => void;
}

interface CardEntry {
  card: AnimatedCard;
  bounds: { left: number; top: number; right: number; bottom: number };
  callbacks: CardCallbacks;
  hovered: boolean;
  pressed: boolean;
}

const _cardsRegistradas: CardEntry[] = [];
let _hoveredCard: CardEntry | null = null;
let _pressedCard: CardEntry | null = null;
let _selecaoAbort: AbortController | null = null;

function registrarCard(
  card: AnimatedCard,
  left: number,
  top: number,
  w: number,
  h: number,
  callbacks: CardCallbacks,
): void {
  const entry: CardEntry = {
    card,
    bounds: { left, top, right: left + w, bottom: top + h },
    callbacks,
    hovered: false,
    pressed: false,
  };
  _cardsRegistradas.push(entry);

  // Lazy-install the canvas listeners on first registration. Abort-
  // backed so world resets / re-opened dialogs don't accumulate
  // handlers.
  if (!_selecaoAbort) {
    _selecaoAbort = new AbortController();
    // The first card's `dialog` container has app via the closure
    // passed to criarDialogoSelecaoTipo. We grab the canvas via DOM
    // query. Pixi events still fire on the fallback path if no
    // canvas is found.
    const cv = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (cv) {
      cv.addEventListener('pointermove', (e: PointerEvent) => {
        const next = hitTest(e.clientX, e.clientY);
        if (next !== _hoveredCard) {
          if (_hoveredCard) {
            _hoveredCard.callbacks.onHoverChange(false);
            _hoveredCard.hovered = false;
          }
          _hoveredCard = next;
          if (next) {
            next.callbacks.onHoverChange(true);
            next.hovered = true;
          }
        }
      }, { signal: _selecaoAbort.signal });
      cv.addEventListener('pointerdown', (e: PointerEvent) => {
        const next = hitTest(e.clientX, e.clientY);
        if (next) {
          _pressedCard = next;
          next.callbacks.onPressChange(true);
          next.pressed = true;
        }
      }, { signal: _selecaoAbort.signal });
      cv.addEventListener('pointerup', (e: PointerEvent) => {
        const next = hitTest(e.clientX, e.clientY);
        if (_pressedCard) {
          _pressedCard.callbacks.onPressChange(false);
          _pressedCard.pressed = false;
          if (_pressedCard === next) {
            _pressedCard.callbacks.onTap();
          }
          _pressedCard = null;
        }
      }, { signal: _selecaoAbort.signal });
    }
  }
}

function hitTest(x: number, y: number): CardEntry | null {
  for (const e of _cardsRegistradas) {
    if ((e.card as unknown as { destroyed?: boolean }).destroyed) continue;
    const b = e.bounds;
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) {
      return e;
    }
  }
  return null;
}

/**
 * Release every DOM listener + registry entry. Called from the
 * world-destroy path or whenever the selection dialog closes.
 */
export function abortarListenersSelecao(): void {
  _selecaoAbort?.abort();
  _selecaoAbort = null;
  _cardsRegistradas.length = 0;
  _hoveredCard = null;
  _pressedCard = null;
}

/**
 * M9 weydra implementation of the tipo selection dialog. Renders the
 * dark space background, the 3 tipo cards (each with bg + ring +
 * nome + desc + hint), and dispatches hover/press/tap via DOM
 * hit-tests. Resolves the Promise<TipoJogador> when the user taps
 * a card.
 *
 * Backward-compat: same Promise<TipoJogador> return shape as the
 * Pixi path so `criarTelaSelecao` is agnostic to backend.
 */
function criarTelaSelecaoWeydra(
  app: Application,
  r: WeydraRenderer,
): Promise<TipoJogador> {
  const dpr = () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const d2 = (n: number) => n * dpr();

  // Dark space background.
  const bg = r.createGraphics(false);
  bg.zOrder = Z.UI_BACKGROUND;
  bg.rect(0, 0, d2(app.screen.width), d2(app.screen.height))
    .fill({ color: 0x0a0a18, alpha: 0.95 });

  // Dialog frame (Win95-style).
  const largCard = 220;
  const altCard = 280;
  const gap = 20;
  const dialogPad = 30;
  const totalCardsW = TIPOS.length * largCard + (TIPOS.length - 1) * gap;
  const dialogW = totalCardsW + dialogPad * 2;
  const dialogH = altCard + 120;
  const dialogX = (app.screen.width - dialogW) / 2;
  const dialogY = (app.screen.height - dialogH) / 2;

  const dialogBg = r.createGraphics(false);
  dialogBg.zOrder = Z.UI_BACKGROUND;
  dialogBg.rect(d2(dialogX), d2(dialogY), d2(dialogW), d2(dialogH)).fill({ color: 0xd4d0c8 });
  dialogBg.moveTo(d2(dialogX), d2(dialogY + dialogH)).lineTo(d2(dialogX), d2(dialogY)).lineTo(d2(dialogX + dialogW), d2(dialogY)).stroke({ color: 0xdfdfdf, width: 2 });
  dialogBg.moveTo(d2(dialogX + dialogW), d2(dialogY)).lineTo(d2(dialogX + dialogW), d2(dialogY + dialogH)).lineTo(d2(dialogX), d2(dialogY + dialogH)).stroke({ color: 0x404040, width: 2 });
  dialogBg.rect(d2(dialogX + 4), d2(dialogY + 3), d2(dialogW - 8), 22 * dpr()).fill({ color: 0x0a246a });
  dialogBg.rect(d2(dialogX + 4 + (dialogW - 8) / 3), d2(dialogY + 3), d2(dialogW - 8) * 2 / 3, 22 * dpr()).fill({ color: 0x3a6ea5, alpha: 0.7 });

  const titulo = criarText('Escolha seu Imperio', 16, 0xffffff);
  if (titulo._weydra) {
    titulo._weydra.x = d2(dialogX + 10);
    titulo._weydra.y = d2(dialogY + 5);
    titulo._weydra.zOrder = Z.UI_TEXT;
  }
  const subtitulo = criarText('O tipo define os bonus do seu imperio', 14, 0x666666);
  if (subtitulo._weydra) {
    subtitulo._weydra.x = d2(dialogX + dialogW / 2);
    subtitulo._weydra.y = d2(dialogY + 42);
    subtitulo._weydra.zOrder = Z.UI_TEXT;
  }

  // Per-card state + weydra handles.
  const cardStartX = dialogX + dialogPad;
  const cardY = dialogY + 60;
  type CardState = { hovered: boolean; pressed: boolean; bg: WeydraGraphics; ring: WeydraGraphics; nome: TextLike; desc: TextLike; hint: TextLike; };
  const cards: CardState[] = [];

  TIPOS.forEach((tipo, i) => {
    const cardX = cardStartX + i * (largCard + gap);
    const cBg = r.createGraphics(false);
    cBg.zOrder = Z.UI_BACKGROUND;
    const cRing = r.createGraphics(false);
    cRing.zOrder = Z.UI_HOVER;
    const cNome = criarText(tipo.nome, 18, tipo.cor);
    if (cNome._weydra) cNome._weydra.zOrder = Z.UI_TEXT;
    const cDesc = criarText(tipo.desc, 14, 0x222222);
    if (cDesc._weydra) cDesc._weydra.zOrder = Z.UI_TEXT;
    const cHint = criarText('Selecionar', 14, 0x222222);
    if (cHint._weydra) cHint._weydra.zOrder = Z.UI_TEXT;
    cards.push({ hovered: false, pressed: false, bg: cBg, ring: cRing, nome: cNome, desc: cDesc, hint: cHint });
  });

  const redraw = (): void => {
    TIPOS.forEach((tipo, i) => {
      const cardX = cardStartX + i * (largCard + gap);
      const dpx = d2(cardX);
      const dpy = d2(cardY);
      const dpw = d2(largCard);
      const dph = d2(altCard);
      const s = cards[i];
      const face = s.pressed ? 0xc0d8ff : 0xd4d0c8;
      s.bg.clear();
      s.bg.rect(dpx, dpy, dpw, dph).fill({ color: face, alpha: 0.95 });
      s.bg.moveTo(dpx, dpy + dph).lineTo(dpx, dpy).lineTo(dpx + dpw, dpy).stroke({ color: 0xdfdfdf, width: 2 });
      s.bg.moveTo(dpx + dpw, dpy).lineTo(dpx + dpw, dpy + dph).lineTo(dpx, dpy + dph).stroke({ color: 0x404040, width: 2 });
      s.bg.rect(dpx + 4 * dpr(), dpy + 4 * dpr(), dpw - 8 * dpr(), 3 * dpr()).fill({ color: tipo.cor });
      s.ring.clear();
      if (s.hovered) {
        s.ring.rect(dpx - 2 * dpr(), dpy - 2 * dpr(), dpw + 4 * dpr(), dph + 4 * dpr())
          .stroke({ color: 0x66ccff, width: 1, alpha: 0.6 });
      }
      if (s.nome._weydra) {
        s.nome._weydra.x = dpx + dpw / 2;
        s.nome._weydra.y = dpy + 145 * dpr();
      }
      if (s.desc._weydra) {
        s.desc._weydra.x = dpx + dpw / 2;
        s.desc._weydra.y = dpy + 195 * dpr();
      }
      if (s.hint._weydra) {
        s.hint._weydra.x = dpx + dpw / 2;
        s.hint._weydra.y = dpy + (altCard - 42 + 14) * dpr();
        s.hint._weydra.color = rgbaWithAlpha(0x222222, s.hovered ? 1.0 : 0.7);
      }
    });
  };

  const cardAt = (x: number, y: number): number => {
    for (let i = 0; i < TIPOS.length; i++) {
      const cardX = cardStartX + i * (largCard + gap);
      if (x >= cardX && x < cardX + largCard && y >= cardY && y < cardY + altCard) return i;
    }
    return -1;
  };

  let chosen: TipoJogador | null = null;
  let torndown = false;
  const teardown = (): void => {
    if (torndown) return;
    torndown = true;
    ac.abort();
    r.destroyGraphics(bg);
    r.destroyGraphics(dialogBg);
    if (titulo._weydra) r.destroyText(titulo._weydra);
    if (subtitulo._weydra) r.destroyText(subtitulo._weydra);
    for (const c of cards) {
      r.destroyGraphics(c.bg);
      r.destroyGraphics(c.ring);
      if (c.nome._weydra) r.destroyText(c.nome._weydra);
      if (c.desc._weydra) r.destroyText(c.desc._weydra);
      if (c.hint._weydra) r.destroyText(c.hint._weydra);
    }
  };

  const canvas = app.canvas;
  const ac = new AbortController();
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = toCanvasXY(ev, canvas);
    const hit = cardAt(x / dpr(), y / dpr());
    let changed = false;
    for (let i = 0; i < cards.length; i++) {
      const h = i === hit;
      if (cards[i].hovered !== h) { cards[i].hovered = h; changed = true; }
    }
    if (changed) redraw();
  }, { signal: ac.signal });
  canvas.addEventListener('pointerdown', (ev) => {
    const [x, y] = toCanvasXY(ev, canvas);
    const hit = cardAt(x / dpr(), y / dpr());
    if (hit === -1) return;
    cards[hit].pressed = true;
    redraw();
  }, { signal: ac.signal });
  canvas.addEventListener('pointerup', (ev) => {
    const [x, y] = toCanvasXY(ev, canvas);
    const hit = cardAt(x / dpr(), y / dpr());
    for (const c of cards) if (c.pressed) c.pressed = false;
    if (hit !== -1) chosen = TIPOS[hit];
    redraw();
  }, { signal: ac.signal });

  const overlay = { tick: redraw, destruir: teardown };
  const unregister = registerOverlay(overlay);
  void unregister;

  // Initial draw
  redraw();

  return new Promise<TipoJogador>((resolve) => {
    const checkChosen = (): void => {
      if (chosen) {
        const t = chosen;
        chosen = null;
        resolve(t);
        teardown();
        return;
      }
      requestAnimationFrame(checkChosen);
    };
    requestAnimationFrame(checkChosen);
  });
}
