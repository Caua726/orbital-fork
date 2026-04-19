# Mobile Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Orbital playable on phones/touch devices with pinch/drag/tap camera, double-tap/+− zoom, a hamburger sidebar, bottom-sheet panels, and a responsive HUD — without regressing desktop mouse/keyboard.

**Architecture:** A pure `ui-mode` module derives `touch | size | orientation` from config + media queries and reflects it as `<body>` classes. The canvas input handler in `src/core/player.ts` is refactored from `mousedown/mousemove/wheel` to unified `PointerEvents` with an `activePointers` map for pinch and a `lastTap` slot for double-tap. HUD adapts via CSS under `body.touch.sm[.portrait]`, with a new hamburger + drawer for the sidebar and a `bottom-sheet` helper applied to large panels.

**Tech Stack:** TypeScript, Pixi.js 8, Vite, Vitest, happy-dom, DOM PointerEvents, CSS.

**Design spec:** `docs/superpowers/specs/2026-04-18-mobile-controls-design.md`.

**Commit convention:** project uses Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `style:`). Commit + push after each task (`git push` — branch is `worktree-mobile`, tracks `origin/worktree-mobile`).

---

## Task 1: Add `ui.touchMode` to config

**Files:**
- Modify: `src/core/config.ts`

- [ ] **Step 1: Add `ui` section to `OrbitalConfig` interface**

In `src/core/config.ts`, add a new top-level `ui` block between `input` and `language`:

```ts
  input: {
    bindings: Record<string, string[]>;
  };

  ui: {
    touchMode: 'auto' | 'on' | 'off';
  };

  language: 'pt' | 'en';
```

- [ ] **Step 2: Add matching default**

In the same file inside `DEFAULTS`:

```ts
  input: {
    bindings: {},
  },

  ui: {
    touchMode: 'auto',
  },

  language: 'pt',
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the `mergeDeep` in `load()` handles missing keys for saved configs).

- [ ] **Step 4: Commit**

```bash
git add src/core/config.ts
git commit -m "feat(config): add ui.touchMode (auto|on|off)"
git push
```

---

## Task 2: `ui-mode` module — derived state + tests

**Files:**
- Create: `src/core/ui-mode.ts`
- Create: `src/core/__tests__/ui-mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/__tests__/ui-mode.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { computeUiMode } from '../ui-mode';
import { resetConfigForTest, setConfigDuranteBoot } from '../config';

function make(coarse: boolean, innerWidth: number, portrait: boolean) {
  return {
    coarsePointer: coarse,
    innerWidth,
    portrait,
  };
}

describe('computeUiMode', () => {
  beforeEach(() => resetConfigForTest());

  it('desktop mouse, auto → no touch, lg, landscape', () => {
    setConfigDuranteBoot({ ui: { touchMode: 'auto' } });
    const m = computeUiMode(make(false, 1920, false));
    expect(m.touch).toBe(false);
    expect(m.size).toBe('lg');
    expect(m.orientation).toBe('landscape');
  });

  it('phone portrait, auto → touch, sm, portrait', () => {
    setConfigDuranteBoot({ ui: { touchMode: 'auto' } });
    const m = computeUiMode(make(true, 390, true));
    expect(m.touch).toBe(true);
    expect(m.size).toBe('sm');
    expect(m.orientation).toBe('portrait');
  });

  it('tablet landscape 1024 coarse, auto → touch, md, landscape', () => {
    setConfigDuranteBoot({ ui: { touchMode: 'auto' } });
    const m = computeUiMode(make(true, 1024, false));
    expect(m.touch).toBe(true);
    expect(m.size).toBe('md');
  });

  it('big desktop + coarse pointer, auto → no touch (width > 1024)', () => {
    setConfigDuranteBoot({ ui: { touchMode: 'auto' } });
    const m = computeUiMode(make(true, 1600, false));
    expect(m.touch).toBe(false);
  });

  it('touchMode=on forces touch regardless of size/pointer', () => {
    setConfigDuranteBoot({ ui: { touchMode: 'on' } });
    const m = computeUiMode(make(false, 1920, false));
    expect(m.touch).toBe(true);
  });

  it('touchMode=off forces no-touch even on phone', () => {
    setConfigDuranteBoot({ ui: { touchMode: 'off' } });
    const m = computeUiMode(make(true, 390, true));
    expect(m.touch).toBe(false);
  });

  it('size breakpoints: <600 sm, <1024 md, else lg', () => {
    setConfigDuranteBoot({ ui: { touchMode: 'off' } });
    expect(computeUiMode(make(false, 599, false)).size).toBe('sm');
    expect(computeUiMode(make(false, 600, false)).size).toBe('md');
    expect(computeUiMode(make(false, 1023, false)).size).toBe('md');
    expect(computeUiMode(make(false, 1024, false)).size).toBe('lg');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/core/__tests__/ui-mode.test.ts`
Expected: FAIL — `Cannot find module '../ui-mode'`.

- [ ] **Step 3: Create `ui-mode.ts`**

Create `src/core/ui-mode.ts`:

```ts
import { getConfig, onConfigChange } from './config';

export type UiSize = 'sm' | 'md' | 'lg';
export type UiOrientation = 'portrait' | 'landscape';

export interface UiMode {
  touch: boolean;
  size: UiSize;
  orientation: UiOrientation;
}

export interface UiModeInputs {
  coarsePointer: boolean;
  innerWidth: number;
  portrait: boolean;
}

export function computeUiMode(inputs: UiModeInputs): UiMode {
  const mode = getConfig().ui?.touchMode ?? 'auto';
  let touch: boolean;
  if (mode === 'on') touch = true;
  else if (mode === 'off') touch = false;
  else touch = inputs.coarsePointer && inputs.innerWidth <= 1024;

  const size: UiSize =
    inputs.innerWidth < 600 ? 'sm'
    : inputs.innerWidth < 1024 ? 'md'
    : 'lg';

  const orientation: UiOrientation = inputs.portrait ? 'portrait' : 'landscape';
  return { touch, size, orientation };
}

let _current: UiMode = { touch: false, size: 'lg', orientation: 'landscape' };
let _installed = false;
let _coarseMql: MediaQueryList | null = null;
let _portraitMql: MediaQueryList | null = null;

function readInputs(): UiModeInputs {
  return {
    coarsePointer: _coarseMql?.matches ?? false,
    innerWidth: window.innerWidth,
    portrait: _portraitMql?.matches ?? (window.innerHeight > window.innerWidth),
  };
}

function applyBodyClasses(m: UiMode): void {
  const b = document.body.classList;
  b.toggle('touch', m.touch);
  b.toggle('portrait', m.orientation === 'portrait');
  b.toggle('landscape', m.orientation === 'landscape');
  b.toggle('size-sm', m.size === 'sm');
  b.toggle('size-md', m.size === 'md');
  b.toggle('size-lg', m.size === 'lg');
}

export function getUiMode(): UiMode {
  return _current;
}

export function isTouchMode(): boolean {
  return _current.touch;
}

function recompute(): void {
  const next = computeUiMode(readInputs());
  const changed =
    next.touch !== _current.touch ||
    next.size !== _current.size ||
    next.orientation !== _current.orientation;
  _current = next;
  applyBodyClasses(_current);
  if (changed) {
    window.dispatchEvent(new CustomEvent('orbital:ui-mode-changed', { detail: next }));
  }
}

export function instalarUiMode(): void {
  if (_installed) return;
  _installed = true;
  _coarseMql = window.matchMedia('(pointer: coarse)');
  _portraitMql = window.matchMedia('(orientation: portrait)');
  _coarseMql.addEventListener('change', recompute);
  _portraitMql.addEventListener('change', recompute);
  window.addEventListener('resize', recompute);
  window.addEventListener('orientationchange', recompute);
  onConfigChange(recompute);
  recompute();
}
```

- [ ] **Step 4: Run tests — verify green**

Run: `npx vitest run src/core/__tests__/ui-mode.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/ui-mode.ts src/core/__tests__/ui-mode.test.ts
git commit -m "feat(ui): ui-mode module with touch/size/orientation detection"
git push
```

---

## Task 3: Install `ui-mode` during boot

**Files:**
- Modify: `src/main.ts` (near the top of the exported boot function, before camera/HUD setup)

- [ ] **Step 1: Import and install**

Find the top-level boot function (the function that runs `document.body.appendChild(app.canvas)`, around line 529). Add the import at the top of `main.ts`:

```ts
import { instalarUiMode } from './core/ui-mode';
```

And near the first lines of the boot function (before any HUD/canvas setup — a good spot is right after `document.body.style.margin = '0';` at line 527):

```ts
  instalarUiMode();

  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.appendChild(app.canvas);
```

Place `instalarUiMode()` BEFORE the `margin` assignment so body classes exist before CSS referencing them takes effect. Adjusted order:

```ts
  instalarUiMode();
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.appendChild(app.canvas);
```

- [ ] **Step 2: Verify**

Run: `npm run dev`
Open `http://localhost:5173` in Chrome. Open DevTools Console, run:

```js
document.body.className
```

Expected: contains `landscape size-lg` (or `size-md` depending on window width). On a desktop without touch it should NOT contain `touch`.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(boot): install ui-mode listener during main boot"
git push
```

---

## Task 4: Touch-mode row in settings panel

**Files:**
- Modify: `src/core/i18n/dict.ts`
- Modify: `src/ui/settings-panel.ts`

- [ ] **Step 1: Add i18n keys**

In `src/core/i18n/dict.ts`, find the block with `'settings.row.edge_scroll'` entries and add:

```ts
  'settings.row.touch_mode': { pt: 'Modo toque', en: 'Touch mode' },
  'settings.touch_mode.auto': { pt: 'Automático', en: 'Automatic' },
  'settings.touch_mode.on':   { pt: 'Sempre ligado', en: 'Always on' },
  'settings.touch_mode.off':  { pt: 'Sempre desligado', en: 'Always off' },
  'tooltips.touchMode': {
    pt: 'Ativa gestos de toque (arrastar, pinça, duplo-toque) e HUD adaptada. "Automático" detecta pelo dispositivo.',
    en: 'Enables touch gestures (drag, pinch, double-tap) and adaptive HUD. "Automatic" detects by device.',
  },
```

- [ ] **Step 2: Extend `TooltipKey` type and add the row**

In `src/ui/settings-panel.ts`:

At the `TooltipKey` union (around line 36–40), add `'touchMode'`:

```ts
type TooltipKey =
  | 'qualidade' | 'fullscreen' | 'scanlines' | 'fps' | 'ram' | 'fpsCap' | 'vsync' | 'renderScale'
  | 'renderer' | 'webglVersion' | 'gpuPref' | 'verInfo' | 'orbitas'
  | 'starfield' | 'fantasmas' | 'shaderLive' | 'autosave' | 'saveMode'
  | 'confirmar' | 'edge' | 'touchMode';
```

Then insert a new row block into the gameplay tab, right AFTER the `// Edge-scroll` block (around line 1266, before `// Idioma`):

```ts
  // Touch mode
  {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const lbl = document.createElement('label');
    lbl.textContent = t('settings.row.touch_mode');
    row.appendChild(comHelp(lbl, tooltip('touchMode')));
    const select = criarSelect([
      ['auto', t('settings.touch_mode.auto')],
      ['on',   t('settings.touch_mode.on')],
      ['off',  t('settings.touch_mode.off')],
    ], getConfig().ui?.touchMode ?? 'auto');
    select.addEventListener('change', () => {
      const val = select.dataset.value as 'auto' | 'on' | 'off';
      setConfig({ ui: { ...getConfig().ui, touchMode: val } });
    });
    row.appendChild(select);
    body.appendChild(row);
  }
```

NOTE: `rowWithLabel` is what the other rows use, but it doesn't accept tooltip keys that aren't in the pre-defined set. Using the manual `div + label + comHelp` pattern avoids editing the helper. Verify `comHelp` is already imported (it is — line 4).

- [ ] **Step 3: Also add to gameplay reset path**

The `tab === 'gameplay'` reset block (around line 1431) resets `gameplay` only. `ui` config is its own namespace — no change needed; touchMode is NOT reset by the gameplay tab's "Reset this tab". That's intentional since it's about UI, not gameplay.

- [ ] **Step 4: Typecheck and manually test**

Run: `npx tsc --noEmit`
Expected: no errors.

Then `npm run dev`, open settings → aba Jogabilidade. Confirm the "Modo toque" select appears with three options and persists across reload.

- [ ] **Step 5: Commit**

```bash
git add src/core/i18n/dict.ts src/ui/settings-panel.ts
git commit -m "feat(settings): touchMode select in gameplay tab"
git push
```

---

## Task 5: Pure pointer-gesture helpers + tests

**Files:**
- Create: `src/core/input/pointer-gestures.ts`
- Create: `src/core/input/__tests__/pointer-gestures.test.ts`

These are pure functions the canvas handler will call — easy to unit test.

- [ ] **Step 1: Write failing tests**

Create `src/core/input/__tests__/pointer-gestures.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  distance, midpoint, isTap, isDoubleTap,
  TAP_MAX_MOVE, TAP_MAX_DURATION_MS, DBL_TAP_MAX_GAP_MS, DBL_TAP_MAX_DIST,
} from '../pointer-gestures';

describe('pointer-gestures', () => {
  it('distance', () => {
    expect(distance({x:0,y:0},{x:3,y:4})).toBe(5);
  });

  it('midpoint', () => {
    expect(midpoint({x:0,y:0},{x:10,y:20})).toEqual({x:5,y:10});
  });

  it('isTap: short + small move', () => {
    expect(isTap({dist: TAP_MAX_MOVE - 1, duration: TAP_MAX_DURATION_MS - 1})).toBe(true);
  });

  it('isTap: too much move', () => {
    expect(isTap({dist: TAP_MAX_MOVE + 1, duration: 50})).toBe(false);
  });

  it('isTap: too long', () => {
    expect(isTap({dist: 1, duration: TAP_MAX_DURATION_MS + 1})).toBe(false);
  });

  it('isDoubleTap: close in time and space', () => {
    const prev = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(prev, { time: 1000 + DBL_TAP_MAX_GAP_MS - 1, x: 110, y: 100 })).toBe(true);
  });

  it('isDoubleTap: too far in time', () => {
    const prev = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(prev, { time: 1000 + DBL_TAP_MAX_GAP_MS + 1, x: 100, y: 100 })).toBe(false);
  });

  it('isDoubleTap: too far in space', () => {
    const prev = { time: 1000, x: 100, y: 100 };
    expect(isDoubleTap(prev, { time: 1100, x: 100 + DBL_TAP_MAX_DIST + 1, y: 100 })).toBe(false);
  });

  it('isDoubleTap: null prev', () => {
    expect(isDoubleTap(null, { time: 1000, x: 100, y: 100 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify fails**

Run: `npx vitest run src/core/input/__tests__/pointer-gestures.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Create `src/core/input/pointer-gestures.ts`:

```ts
export interface Point { x: number; y: number }

export const TAP_MAX_MOVE = 5;
export const TAP_MAX_DURATION_MS = 250;
export const DBL_TAP_MAX_GAP_MS = 300;
export const DBL_TAP_MAX_DIST = 40;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function isTap(info: { dist: number; duration: number }): boolean {
  return info.dist <= TAP_MAX_MOVE && info.duration <= TAP_MAX_DURATION_MS;
}

export interface TapRecord { time: number; x: number; y: number }

export function isDoubleTap(prev: TapRecord | null, curr: TapRecord): boolean {
  if (!prev) return false;
  const dt = curr.time - prev.time;
  const dd = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  return dt <= DBL_TAP_MAX_GAP_MS && dd <= DBL_TAP_MAX_DIST;
}
```

- [ ] **Step 4: Run tests — verify green**

Run: `npx vitest run src/core/input/__tests__/pointer-gestures.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/input/pointer-gestures.ts src/core/input/__tests__/pointer-gestures.test.ts
git commit -m "feat(input): pointer-gesture pure helpers + tests"
git push
```

---

## Task 6: Refactor `player.ts` canvas input to PointerEvents

**Files:**
- Modify: `src/core/player.ts` (replace the three `canvas.addEventListener('mouse*'` blocks and add pinch/tap handling — lines 206–366)

This is the heart of the work. Keep ALL existing click-arbitration logic bit-for-bit; only the event mechanism changes.

- [ ] **Step 1: Add imports and state**

At the top of `src/core/player.ts`, add:

```ts
import {
  distance, midpoint, isTap, isDoubleTap,
  type TapRecord,
} from './input/pointer-gestures';
```

- [ ] **Step 2: Replace the input block inside `configurarCamera`**

Locate the block starting at `canvas.addEventListener('contextmenu', ...)` (line 204) and ending at the closing `canvas.addEventListener('wheel', ...)` (around line 366).

Replace everything from `canvas.addEventListener('contextmenu', ...)` through the end of the `wheel` block with the following:

```ts
  canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault(), { signal });

  type PointerInfo = { x: number; y: number; startX: number; startY: number; startTime: number; button: number };
  const activePointers = new Map<number, PointerInfo>();
  let pinch: { initialDist: number; initialZoom: number; anchorSx: number; anchorSy: number } | null = null;
  let lastTap: TapRecord | null = null;

  const getWorldHit = (sx: number, sy: number) => {
    const world = screenToWorld(sx, sy, app);
    return {
      nave: encontrarNaveNoPonto(world.x, world.y, mundo),
      planeta: encontrarPlanetaNoPonto(world.x, world.y, mundo, true),
      sol: encontrarSolNoPonto(world.x, world.y, mundo, true),
    };
  };

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    // Only care about primary button for mouse; touch/pen are always button 0.
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* older browsers */ }

    const info: PointerInfo = {
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      startTime: performance.now(),
      button: e.button,
    };
    activePointers.set(e.pointerId, info);

    if (activePointers.size === 1) {
      // First pointer: matches today's left-button logic.
      if (e.button === 0) {
        const hit = getWorldHit(e.clientX, e.clientY);
        clickInfo = hit;
        clickStartScreen.x = e.clientX;
        clickStartScreen.y = e.clientY;
        if (!hit.nave && !hit.planeta && !hit.sol) {
          cameraDragging = true;
          cameraLastMouse.x = e.clientX;
          cameraLastMouse.y = e.clientY;
        }
      } else if (e.button === 1 || e.button === 2) {
        // Middle/right mouse button forces drag.
        cameraDragging = true;
        cameraLastMouse.x = e.clientX;
        cameraLastMouse.y = e.clientY;
      }
    } else if (activePointers.size === 2) {
      // Second pointer: start pinch. Cancel any in-progress drag.
      cameraDragging = false;
      const [a, b] = Array.from(activePointers.values());
      const mid = midpoint(a, b);
      pinch = {
        initialDist: distance(a, b),
        initialZoom: camera.zoom,
        anchorSx: mid.x,
        anchorSy: mid.y,
      };
    }
  }, { signal });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    const info = activePointers.get(e.pointerId);
    if (!info) return;
    info.x = e.clientX;
    info.y = e.clientY;

    if (pinch && activePointers.size >= 2) {
      const pts = Array.from(activePointers.values()).slice(0, 2) as [PointerInfo, PointerInfo];
      const d = distance(pts[0], pts[1]);
      if (d > 0 && pinch.initialDist > 0) {
        const ratio = d / pinch.initialDist;
        aplicarZoom(pinch.initialZoom * ratio, pinch.anchorSx, pinch.anchorSy);
      }
      return;
    }

    if (cameraDragging && activePointers.size === 1) {
      const dx = e.clientX - cameraLastMouse.x;
      const dy = e.clientY - cameraLastMouse.y;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      cameraLastMouse.x = e.clientX;
      cameraLastMouse.y = e.clientY;
    }
  }, { signal });

  const finalizePointer = (e: PointerEvent, cancelled: boolean) => {
    const info = activePointers.get(e.pointerId);
    if (!info) return;
    activePointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    // End pinch when below 2 pointers; do NOT resume drag mid-gesture.
    if (pinch && activePointers.size < 2) {
      pinch = null;
      if (activePointers.size === 0) {
        cameraDragging = false;
      }
      return;
    }

    if (cameraDragging && activePointers.size === 0) {
      cameraDragging = false;
    }

    if (cancelled) {
      clickInfo = null;
      return;
    }

    // Only the primary-button release triggers the click-arbitration path —
    // matches today's `if (e.button !== 0) return;` at mouseup.
    if (info.button !== 0) {
      clickInfo = null;
      return;
    }
    if (activePointers.size > 0) {
      // Another pointer still down — not a clean tap.
      clickInfo = null;
      return;
    }
    if (consumirInteracaoUi()) {
      clickInfo = null;
      return;
    }

    const movedX = e.clientX - info.startX;
    const movedY = e.clientY - info.startY;
    const movedDist = Math.hypot(movedX, movedY);
    const duration = performance.now() - info.startTime;
    const tap = isTap({ dist: movedDist, duration });

    // Double-tap zoom: only fires for true taps on empty-ish space. Anchor
    // at the release screen point so the tapped location stays in view.
    if (tap) {
      const now = performance.now();
      const currentTap: TapRecord = { time: now, x: e.clientX, y: e.clientY };
      if (isDoubleTap(lastTap, currentTap)) {
        const rect = canvas.getBoundingClientRect();
        aplicarZoom(camera.zoom * 1.5, e.clientX - rect.left, e.clientY - rect.top);
        lastTap = null;
        clickInfo = null;
        return;
      }
      lastTap = currentTap;
    }

    if (movedDist < 5) {
      const naveSelecionada = obterNaveSelecionada(mundo);
      const destinoMapa = screenToWorld(e.clientX, e.clientY, app);

      // Click-arbitration priority (highest to lowest):
      //   1. 'target_colonizadora' mode + planet → dispatch colonizadora
      //   2. 'move_colonizadora' mode + any click → dispatch free move
      //   3. Click on a ship                 → select that ship
      //   4. 'origem'/'destino' mode + planet → set cargueira route
      //   5. 'mover' mode + empty space      → add waypoint
      //   6. Click on a planet                → select that planet
      //   7. Click on empty space             → clear selection
      if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && comandoNave.tipo === 'target_colonizadora'
      ) {
        if (clickInfo?.planeta) {
          const ok = enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.planeta);
          if (ok) { cancelarComandoNave(); somClique(); }
        } else if (clickInfo?.sol) {
          const ok = enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.sol);
          if (ok) { cancelarComandoNave(); somClique(); }
        } else {
          mostrarNotificacao(t('notificacao.clique_alvo'), '#ffcc66');
        }
        clickInfo = null;
        return;
      }

      if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && comandoNave.tipo === 'move_colonizadora'
      ) {
        if (clickInfo?.planeta) {
          enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.planeta);
        } else if (clickInfo?.sol) {
          enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.sol);
        } else {
          enviarNaveParaPosicao(mundo, naveSelecionada, destinoMapa.x, destinoMapa.y);
        }
        cancelarComandoNave();
        somClique();
        clickInfo = null;
        return;
      }

      if (clickInfo?.nave) {
        cancelarComandoNave();
        selecionarNave(mundo, clickInfo.nave);
        somClique();
      } else if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && (comandoNave.tipo === 'origem' || comandoNave.tipo === 'destino')
        && clickInfo?.planeta?.dados.dono === 'jogador'
      ) {
        definirPlanetaRotaCargueira(naveSelecionada, comandoNave.tipo, clickInfo.planeta);
        cancelarComandoNave();
        somClique();
      } else if (
        naveSelecionada
        && comandoNave?.nave === naveSelecionada
        && comandoNave.tipo === 'mover'
        && !clickInfo?.planeta
        && !clickInfo?.sol
      ) {
        if (comandoNave.pontos.length < 5) {
          comandoNave.pontos.push({ x: destinoMapa.x, y: destinoMapa.y });
          atualizarPreviewComandoNave();
          somClique();
        }
      } else if (clickInfo?.planeta) {
        cancelarComandoNave();
        selecionarPlaneta(mundo, clickInfo.planeta);
        somClique();
        void abrirPlanetaDrawer(clickInfo.planeta, mundo);
      } else {
        cancelarComandoNave();
        limparSelecoes(mundo);
        fecharPlanetaDrawer();
      }
    }

    clickInfo = null;
  };

  canvas.addEventListener('pointerup', (e: PointerEvent) => finalizePointer(e, false), { signal });
  canvas.addEventListener('pointercancel', (e: PointerEvent) => finalizePointer(e, true), { signal });

  canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    aplicarZoom(camera.zoom * factor, sx, sy);
  }, { passive: false, signal });
```

- [ ] **Step 3: Remove now-unused `window.addEventListener('mouseup'...)` block**

The old `window.addEventListener('mouseup', ...)` block (lines 243–357 in the original) has been consolidated into `finalizePointer`. Make sure it is deleted in the replacement. The only `window`-scoped listener that should remain in `player.ts` is inside `instalarEdgeScroll` (that stays untouched).

- [ ] **Step 4: Add `touch-action: none` to the canvas**

Still in `src/core/player.ts`, at the top of `configurarCamera` right after `const canvas = app.canvas;`:

```ts
  const canvas = app.canvas;
  canvas.style.touchAction = 'none';
```

Rationale: prevents the browser from stealing single-finger pan (page scroll) and two-finger gestures (page zoom).

- [ ] **Step 5: Typecheck and run existing tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Manual desktop regression check**

Run: `npm run dev`
In a desktop browser:
- Left-click + drag empty area → camera pans. PASS if it does.
- Wheel up/down → zoom in/out anchored at cursor. PASS.
- Right-click or middle-click + drag → camera pans. PASS.
- Click a planet → planet-drawer opens.
- Click a ship → ship selected.
- In `mover` mode, click empty space → waypoint added.
- ESC menu, keyboard pan/zoom → unaffected.

If ANY of these regress, stop and diagnose before continuing.

- [ ] **Step 7: Manual touch check via DevTools device mode**

Open DevTools → Toggle device toolbar → iPhone 14.
- Drag empty area → camera pans.
- Tap planet → drawer opens.
- Double-tap empty area → zoom in.
- Hold Ctrl + drag (DevTools multi-touch emulation) → pinch zoom.

- [ ] **Step 8: Commit**

```bash
git add src/core/player.ts
git commit -m "refactor(input): unify canvas input via PointerEvents (pinch + double-tap)"
git push
```

---

## Task 7: Floating +/- zoom controls

**Files:**
- Create: `src/ui/zoom-controls.ts`
- Modify: `src/main.ts` (mount the controls after mundo is created)

- [ ] **Step 1: Create the component**

Create `src/ui/zoom-controls.ts`:

```ts
import { zoomIn, zoomOut } from '../core/player';
import { isTouchMode } from '../core/ui-mode';
import { marcarInteracaoUi } from './interacao-ui';

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .zoom-controls {
      position: fixed;
      right: var(--hud-margin, 16px);
      bottom: calc(var(--hud-margin, 16px) + 140px);
      display: none;
      flex-direction: column;
      gap: 8px;
      z-index: 450;
      pointer-events: auto;
    }
    body.touch .zoom-controls { display: flex; }
    .zoom-controls button {
      width: 48px; height: 48px;
      border-radius: 10px;
      border: 1px solid var(--hud-border, rgba(255,255,255,0.35));
      background: rgba(10,20,35,0.75);
      color: var(--hud-text, #e8f2ff);
      font-size: 22px;
      font-family: "Silkscreen", "VT323", monospace;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      user-select: none;
      touch-action: manipulation;
    }
    .zoom-controls button:active {
      background: rgba(30,60,100,0.9);
    }
  `;
  document.head.appendChild(style);
}

export function criarZoomControls(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();
  const wrap = document.createElement('div');
  wrap.className = 'zoom-controls';
  wrap.setAttribute('data-ui', 'true');

  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      marcarInteracaoUi();
      fn();
    });
    return b;
  };

  wrap.appendChild(mk('+', () => zoomIn()));
  wrap.appendChild(mk('−', () => zoomOut()));

  _container = wrap;
  document.body.appendChild(wrap);
  // Re-render is automatic via CSS on body.touch; nothing else to do.
  void isTouchMode;  // keep import referenced for potential future use
  return wrap;
}

export function destruirZoomControls(): void {
  if (_container) {
    _container.remove();
    _container = null;
  }
}
```

- [ ] **Step 2: Mount during boot after `configurarCamera`**

In `src/main.ts`, add import:

```ts
import { criarZoomControls } from './ui/zoom-controls';
```

Find the function that calls `configurarCamera(app, mundo)` (inside the "start game" path, around the section that creates the actual `mundo` container — look for `app.stage.addChild(mundo.container);` near line 771). Right after `configurarCamera` is called, add:

```ts
  criarZoomControls();
```

If `configurarCamera` is called multiple times (start / load-game), mount once — the `_container` guard in `criarZoomControls` makes it idempotent.

- [ ] **Step 3: Manual test**

Run: `npm run dev`. On desktop: NO zoom controls visible (good). Open DevTools device mode (iPhone): `+` and `−` buttons appear lower-right. Tap them — zoom changes. Enable `touchMode=on` in settings on desktop → buttons appear.

- [ ] **Step 4: Commit**

```bash
git add src/ui/zoom-controls.ts src/main.ts
git commit -m "feat(ui): floating +/- zoom controls for touch mode"
git push
```

---

## Task 8: Sidebar → hamburger + drawer on mobile

**Files:**
- Modify: `src/ui/sidebar.ts`

The existing sidebar stays a vertical panel on desktop. On mobile (`body.touch.size-sm`, or `body.touch.portrait` at `size-md`), the sidebar becomes an off-canvas drawer opened by a fixed hamburger button.

- [ ] **Step 1: Update `injectStyles()` with mobile rules**

In `src/ui/sidebar.ts`, replace the CSS inside `injectStyles` by appending the following rules at the end of the `style.textContent` template (keep existing rules, append these before the closing backtick):

```css
    /* Mobile drawer behavior */
    .sidebar-hamburger {
      display: none;
      position: fixed;
      top: 12px;
      left: 12px;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      border: 1px solid var(--hud-border, rgba(255,255,255,0.35));
      background: rgba(10,20,35,0.75);
      color: var(--hud-text, #e8f2ff);
      z-index: 501;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-family: "Silkscreen", "VT323", monospace;
      touch-action: manipulation;
    }
    body.touch.size-sm .sidebar-hamburger,
    body.touch.portrait.size-md .sidebar-hamburger {
      display: flex;
    }

    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 499;
    }
    body.touch.size-sm.sidebar-open .sidebar-backdrop,
    body.touch.portrait.size-md.sidebar-open .sidebar-backdrop {
      display: block;
    }

    body.touch.size-sm .sidebar,
    body.touch.portrait.size-md .sidebar {
      top: 0 !important;
      bottom: 0 !important;
      left: 0 !important;
      transform: translateX(-100%) !important;
      height: 100vh;
      width: min(72vw, 280px);
      background: rgba(6,12,20,0.92);
      border-right: 1px solid var(--hud-border, rgba(255,255,255,0.2));
      transition: transform 220ms ease;
      z-index: 500;
      padding-top: 64px;
      justify-content: flex-start;
      gap: 6px;
    }
    body.touch.size-sm.sidebar-open .sidebar,
    body.touch.portrait.size-md.sidebar-open .sidebar {
      transform: translateX(0) !important;
    }
```

- [ ] **Step 2: Create hamburger + backdrop elements in `criarSidebar`**

In `criarSidebar`, after `document.body.appendChild(sidebar);`, add:

```ts
  // Hamburger trigger (mobile only, driven by CSS)
  const hamburger = document.createElement('button');
  hamburger.type = 'button';
  hamburger.className = 'sidebar-hamburger';
  hamburger.setAttribute('data-ui', 'true');
  hamburger.setAttribute('aria-label', 'menu');
  hamburger.textContent = '☰';
  hamburger.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
  document.body.appendChild(hamburger);

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.setAttribute('data-ui', 'true');
  backdrop.addEventListener('click', () => {
    document.body.classList.remove('sidebar-open');
  });
  document.body.appendChild(backdrop);

  // Close drawer when a nav item is clicked on mobile.
  sidebar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.sidebar-btn')) {
      document.body.classList.remove('sidebar-open');
    }
  });
```

- [ ] **Step 3: Typecheck and manually test**

Run: `npx tsc --noEmit`
Expected: no errors.

`npm run dev` — DevTools device mode (iPhone 14):
- Sidebar is hidden by default.
- Hamburger visible upper-left.
- Tap hamburger → drawer slides in from the left.
- Tap backdrop → drawer slides out.
- Tap a sidebar item → drawer auto-closes.

Desktop (large window): sidebar behaves exactly as before; no hamburger visible.

- [ ] **Step 4: Commit**

```bash
git add src/ui/sidebar.ts
git commit -m "feat(hud): mobile sidebar drawer with hamburger + backdrop"
git push
```

---

## Task 9: Bottom-sheet layout for large panels

**Files:**
- Create: `src/ui/bottom-sheet.css.ts` (tiny helper that injects global CSS once)
- Modify: `src/ui/planet-drawer.ts`, `src/ui/ship-panel.ts`, `src/ui/build-panel.ts`, `src/ui/colonizer-panel.ts` (add a shared class to the top-level container)

Strategy: a single CSS class (`bottom-sheet-capable`) added to each big panel's root element. Media rules switch these panels to bottom-sheet layout when `body.touch.size-sm.portrait`.

- [ ] **Step 1: Create the CSS helper**

Create `src/ui/bottom-sheet.css.ts`:

```ts
let _injected = false;

export function injectBottomSheetStyles(): void {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.textContent = `
    body.touch.size-sm.portrait .bottom-sheet-capable {
      position: fixed !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      top: auto !important;
      width: 100vw !important;
      max-width: 100vw !important;
      max-height: 85vh !important;
      border-radius: 16px 16px 0 0 !important;
      transform: translateY(0) !important;
      animation: orbital-bottom-sheet-in 220ms ease;
      overflow-y: auto;
    }
    @keyframes orbital-bottom-sheet-in {
      from { transform: translateY(100%); }
      to   { transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}
```

- [ ] **Step 2: Apply class + inject styles in each panel**

For EACH of the four panel files, at the top of the function that creates the root container, add the class and inject styles. Example for `src/ui/planet-drawer.ts` — find where the modal/panel root element is created (around line 522 where `modal.addEventListener('pointerdown'` appears means the `modal` variable exists earlier). Locate the `const modal = document.createElement('div')` (or equivalent) and right after its creation add:

```ts
modal.classList.add('bottom-sheet-capable');
```

And at the top of the file imports:

```ts
import { injectBottomSheetStyles } from './bottom-sheet.css';
```

And inside the function that mounts the panel (before appending to body), call:

```ts
injectBottomSheetStyles();
```

Repeat the same three edits (import, `injectBottomSheetStyles()` call, `classList.add('bottom-sheet-capable')` on the panel root) for:
- `src/ui/ship-panel.ts` — target the `panel` root element referenced at line 543.
- `src/ui/build-panel.ts` — target the `panel` element referenced at line 674.
- `src/ui/colonizer-panel.ts` — target the `panel` element at line 1085 (the main panel, not `movePanel` or the joystick).

If multiple roots exist in a file (e.g., a backdrop + modal), add the class ONLY to the inner content panel (the one with visible background), not the fullscreen backdrop.

- [ ] **Step 3: Typecheck and manually test**

Run: `npx tsc --noEmit`
Expected: no errors.

`npm run dev` — DevTools iPhone portrait:
- Open planet drawer → slides up from bottom, occupies full width, ≤85vh.
- Open ship panel, build panel, colonizer panel → same behavior.
- Rotate to landscape → panels return to their normal side-docked layout.

Desktop: no visual change.

- [ ] **Step 4: Commit**

```bash
git add src/ui/bottom-sheet.css.ts src/ui/planet-drawer.ts src/ui/ship-panel.ts src/ui/build-panel.ts src/ui/colonizer-panel.ts
git commit -m "feat(hud): bottom-sheet layout for large panels in mobile portrait"
git push
```

---

## Task 10: Responsive HUD tweaks (top HUD, minimap, modals, touch targets)

**Files:**
- Create: `src/ui/mobile.css.ts` (one helper that injects all global mobile-adjustment CSS at boot)
- Modify: `src/main.ts` (call the injector during boot)

Single CSS file centralizes the "shrink/reflow" rules so individual components stay simple.

- [ ] **Step 1: Create `src/ui/mobile.css.ts`**

```ts
let _injected = false;

export function injectMobileStyles(): void {
  if (_injected) return;
  _injected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Touch targets: all buttons ≥44px in touch mode */
    body.touch button,
    body.touch .sidebar-btn,
    body.touch .settings-select-display {
      min-height: 44px;
    }

    /* Top HUD density: shrink paddings on small portrait */
    body.touch.size-sm.portrait .resource-bar,
    body.touch.size-sm.portrait .credits-bar,
    body.touch.size-sm.portrait .empire-badge {
      font-size: 11px !important;
      padding: 4px 6px !important;
    }
    body.touch.size-sm.portrait .credits-bar .label,
    body.touch.size-sm.portrait .credits-bar-label {
      display: none;
    }

    /* Minimap: shrink in sm */
    body.touch.size-sm .minimap,
    body.touch.size-sm .minimapa {
      transform: scale(0.7);
      transform-origin: bottom left;
    }

    /* Modals fill the screen in sm */
    body.touch.size-sm .modal,
    body.touch.size-sm .settings-overlay,
    body.touch.size-sm .main-menu,
    body.touch.size-sm .pause-menu,
    body.touch.size-sm .new-world-modal,
    body.touch.size-sm .save-modal,
    body.touch.size-sm .lore-modal,
    body.touch.size-sm .confirm-dialog {
      width: 100vw !important;
      max-width: 100vw !important;
      height: 100vh !important;
      max-height: 100vh !important;
      border-radius: 0 !important;
      overflow-y: auto;
    }
  `;
  document.head.appendChild(style);
}
```

NOTE: some class names above are best-guesses based on the module names. After injecting, verify with DevTools that each selector actually matches. If a class name is wrong, update the selector — grep for `className =` or `class="..."` in the target component file.

- [ ] **Step 2: Verify/fix selectors**

For each selector above, confirm it matches something. Commands:

Run: `grep -rn "className.*resource-bar\|class=\"resource-bar\|'resource-bar'" src/ui/resource-bar.ts`
Run: `grep -rn "className.*credits-bar\|'credits-bar'" src/ui/credits-bar.ts`
Run: `grep -rn "className.*empire-badge\|'empire-badge'" src/ui/empire-badge.ts`
Run: `grep -rn "className.*minimap\|'minimap'" src/ui/minimap.ts src/ui/minimapa.ts`
Run: `grep -rn "className.*modal\|'modal'\|'main-menu'\|'pause-menu'\|'new-world-modal'\|'save-modal'\|'lore-modal'\|'confirm-dialog'\|'settings-overlay'" src/ui/main-menu.ts src/ui/pause-menu.ts src/ui/new-world-modal.ts src/ui/save-modal.ts src/ui/lore-modal.ts src/ui/confirm-dialog.ts src/ui/settings-panel.ts`

For each that returns no match, either (a) change the selector in `mobile.css.ts` to an actually-present class, or (b) add the expected class to that component's root element.

- [ ] **Step 3: Call injector during boot**

In `src/main.ts`, add import:

```ts
import { injectMobileStyles } from './ui/mobile.css';
```

Call `injectMobileStyles()` right after `instalarUiMode()` in the boot function.

- [ ] **Step 4: Manual test on iPhone 14 (DevTools device mode)**

Portrait:
- Top HUD doesn't overflow; credits label hidden, number visible.
- Minimap visibly smaller.
- Open settings modal → fullscreen, scrolls.
- Main menu, pause menu, lore, save, confirm dialogs → fullscreen.
- All buttons feel tappable (≥44px).

Landscape: panels revert to side-docked; top HUD still smaller but layout normal.

Desktop (wide window, no touch): zero visual change.

- [ ] **Step 5: Commit**

```bash
git add src/ui/mobile.css.ts src/main.ts
git commit -m "feat(hud): responsive CSS for small/portrait touch screens"
git push
```

---

## Task 11: Run full test suite + final integration check

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: every test green. If any new failure surfaces, trace it back to the changed module and fix before continuing.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: successful production build.

- [ ] **Step 4: Desktop regression walkthrough**

Run: `npm run dev` in a wide desktop browser (no touch).

Confirm all of the below match pre-change behavior exactly:
- Camera pan via left-click drag empty; via right-click/middle-click anywhere.
- Wheel zoom anchored at cursor.
- Click planet → drawer opens. Click ship → ship selected. Click empty → deselect + drawer closes.
- `mover` waypoint mode: click empty adds waypoints, click button twice commits.
- `target_colonizadora`, `move_colonizadora`, `origem`, `destino` flows still work.
- Keyboard pan/zoom, Escape, space/1/2/3 speed keys unchanged.
- Settings panel opens, all rows present including new Touch mode row.
- Config round-trips (change touchMode → reload → still saved).

- [ ] **Step 5: Mobile walkthrough via DevTools**

Device toolbar → iPhone 14, then iPad (portrait and landscape).

Portrait phone:
- `body.classList` contains `touch size-sm portrait`.
- Hamburger visible, sidebar hidden. Drawer open/close works.
- Planet drawer / ship panel / build panel / colonizer panel: bottom-sheet with slide-up animation.
- Zoom +/- buttons visible lower-right.
- Double-tap on empty space zooms in.
- One-finger drag pans camera.
- Pinch (Ctrl+drag in DevTools) zooms.

Landscape phone:
- Hamburger still visible at size-sm.
- Panels dock to side again (not bottom-sheet).

iPad landscape:
- `body.classList` contains `touch size-md landscape`.
- Sidebar visible as desktop-style panel (no hamburger).
- Zoom +/- buttons still visible (user's in touch mode).
- All gestures work.

- [ ] **Step 6: Touch-mode toggle round-trip**

In a desktop (no touch) browser, open settings → Jogabilidade → Modo toque → **Sempre ligado**.
- Zoom +/- buttons should appear.
- Body class `touch` present.
- At narrow window sizes, mobile HUD kicks in.

Switch to **Sempre desligado** on a simulated phone: touch class removed, desktop HUD returns.

- [ ] **Step 7: Final commit if any fix-ups were needed**

If steps 1–6 needed corrections, commit them:

```bash
git add -A
git commit -m "fix(mobile): <describe the specific fix>"
git push
```

If nothing to commit, just push any outstanding commits (already pushed each task, but double-check):

```bash
git push
```

- [ ] **Step 8: Announce done**

Plan complete. The mobile-controls branch is ready for review/PR.

---

## Self-review notes

- **Spec coverage:** Section 1 (detection) → Tasks 1–4. Section 2 (pointer input + zoom buttons + touch-action) → Tasks 5–7. Section 3 (HUD) → Tasks 8–10. Section 4 (testing) → Tasks 2, 5, 11.
- **Types stay consistent:** `UiMode`, `TapRecord`, `PointerInfo` introduced once and reused. `computeUiMode` name matches across plan+tests.
- **No placeholders:** every code block is complete. The one conditional is in Task 10 Step 2 where selectors must be verified — the step provides exact grep commands and what to do if a selector misses.
- **Desktop parity guardrails:** Task 6 Step 6, Task 11 Step 4 both require explicit regression checks before moving on.
