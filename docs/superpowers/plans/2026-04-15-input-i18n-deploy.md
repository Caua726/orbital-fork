# Input + i18n + Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize keyboard input into a rebindable dispatcher, internationalize the game UI (PT/EN), and set up automatic GitHub Pages deployment.

**Architecture:** Three independent subsystems executed in phases. The input system (actions + keymap + dispatcher) replaces scattered keydown listeners and adds a rebind UI in the Jogabilidade settings tab. The i18n system (flat dictionary + `t()` function) extracts ~180 hardcoded strings and adds live language switching with a fade-overlay transition. The deploy is a Vite base-path config + GitHub Actions workflow.

**Tech Stack:** TypeScript 6, Pixi.js 8.17, Vitest, Web APIs (KeyboardEvent.code), GitHub Actions (actions/deploy-pages@v4).

**Spec:** `docs/superpowers/specs/2026-04-15-input-i18n-deploy-design.md`

**Pre-requisites:** Save/Load (spec 1) and Settings (spec 2) must be **fully implemented** first. Specifically, this plan depends on:
- `src/core/config.ts` having `onConfigChange()` (observer pattern from Settings spec)
- `setConfig()` using `mergeDeep` (not shallow spread — from Settings spec)
- `src/ui/settings-panel.ts` having the Jogabilidade tab (from Settings spec)
- `src/ui/toast.ts` existing (from Save/Load spec)
- vitest working (`npm run test` passes)

If Settings is NOT implemented yet, Tasks 3, 8, 12-16 will fail on missing imports.

**Execution order:** Phase C (deploy) first (smallest, unblocks CI), then Phase A (input), then Phase B (i18n — largest, migrates input labels too).

---

## File Map

**New files (Phase A — Input):**

```
src/core/input/actions.ts                        # action constants + metadata
src/core/input/keymap.ts                         # active keymap resolution
src/core/input/dispatcher.ts                     # single global listener
src/core/input/__tests__/keymap.test.ts
src/core/input/__tests__/dispatcher.test.ts
```

**New files (Phase B — i18n):**

```
src/core/i18n/dict.ts                            # flat dictionary { key: { pt, en } }
src/core/i18n/t.ts                               # t(key, params?) function
src/core/i18n/idioma.ts                          # trocarIdioma with fade overlay
src/core/i18n/__tests__/t.test.ts
src/core/i18n/__tests__/dict.test.ts
```

**New files (Phase C — Deploy):**

```
.github/workflows/deploy.yml
public/.nojekyll
```

**Modified files:**

```
src/core/config.ts                # add input.bindings + language to shape
src/main.ts                       # delete zoom/Escape listener, use onAction
src/core/player.ts                # delete Escape listener, export cancelarComandoNaveSeAtivo
src/ui/debug-menu.ts              # delete F1/F3/Escape listener, export fecharDebugOverlays
src/ui/settings-panel.ts          # add Controles section + Idioma selector in Jogabilidade tab
src/ui/hud-layout.ts              # fade overlay CSS
src/ui/main-menu.ts               # t() for all textContent
src/ui/sidebar.ts                 # t() for labels
src/ui/new-world-modal.ts         # t()
src/ui/planet-panel.ts            # t()
src/ui/ship-panel.ts              # t()
src/ui/build-panel.ts             # t()
src/ui/colonizer-panel.ts         # t()
src/ui/colony-modal.ts            # t()
src/ui/confirm-dialog.ts          # t()
src/ui/loading-screen.ts          # t()
src/ui/toast.ts                   # t()
src/ui/renderer-info-modal.ts     # t()
src/world/planeta.ts              # nomeTipoPlaneta uses t()
vite.config.ts                    # add base: '/orbital-fork/'
```

---

# Phase C — GitHub Pages Deploy (do first — smallest)

## Task 1: Vite base path + .nojekyll

**Files:**
- Modify: `vite.config.ts`
- Create: `public/.nojekyll`

- [ ] **Step 1: Add base path to vite.config.ts**

Edit `vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/orbital-fork/',
  server: {
    allowedHosts: true,
  },
});
```

- [ ] **Step 2: Create .nojekyll**

Create `public/.nojekyll` as an empty file (prevents GitHub Pages from treating the site as a Jekyll project):

```bash
touch public/.nojekyll
```

- [ ] **Step 3: Verify build still works**

Run: `npm run build`
Expected: build succeeds, `dist/` contains `index.html` with asset paths prefixed by `/orbital-fork/`.

Verify: `grep '/orbital-fork/' dist/index.html`
Expected: at least one match (script src or link href).

- [ ] **Step 4: Verify dev server still works**

Run: `npm run dev`
Open browser — game loads at `http://localhost:5173/` (Vite ignores `base` in dev mode).
Close dev server.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts public/.nojekyll
git commit -m "feat(deploy): add vite base path and .nojekyll for GitHub Pages"
```

## Task 2: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the workflow file**

```bash
mkdir -p .github/workflows
```

Write `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions workflow for Pages deploy"
```

- [ ] **Step 3: Document manual step for the user**

After pushing to `main`, the user must go to GitHub → Settings → Pages → Build and deployment → Source → select **"GitHub Actions"** (one-time setup). After that, every push to `main` triggers automatic deployment.

The URL will be `https://caua726.github.io/orbital-fork/`.

---

# Phase A — Input System

## Task 3: Add `input.bindings` to config

**Files:**
- Modify: `src/core/config.ts`

- [ ] **Step 1: Extend OrbitalConfig**

In `src/core/config.ts`, add to the `OrbitalConfig` interface:

```ts
  // Input
  input: {
    bindings: Record<string, string[]>;  // actionId → keyCodes (empty = use defaults)
  };
```

Add to `DEFAULTS`:

```ts
  input: {
    bindings: {},
  },
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/config.ts
git commit -m "feat(config): add input.bindings to OrbitalConfig"
```

## Task 4: Create `actions.ts`

**Files:**
- Create: `src/core/input/actions.ts`

- [ ] **Step 1: Write the module**

Create `src/core/input/actions.ts`:

```ts
export interface ActionDef {
  id: string;
  label: string;
  categoria: 'camera' | 'interface' | 'jogo' | 'debug';
  defaultKeys: string[];
}

export const ACTIONS: ActionDef[] = [
  // Câmera
  { id: 'zoom_in',            label: 'Zoom in',            categoria: 'camera',    defaultKeys: ['Equal', 'NumpadAdd'] },
  { id: 'zoom_out',           label: 'Zoom out',           categoria: 'camera',    defaultKeys: ['Minus', 'NumpadSubtract'] },
  { id: 'pan_up',             label: 'Câmera cima',        categoria: 'camera',    defaultKeys: ['KeyW', 'ArrowUp'] },
  { id: 'pan_down',           label: 'Câmera baixo',       categoria: 'camera',    defaultKeys: ['KeyS', 'ArrowDown'] },
  { id: 'pan_left',           label: 'Câmera esquerda',    categoria: 'camera',    defaultKeys: ['KeyA', 'ArrowLeft'] },
  { id: 'pan_right',          label: 'Câmera direita',     categoria: 'camera',    defaultKeys: ['KeyD', 'ArrowRight'] },

  // Interface
  { id: 'cancel_or_menu',     label: 'Cancelar / Menu',    categoria: 'interface', defaultKeys: ['Escape'] },
  { id: 'quicksave',          label: 'Salvar rápido',      categoria: 'interface', defaultKeys: ['F5'] },

  // Jogo
  { id: 'speed_pause',        label: 'Pausar',             categoria: 'jogo',      defaultKeys: ['Space'] },
  { id: 'speed_1x',           label: 'Velocidade 1x',      categoria: 'jogo',      defaultKeys: ['Digit1'] },
  { id: 'speed_2x',           label: 'Velocidade 2x',      categoria: 'jogo',      defaultKeys: ['Digit2'] },
  { id: 'speed_4x',           label: 'Velocidade 4x',      categoria: 'jogo',      defaultKeys: ['Digit3'] },

  // Debug
  { id: 'toggle_debug_fast',  label: 'Debug rápido',       categoria: 'debug',     defaultKeys: ['F1'] },
  { id: 'toggle_debug_full',  label: 'Debug completo',     categoria: 'debug',     defaultKeys: ['F3'] },
];

export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a]),
);

export const CATEGORIAS_ORDEM: ActionDef['categoria'][] = ['camera', 'interface', 'jogo', 'debug'];
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/input/actions.ts
git commit -m "feat(input): define action constants with metadata"
```

## Task 5: Create `keymap.ts` with tests

**Files:**
- Create: `src/core/input/keymap.ts`
- Create: `src/core/input/__tests__/keymap.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/core/input/__tests__/keymap.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { resetConfigForTest, setConfig } from '../../config';
import { getActiveKeymap, resolveKeyToAction, detectarConflito } from '../keymap';

describe('keymap', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('returns default keys when no custom bindings', () => {
    const map = getActiveKeymap();
    expect(map.zoom_in).toEqual(['Equal', 'NumpadAdd']);
    expect(map.toggle_debug_fast).toEqual(['F1']);
  });

  it('returns custom binding when set', () => {
    setConfig({ input: { bindings: { zoom_in: ['KeyZ'] } } });
    const map = getActiveKeymap();
    expect(map.zoom_in).toEqual(['KeyZ']);
    expect(map.zoom_out).toEqual(['Minus', 'NumpadSubtract']); // others unchanged
  });

  it('resolveKeyToAction finds the correct action', () => {
    expect(resolveKeyToAction('Equal')).toBe('zoom_in');
    expect(resolveKeyToAction('NumpadAdd')).toBe('zoom_in');
    expect(resolveKeyToAction('F1')).toBe('toggle_debug_fast');
    expect(resolveKeyToAction('KeyQ')).toBeNull();
  });

  it('resolveKeyToAction uses custom bindings', () => {
    setConfig({ input: { bindings: { zoom_in: ['KeyZ'] } } });
    expect(resolveKeyToAction('KeyZ')).toBe('zoom_in');
    expect(resolveKeyToAction('Equal')).toBeNull(); // old key no longer maps
  });

  it('detectarConflito finds conflicts', () => {
    expect(detectarConflito('Equal')).toBe('zoom_in');
    expect(detectarConflito('Equal', 'zoom_in')).toBeNull(); // ignore self
    expect(detectarConflito('KeyQ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — confirm failure**

Run: `npm run test -- keymap`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement keymap.ts**

Create `src/core/input/keymap.ts`:

```ts
import { ACTIONS } from './actions';
import { getConfig } from '../config';

export type KeyBindings = Record<string, string[]>;

export function getActiveKeymap(): KeyBindings {
  const custom = getConfig().input?.bindings ?? {};
  const result: KeyBindings = {};
  for (const action of ACTIONS) {
    result[action.id] = custom[action.id] ?? action.defaultKeys;
  }
  return result;
}

export function resolveKeyToAction(code: string): string | null {
  const keymap = getActiveKeymap();
  for (const [actionId, keys] of Object.entries(keymap)) {
    if (keys.includes(code)) return actionId;
  }
  return null;
}

export function detectarConflito(code: string, ignorarAction?: string): string | null {
  const keymap = getActiveKeymap();
  for (const [actionId, keys] of Object.entries(keymap)) {
    if (actionId === ignorarAction) continue;
    if (keys.includes(code)) return actionId;
  }
  return null;
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm run test -- keymap`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/input/keymap.ts src/core/input/__tests__/keymap.test.ts
git commit -m "feat(input): keymap module with tests"
```

## Task 6: Create `dispatcher.ts` with tests

**Files:**
- Create: `src/core/input/dispatcher.ts`
- Create: `src/core/input/__tests__/dispatcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/core/input/__tests__/dispatcher.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { resetConfigForTest } from '../../config';
import { onAction, onActionUp, _dispatchForTest, _dispatchUpForTest } from '../dispatcher';

describe('dispatcher', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('calls onAction callback for matching key', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('Equal', 'CANVAS');
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('does not call callback for non-matching key', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('KeyQ', 'CANVAS');
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it('ignores events when target is INPUT', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('Equal', 'INPUT');
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it('ignores events when target is TEXTAREA', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    _dispatchForTest('Equal', 'TEXTAREA');
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });

  it('onActionUp fires on keyup', () => {
    const fn = vi.fn();
    const unsub = onActionUp('pan_up', fn);
    _dispatchUpForTest('KeyW', 'CANVAS');
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('unsubscribe stops callbacks', () => {
    const fn = vi.fn();
    const unsub = onAction('zoom_in', fn);
    unsub();
    _dispatchForTest('Equal', 'CANVAS');
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — confirm failure**

Run: `npm run test -- dispatcher`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement dispatcher.ts**

Create `src/core/input/dispatcher.ts`:

```ts
import { resolveKeyToAction } from './keymap';

type ActionCallback = () => void;
const _listeners = new Map<string, Set<ActionCallback>>();
const _upListeners = new Map<string, Set<ActionCallback>>();
let _installed = false;
let _habilitado = true;

export function setDispatcherHabilitado(val: boolean): void {
  _habilitado = val;
}

export function onAction(actionId: string, callback: ActionCallback): () => void {
  if (!_listeners.has(actionId)) _listeners.set(actionId, new Set());
  _listeners.get(actionId)!.add(callback);
  return () => _listeners.get(actionId)?.delete(callback);
}

export function onActionUp(actionId: string, callback: ActionCallback): () => void {
  if (!_upListeners.has(actionId)) _upListeners.set(actionId, new Set());
  _upListeners.get(actionId)!.add(callback);
  return () => _upListeners.get(actionId)?.delete(callback);
}

// Keys that should NOT have their default browser behavior blocked even when
// handled by the dispatcher. F5 is quicksave but the user may also want to
// reload the page; Space scrolls the page but only matters pre-game (in-game
// the page doesn't scroll). We block arrows/+/- (conflicting browser defaults)
// but leave F-keys passthrough so Ctrl+Shift+R / F5 reload still works.
const PASSTHROUGH_KEYS = new Set(['F1', 'F3', 'F5']);

function dispatch(code: string, targetTag: string, listeners: Map<string, Set<ActionCallback>>): boolean {
  if (!_habilitado) return false;
  if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return false;
  const actionId = resolveKeyToAction(code);
  if (!actionId) return false;
  const cbs = listeners.get(actionId);
  if (!cbs || cbs.size === 0) return false;
  for (const cb of cbs) {
    try { cb(); } catch (err) { console.error(`[input] action ${actionId} error:`, err); }
  }
  // Return false for passthrough keys so the caller does NOT call preventDefault.
  return !PASSTHROUGH_KEYS.has(code);
}

export function instalarDispatcher(): void {
  if (_installed) return;
  _installed = true;

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName ?? '';
    if ((e.target as HTMLElement)?.isContentEditable) return;
    const handled = dispatch(e.code, tag, _listeners);
    if (handled) e.preventDefault();
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName ?? '';
    dispatch(e.code, tag, _upListeners);
  });
}

// Test-only helpers — simulate dispatch without real DOM events.
export function _dispatchForTest(code: string, targetTag: string): boolean {
  return dispatch(code, targetTag, _listeners);
}

export function _dispatchUpForTest(code: string, targetTag: string): boolean {
  return dispatch(code, targetTag, _upListeners);
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm run test -- dispatcher`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/input/dispatcher.ts src/core/input/__tests__/dispatcher.test.ts
git commit -m "feat(input): dispatcher with keydown/keyup and test helpers"
```

## Task 7: Export wrappers + migrate main.ts listener

**Files:**
- Modify: `src/core/player.ts`
- Modify: `src/ui/debug-menu.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add `cancelarComandoNaveSeAtivo` in player.ts**

In `src/core/player.ts`, find `cancelarComandoNave` (the existing void function). Add a new wrapper below it:

```ts
/** Returns true if there was an active command to cancel. */
export function cancelarComandoNaveSeAtivo(): boolean {
  if (!comandoNave) return false;
  cancelarComandoNave();
  return true;
}
```

Also, find the Escape keydown listener at `player.ts:346`:

```ts
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  // ...
```

**Delete this entire listener** (the Escape handling is now via the dispatcher's `cancel_or_menu` action wired in main.ts).

- [ ] **Step 2: Add `fecharDebugOverlays` in debug-menu.ts**

In `src/ui/debug-menu.ts`, add two new exports:

```ts
export function setGameSpeed(v: number): void {
  _state.gameSpeed = v;
}

export function fecharDebugOverlays(): boolean {
  if (_popupVisible) {
    togglePopup(false);
    return true;
  }
  if (_fastVisible) {
    toggleFastMenu(false);
    return true;
  }
  return false;
}
```

Find the F1/F3/Escape keydown listener at `debug-menu.ts:710`:

```ts
window.addEventListener('keydown', (e) => {
  // ...F1, F3, Escape...
```

**Delete this entire listener.**

- [ ] **Step 3: Migrate main.ts — delete old listener, wire dispatcher**

In `src/main.ts`, find the keyboard listener at line 78:

```ts
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape' && _gameStarted && !isPauseMenuOpen()) {
    e.preventDefault();
    abrirPauseMenu();
    return;
  }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
});
```

**Delete this entire listener.** Replace with dispatcher-based registration:

```ts
import { instalarDispatcher, onAction, onActionUp } from './core/input/dispatcher';
import { cancelarComandoNaveSeAtivo } from './core/player';
import { fecharDebugOverlays } from './ui/debug-menu';

// Inside bootstrap(), after instalarListenersCicloDeVida():
instalarDispatcher();

onAction('zoom_in', () => zoomIn());
onAction('zoom_out', () => zoomOut());

onAction('cancel_or_menu', () => {
  if (cancelarComandoNaveSeAtivo()) return;
  if (fecharDebugOverlays()) return;
  if (_gameStarted && !isPauseMenuOpen()) abrirPauseMenu();
});

onAction('toggle_debug_fast', () => {
  // Import toggleFastMenu from debug-menu or call via existing reference
  toggleFastMenu();
});

onAction('toggle_debug_full', () => {
  togglePopup();
  if (_popupVisible) toggleFastMenu(false);
});

onAction('quicksave', () => {
  salvarAgora();
  toast('Salvo', 'info');
});

// Pan — new feature (keyboard camera pan via held keys)
const _panState = { up: false, down: false, left: false, right: false };
onAction('pan_up', () => { _panState.up = true; });
onActionUp('pan_up', () => { _panState.up = false; });
onAction('pan_down', () => { _panState.down = true; });
onActionUp('pan_down', () => { _panState.down = false; });
onAction('pan_left', () => { _panState.left = true; });
onActionUp('pan_left', () => { _panState.left = false; });
onAction('pan_right', () => { _panState.right = true; });
onActionUp('pan_right', () => { _panState.right = false; });

// Pan blur safety: release all held keys when window loses focus
window.addEventListener('blur', () => {
  _panState.up = _panState.down = _panState.left = _panState.right = false;
});
```

In the game-phase branch of `startTicker()`, add pan application:

```ts
// Apply keyboard pan
const PAN_SPEED = 800;
const panScale = PAN_SPEED * (app.ticker.deltaMS / 1000) / (camera.zoom || 1);
if (_panState.up) camera.y -= panScale;
if (_panState.down) camera.y += panScale;
if (_panState.left) camera.x -= panScale;
if (_panState.right) camera.x += panScale;
```

Also add speed controls:

```ts
// Speed controls — `_state` is private in debug-menu.ts, so we need a
// public setter. Add `export function setGameSpeed(v: number): void`
// in debug-menu.ts (see Step 2 above for the export).
import { setGameSpeed, getDebugState } from './ui/debug-menu';

onAction('speed_pause', () => {
  setGameSpeed(getDebugState().gameSpeed === 0 ? 1 : 0);
});
onAction('speed_1x', () => { setGameSpeed(1); });
onAction('speed_2x', () => { setGameSpeed(2); });
onAction('speed_4x', () => { setGameSpeed(4); });
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Smoke test**

Run: `npm run dev`
1. Press `=` → zoom in. Press `-` → zoom out.
2. Press `W` → camera pans up. Release `W` → stops.
3. Press `Escape` → pause menu opens (if game started) or cancels command.
4. Press `F1` → debug fast menu toggles.
5. Press `F3` → debug popup toggles.
6. Press `F5` → toast "Salvo".
7. Press `Space` → game pauses/resumes.
8. Press `1`/`2`/`3` → speed changes.
9. Type in an input field (colony-modal) → none of the above fire.

Close dev server.

- [ ] **Step 6: Commit**

```bash
git add src/core/player.ts src/ui/debug-menu.ts src/main.ts
git commit -m "feat(input): migrate listeners to dispatcher, add keyboard pan and speed"
```

## Task 8: Rebind UI in Settings Jogabilidade tab

**Files:**
- Modify: `src/ui/settings-panel.ts`

- [ ] **Step 1: Add Controles section to renderGameplayTab**

In `src/ui/settings-panel.ts`, inside the `renderGameplayTab` function, after the existing edge-scroll toggle, add:

```ts
import { ACTIONS, CATEGORIAS_ORDEM, ACTION_BY_ID, type ActionDef } from '../core/input/actions';
import { getActiveKeymap, detectarConflito } from '../core/input/keymap';
import { setDispatcherHabilitado } from '../core/input/dispatcher';

// ... inside renderGameplayTab, after existing toggles:

// ── Controles section ──
const controlesSec = document.createElement('div');
controlesSec.className = 'settings-section';
controlesSec.textContent = 'Controles';
body.appendChild(controlesSec);

const keymap = getActiveKeymap();

for (const cat of CATEGORIAS_ORDEM) {
  const catActions = ACTIONS.filter((a) => a.categoria === cat);
  if (catActions.length === 0) continue;

  const catLabel = document.createElement('div');
  catLabel.style.cssText = 'font-size: calc(var(--hud-unit) * 0.7); color: var(--hud-text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin-top: calc(var(--hud-unit) * 0.8); padding-bottom: calc(var(--hud-unit) * 0.2); border-bottom: 1px solid var(--hud-border);';
  const catNames: Record<string, string> = {
    camera: t('input.cat_camera'),
    interface: t('input.cat_interface'),
    jogo: t('input.cat_jogo'),
    debug: t('input.cat_debug'),
  };
  catLabel.textContent = catNames[cat] ?? cat;
  body.appendChild(catLabel);

  for (const action of catActions) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const lbl = document.createElement('label');
    lbl.textContent = action.label;
    row.appendChild(lbl);

    const keys = keymap[action.id] ?? action.defaultKeys;
    const keyDisplay = document.createElement('span');
    keyDisplay.className = 'value-display';
    keyDisplay.textContent = keys.map(formatKeyCode).join(' / ');
    row.appendChild(keyDisplay);

    const rebindBtn = document.createElement('button');
    rebindBtn.textContent = 'Rebind';
    rebindBtn.style.cssText = 'background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text-dim); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.7); padding: calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.5); cursor: pointer;';
    rebindBtn.addEventListener('click', () => {
      iniciarRebind(action, keyDisplay, rebindBtn);
    });
    row.appendChild(rebindBtn);

    body.appendChild(row);
  }
}

// Reset button
const resetBtn = document.createElement('button');
resetBtn.textContent = 'Resetar controles';
resetBtn.style.cssText = 'margin-top: calc(var(--hud-unit) * 0.8); background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text-dim); font-family: var(--hud-font); padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1); cursor: pointer; width: 100%;';
resetBtn.addEventListener('click', () => {
  setConfig({ input: { bindings: {} } });
  // Re-render the tab to reflect defaults
  body.replaceChildren();
  renderGameplayTab(body);
});
body.appendChild(resetBtn);
```

- [ ] **Step 2: Implement the rebind helper and formatKeyCode**

Add these helper functions in `settings-panel.ts`:

```ts
function formatKeyCode(code: string): string {
  // Human-readable key display
  const MAP: Record<string, string> = {
    Equal: '=', Minus: '-', NumpadAdd: 'Num+', NumpadSubtract: 'Num-',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Space', Escape: 'Esc', Backquote: '`',
    Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
    KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D',
    F1: 'F1', F3: 'F3', F5: 'F5',
  };
  return MAP[code] ?? code.replace(/^Key/, '');
}

function iniciarRebind(action: ActionDef, display: HTMLSpanElement, btn: HTMLButtonElement): void {
  const originalText = btn.textContent;
  btn.textContent = 'Pressione tecla...';
  display.textContent = '...';
  setDispatcherHabilitado(false);

  function handler(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // Escape cancels rebind
    if (e.code === 'Escape') {
      cleanup();
      return;
    }

    // Check conflict
    const conflito = detectarConflito(e.code, action.id);
    if (conflito) {
      const conflictAction = ACTION_BY_ID[conflito];
      if (!confirm(`Já usado por "${conflictAction?.label ?? conflito}". Trocar?`)) {
        cleanup();
        return;
      }
      // Swap: remove from conflicting action
      const currentBindings = { ...getConfig().input?.bindings };
      currentBindings[conflito] = (currentBindings[conflito] ?? conflictAction?.defaultKeys ?? [])
        .filter((k: string) => k !== e.code);
      if (currentBindings[conflito]?.length === 0) delete currentBindings[conflito];
      currentBindings[action.id] = [e.code];
      setConfig({ input: { bindings: currentBindings } });
    } else {
      const currentBindings = { ...getConfig().input?.bindings };
      currentBindings[action.id] = [e.code];
      setConfig({ input: { bindings: currentBindings } });
    }

    cleanup();
  }

  function cleanup(): void {
    window.removeEventListener('keydown', handler, true);
    setDispatcherHabilitado(true);
    btn.textContent = originalText;
    const keys = getActiveKeymap()[action.id] ?? action.defaultKeys;
    display.textContent = keys.map(formatKeyCode).join(' / ');
  }

  window.addEventListener('keydown', handler, true);
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`
1. Settings → Jogabilidade → Controles section visible.
2. Click "Rebind" on Zoom in → "Pressione tecla..." → press `KeyI` → shows `I`.
3. Press `I` → zoom in works.
4. Try to rebind another action to `I` → conflict dialog → confirm → swap.
5. Click "Resetar controles" → all reset to defaults.

Close dev server.

- [ ] **Step 4: Commit**

```bash
git add src/ui/settings-panel.ts
git commit -m "feat(ui): rebind UI in Jogabilidade tab with conflict detection"
```

---

# Phase B — i18n

## Task 9: Add `language` to config

**Files:**
- Modify: `src/core/config.ts`

- [ ] **Step 1: Extend OrbitalConfig**

Add to `OrbitalConfig` interface:

```ts
  language: 'pt' | 'en';
```

Add to `DEFAULTS`:

```ts
  language: 'pt',
```

- [ ] **Step 2: Verify typecheck + commit**

Run: `npx tsc --noEmit`

```bash
git add src/core/config.ts
git commit -m "feat(config): add language field to OrbitalConfig"
```

## Task 10: Create `t.ts` and `dict.ts` with tests

**Files:**
- Create: `src/core/i18n/dict.ts`
- Create: `src/core/i18n/t.ts`
- Create: `src/core/i18n/__tests__/t.test.ts`
- Create: `src/core/i18n/__tests__/dict.test.ts`

- [ ] **Step 1: Write failing tests for t()**

Create `src/core/i18n/__tests__/t.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { setConfig, resetConfigForTest } from '../../config';
import { t } from '../t';

describe('t()', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('returns PT text by default', () => {
    expect(t('menu.novo_jogo')).toBe('Novo Jogo');
  });

  it('returns EN text when language is en', () => {
    setConfig({ language: 'en' });
    expect(t('menu.novo_jogo')).toBe('New Game');
  });

  it('interpolates params', () => {
    expect(t('loading.carregando', { nome: 'Alpha' })).toBe('Carregando mundo: Alpha');
  });

  it('returns key for missing entry', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });
});
```

- [ ] **Step 2: Write dict completeness test**

Create `src/core/i18n/__tests__/dict.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DICT } from '../dict';

describe('dict', () => {
  it('every entry has both pt and en', () => {
    for (const [key, entry] of Object.entries(DICT)) {
      expect(entry.pt, `${key} missing pt`).toBeTruthy();
      expect(entry.en, `${key} missing en`).toBeTruthy();
    }
  });

  it('no duplicate keys', () => {
    const keys = Object.keys(DICT);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it('placeholders in pt have matching placeholders in en', () => {
    for (const [key, entry] of Object.entries(DICT)) {
      const ptPlaceholders = (entry.pt.match(/\{(\w+)\}/g) ?? []).sort();
      const enPlaceholders = (entry.en.match(/\{(\w+)\}/g) ?? []).sort();
      expect(ptPlaceholders, `${key} placeholder mismatch`).toEqual(enPlaceholders);
    }
  });
});
```

- [ ] **Step 3: Run tests — confirm failure**

Run: `npm run test -- i18n`
Expected: FAIL — modules not found.

- [ ] **Step 4: Create dict.ts with initial entries**

Create `src/core/i18n/dict.ts` with the complete dictionary. This is a large file (~200 entries). Start with the core entries the tests need, then expand during migration tasks:

```ts
export const DICT: Record<string, { pt: string; en: string }> = {
  // Menu
  'menu.novo_jogo': { pt: 'Novo Jogo', en: 'New Game' },
  'menu.mundos_salvos': { pt: 'Mundos Salvos', en: 'Saved Worlds' },
  'menu.configuracoes': { pt: 'Configurações', en: 'Settings' },
  'menu.titulo': { pt: 'Orbital Wydra', en: 'Orbital Wydra' },
  'menu.subtitulo': { pt: 'Expedição Estelar', en: 'Stellar Expedition' },
  'menu.footer': { pt: 'v0.1  ·  protótipo', en: 'v0.1  ·  prototype' },
  'menu.voltar': { pt: '◀ Voltar', en: '◀ Back' },
  'menu.nenhum_save': { pt: 'Nenhum mundo salvo ainda', en: 'No saved worlds yet' },
  'menu.titulo_saves': { pt: 'Mundos Salvos', en: 'Saved Worlds' },
  'menu.apagar_save': { pt: 'Apagar mundo "{nome}" permanentemente?', en: 'Delete world "{nome}" permanently?' },

  // HUD
  'hud.salvar': { pt: 'Salvar', en: 'Save' },
  'hud.configuracoes': { pt: 'Configurações', en: 'Settings' },
  'hud.menu': { pt: 'Menu', en: 'Menu' },
  'hud.salvo': { pt: 'Salvo', en: 'Saved' },
  'hud.erro_salvar': { pt: 'Erro ao salvar: {msg}', en: 'Save error: {msg}' },
  'hud.voltar_menu_confirm': { pt: 'Voltar ao menu? Seu progresso será salvo automaticamente.', en: 'Return to menu? Your progress will be saved automatically.' },

  // New world
  'novo_mundo.titulo': { pt: 'Novo Mundo', en: 'New World' },
  'novo_mundo.nome_label': { pt: 'Nome do mundo', en: 'World name' },
  'novo_mundo.placeholder': { pt: 'Ex: Valoria Prime', en: 'e.g. Valoria Prime' },
  'novo_mundo.criar': { pt: 'Criar', en: 'Create' },
  'novo_mundo.cancelar': { pt: 'Cancelar', en: 'Cancel' },
  'novo_mundo.erro_vazio': { pt: 'Nome é obrigatório', en: 'Name is required' },
  'novo_mundo.erro_longo': { pt: 'Máximo 40 caracteres', en: 'Maximum 40 characters' },
  'novo_mundo.erro_duplicado': { pt: 'Já existe um mundo com esse nome', en: 'A world with this name already exists' },

  // Pause
  'pause.continuar': { pt: 'Continuar', en: 'Continue' },
  'pause.salvar': { pt: 'Salvar', en: 'Save' },
  'pause.sair': { pt: 'Sair', en: 'Exit' },

  // Loading
  'loading.criando': { pt: 'Criando mundo', en: 'Creating world' },
  'loading.carregando': { pt: 'Carregando mundo: {nome}', en: 'Loading world: {nome}' },

  // Toast
  'toast.salvo': { pt: 'Salvo', en: 'Saved' },
  'toast.erro_save': { pt: 'Erro ao salvar: {msg}', en: 'Save error: {msg}' },

  // Naves
  'nave.colonizadora': { pt: 'Colonizadora', en: 'Colonizer' },
  'nave.cargueira': { pt: 'Cargueira', en: 'Freighter' },
  'nave.batedora': { pt: 'Batedora', en: 'Scout' },
  'nave.torreta': { pt: 'Torreta', en: 'Turret' },

  // Planetas
  'planeta.comum': { pt: 'Comum', en: 'Common' },
  'planeta.marte': { pt: 'Rochoso', en: 'Rocky' },
  'planeta.gasoso': { pt: 'Gasoso', en: 'Gas Giant' },

  // Settings
  'settings.titulo': { pt: 'Configurações', en: 'Settings' },
  'settings.aba_audio': { pt: 'Áudio', en: 'Audio' },
  'settings.aba_graficos': { pt: 'Gráficos', en: 'Graphics' },
  'settings.aba_jogabilidade': { pt: 'Jogabilidade', en: 'Gameplay' },
  'settings.resetar_aba': { pt: 'Resetar esta aba', en: 'Reset this tab' },
  'settings.resetar_tudo': { pt: 'Resetar tudo', en: 'Reset all' },

  // Idioma
  'idioma.label': { pt: 'Idioma', en: 'Language' },
  'idioma.pt': { pt: 'Português', en: 'Portuguese' },
  'idioma.en': { pt: 'English', en: 'English' },

  // Input
  'input.titulo_secao': { pt: 'Controles', en: 'Controls' },
  'input.rebind': { pt: 'Rebind', en: 'Rebind' },
  'input.pressione': { pt: 'Pressione tecla...', en: 'Press key...' },
  'input.conflito': { pt: 'Já usado por "{acao}". Trocar?', en: 'Already used by "{acao}". Swap?' },
  'input.resetar': { pt: 'Resetar controles', en: 'Reset controls' },
};

// NOTE: Additional keys for planet-panel, ship-panel, build-panel, colonizer-panel,
// colony-modal, renderer-info-modal, tooltips, sidebar labels, etc. are added
// during the migration tasks below. Each migration task adds its module's keys
// to this file in the same commit.
```

- [ ] **Step 5: Create t.ts**

Create `src/core/i18n/t.ts`:

```ts
import { DICT } from './dict';
import { getConfig } from '../config';

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = DICT[key];
  if (!entry) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  const lang = getConfig().language ?? 'pt';
  let text = entry[lang] ?? entry.pt;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}
```

- [ ] **Step 6: Run tests — verify pass**

Run: `npm run test -- i18n`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/i18n/dict.ts src/core/i18n/t.ts src/core/i18n/__tests__/t.test.ts src/core/i18n/__tests__/dict.test.ts
git commit -m "feat(i18n): dictionary, t() function, and tests"
```

## Task 11: Create `idioma.ts` with fade overlay

**Files:**
- Create: `src/core/i18n/idioma.ts`
- Modify: `src/ui/hud-layout.ts`

- [ ] **Step 1: Add fade overlay CSS**

In `src/ui/hud-layout.ts`, inside the `installRootVariables()` function CSS string, add:

```css
.hud-fade-overlay {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 1100;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms ease;
}
.hud-fade-overlay.active {
  opacity: 1;
}
```

- [ ] **Step 2: Implement idioma.ts**

Create `src/core/i18n/idioma.ts`:

```ts
import { getConfig, setConfig } from '../config';

let _overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (_overlay) return _overlay;
  const el = document.createElement('div');
  el.className = 'hud-fade-overlay';
  document.body.appendChild(el);
  _overlay = el;
  return el;
}

export function getIdioma(): 'pt' | 'en' {
  return getConfig().language ?? 'pt';
}

export function trocarIdioma(lang: 'pt' | 'en'): void {
  if (lang === getIdioma()) return;
  const overlay = ensureOverlay();
  overlay.classList.add('active');
  overlay.addEventListener('transitionend', function handler() {
    overlay.removeEventListener('transitionend', handler);
    setConfig({ language: lang });
    requestAnimationFrame(() => {
      overlay.classList.remove('active');
    });
  }, { once: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/i18n/idioma.ts src/ui/hud-layout.ts
git commit -m "feat(i18n): trocarIdioma with fade overlay transition"
```

## Task 12: Idioma selector in Settings Jogabilidade tab

**Files:**
- Modify: `src/ui/settings-panel.ts`

- [ ] **Step 1: Add idioma selector above Controles section**

In `src/ui/settings-panel.ts`, inside `renderGameplayTab`, after the edge-scroll toggle and BEFORE the Controles section:

```ts
import { trocarIdioma, getIdioma } from '../core/i18n/idioma';
import { t } from '../core/i18n/t';

// Idioma selector
{
  const row = document.createElement('div');
  row.className = 'settings-row';
  const lbl = document.createElement('label');
  lbl.textContent = t('idioma.label');
  row.appendChild(lbl);
  const select = document.createElement('select');
  const opts: Array<['pt' | 'en', string]> = [
    ['pt', 'Português'],
    ['en', 'English'],
  ];
  for (const [val, label] of opts) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === getIdioma()) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    trocarIdioma(select.value as 'pt' | 'en');
    // Settings panel will re-render when re-opened after fade
  });
  row.appendChild(select);
  body.appendChild(row);
}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`
1. Settings → Jogabilidade → Idioma dropdown visible.
2. Select "English" → fade-out → fade-in → settings labels should still show PT (because we haven't migrated them yet — that happens in Tasks 13-17).
3. Reload → `getConfig().language === 'en'` in console.

Close dev server.

- [ ] **Step 3: Commit**

```bash
git add src/ui/settings-panel.ts
git commit -m "feat(ui): idioma selector in Jogabilidade tab"
```

## Task 13: Migrate main-menu strings to t()

**Files:**
- Modify: `src/ui/main-menu.ts`
- Modify: `src/core/i18n/dict.ts` (add any missing keys)

- [ ] **Step 1: Replace hardcoded strings**

In `src/ui/main-menu.ts`, add import:

```ts
import { t } from '../core/i18n/t';
```

Find and replace each `textContent = '...'` with `textContent = t('key')`:

```ts
// Example replacements:
title.textContent = t('menu.titulo');            // was 'Orbital Wydra'
subtitle.textContent = t('menu.subtitulo');      // was 'Expedição Estelar'
newGame.textContent = t('menu.novo_jogo');        // was 'Novo Jogo'
loadGame.textContent = t('menu.mundos_salvos');   // was 'Mundos Salvos'
settings.textContent = t('menu.configuracoes');   // was 'Configurações'
footer.textContent = t('menu.footer');            // was 'v0.1  ·  protótipo'
back.textContent = t('menu.voltar');              // was '◀ Voltar'
// saves screen:
title.textContent = t('menu.titulo_saves');       // was 'Mundos Salvos'
empty.textContent = t('menu.nenhum_save');        // was 'Nenhum mundo salvo ainda'
```

For the main-menu as a persistent component, add a config listener to re-render labels when language changes:

```ts
import { onConfigChange } from '../core/config';

// At the end of criarMainMenu:
onConfigChange((cfg) => {
  // Re-render text nodes that are already mounted
  if (title) title.textContent = t('menu.titulo');
  if (subtitle) subtitle.textContent = t('menu.subtitulo');
  // ... update all text nodes
});
```

- [ ] **Step 2: Add any missing dict entries**

Check if all keys used exist in `dict.ts`. Add any missing ones.

- [ ] **Step 3: Smoke test**

Run: `npm run dev`
1. Switch to EN in settings.
2. Return to main menu → title should show English text.

Close dev server.

- [ ] **Step 4: Commit**

```bash
git add src/ui/main-menu.ts src/core/i18n/dict.ts
git commit -m "feat(i18n): migrate main-menu strings to t()"
```

## Task 14: Migrate HUD + sidebar + new-world-modal

**Files:**
- Modify: `src/ui/sidebar.ts`, `src/ui/new-world-modal.ts`
- Modify: `src/core/i18n/dict.ts`

- [ ] **Step 1: Sidebar — replace hardcoded strings**

In `src/ui/sidebar.ts`, import `t` and replace all `textContent = '...'` on buttons and labels.

Add config listener for sidebar (persistent component). **Important**: store the unsubscribe function and call it in `destruirSidebar()` to prevent listener leaks across world entries:

```ts
const unsub = onConfigChange(() => {
  btnSalvar.textContent = t('hud.salvar');
  btnConfig.textContent = t('hud.configuracoes');
  btnMenu.textContent = t('hud.menu');
  // ... other labels
});
// In destruirSidebar():
// unsub();
```

Same pattern applies to `criarMainMenu` in Task 13 — store the unsubscribe and call it in `destruirMainMenu()`.

- [ ] **Step 2: New world modal — replace strings**

In `src/ui/new-world-modal.ts`, import `t` and replace:

```ts
title.textContent = t('novo_mundo.titulo');
labelNome.textContent = t('novo_mundo.nome_label');
input.placeholder = t('novo_mundo.placeholder');
btnOk.textContent = t('novo_mundo.criar');
btnCancel.textContent = t('novo_mundo.cancelar');
// Validation messages:
if (t.length < 1) return t('novo_mundo.erro_vazio');
if (t.length > 40) return t('novo_mundo.erro_longo');
if (existe) return t('novo_mundo.erro_duplicado');
```

- [ ] **Step 3: Add missing dict entries + commit**

```bash
git add src/ui/sidebar.ts src/ui/new-world-modal.ts src/core/i18n/dict.ts
git commit -m "feat(i18n): migrate sidebar and new-world-modal strings"
```

## Task 15: Migrate panels (planet, ship, build, colonizer, colony-modal)

**Files:**
- Modify: `src/ui/planet-panel.ts`, `src/ui/ship-panel.ts`, `src/ui/build-panel.ts`, `src/ui/colonizer-panel.ts`, `src/ui/colony-modal.ts`
- Modify: `src/core/i18n/dict.ts`

- [ ] **Step 1: For each panel file**

Import `t` and replace every `textContent = '...'` with `textContent = t('panel.key')`. These panels are recreated on each open, so **no config listener needed** — `t()` reads the current language at render time.

Add the corresponding keys to `dict.ts`. Grep each file for `textContent`, `innerText`, `placeholder`, `title=` to find all strings.

Example for planet-panel.ts:

```ts
import { t } from '../core/i18n/t';

// Replace:
// labelTipo.textContent = 'Tipo';
labelTipo.textContent = t('planeta_panel.tipo');

// Replace:
// labelFab.textContent = 'Fábricas';
labelFab.textContent = t('planeta_panel.fabricas');
```

Add to dict.ts:

```ts
'planeta_panel.tipo': { pt: 'Tipo', en: 'Type' },
'planeta_panel.fabricas': { pt: 'Fábricas', en: 'Factories' },
// ... etc for all panel strings
```

- [ ] **Step 2: For ship-panel — estado labels**

Ship panel has state labels like "Orbitando", "Viajando", etc. These should use `t()`:

```ts
'nave.estado.orbitando': { pt: 'Orbitando', en: 'Orbiting' },
'nave.estado.viajando': { pt: 'Viajando', en: 'Traveling' },
'nave.estado.parado': { pt: 'Parado', en: 'Idle' },
'nave.estado.fazendo_survey': { pt: 'Fazendo survey', en: 'Surveying' },
'nave.estado.aguardando_decisao': { pt: 'Aguardando decisão', en: 'Awaiting decision' },
'nave.estado.pilotando': { pt: 'Pilotando', en: 'Piloting' },
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/planet-panel.ts src/ui/ship-panel.ts src/ui/build-panel.ts src/ui/colonizer-panel.ts src/ui/colony-modal.ts src/core/i18n/dict.ts
git commit -m "feat(i18n): migrate panel strings to t()"
```

## Task 16: Migrate remaining UI (loading, toast, confirm, renderer-info, settings, planeta.ts)

**Files:**
- Modify: `src/ui/loading-screen.ts`, `src/ui/toast.ts`, `src/ui/confirm-dialog.ts`, `src/ui/renderer-info-modal.ts`, `src/ui/settings-panel.ts`, `src/world/planeta.ts`
- Modify: `src/core/i18n/dict.ts`

- [ ] **Step 1: Loading screen**

```ts
import { t } from '../core/i18n/t';
// Replace 'Criando mundo' → t('loading.criando')
// Replace 'Carregando mundo: ...' → t('loading.carregando', { nome })
```

- [ ] **Step 2: Toast/confirm/renderer-info**

Same pattern — import `t`, replace hardcoded strings.

- [ ] **Step 3: Settings panel labels**

Replace all the tab labels, button texts, section titles with `t()`:

```ts
title.textContent = t('settings.titulo');
// Tab labels: t('settings.aba_audio'), t('settings.aba_graficos'), t('settings.aba_jogabilidade')
// Reset buttons: t('settings.resetar_aba'), t('settings.resetar_tudo')
// Controles section: t('input.titulo_secao'), t('input.rebind'), t('input.resetar')
```

- [ ] **Step 4: `nomeTipoPlaneta` in planeta.ts**

In `src/world/planeta.ts`, the `nomeTipoPlaneta` function returns display names for planet types. Use `t()`:

```ts
import { t } from '../core/i18n/t';

export function nomeTipoPlaneta(tipo: string): string {
  switch (tipo) {
    case TIPO_PLANETA.COMUM: return t('planeta.comum');
    case TIPO_PLANETA.MARTE: return t('planeta.marte');
    case TIPO_PLANETA.GASOSO: return t('planeta.gasoso');
    default: return tipo;
  }
}
```

- [ ] **Step 5: Add all remaining dict entries + commit**

```bash
git add src/ui/loading-screen.ts src/ui/toast.ts src/ui/confirm-dialog.ts src/ui/renderer-info-modal.ts src/ui/settings-panel.ts src/world/planeta.ts src/core/i18n/dict.ts
git commit -m "feat(i18n): migrate remaining UI strings to t()"
```

## Task 17: Run dict completeness test + final validation

**Files:**
- Modify: `src/core/i18n/__tests__/dict.test.ts` (if needed)

- [ ] **Step 1: Run all tests**

Run: `npm run test`
Expected: all tests pass, including dict completeness (every key has pt+en, no mismatched placeholders).

- [ ] **Step 2: Full playtesting**

Run: `npm run dev`

*Input:*
1. W/A/S/D moves camera.
2. Settings → Jogabilidade → Controles → Rebind zoom_in to `I` → works.
3. Conflict detection works.
4. Resetar controles restores defaults.
5. F5 quicksave + toast.
6. Space pauses game.
7. Escape closes debug overlays → opens pause menu.

*i18n:*
8. Idioma → EN → fade → main menu in English.
9. Idioma → PT → fade → tudo volta.
10. Reload → language persists.
11. Panels show English labels.
12. Planet type names in English.
13. Debug menu stays in PT.

*Deploy:*
14. `npm run build` succeeds.
15. If pushed to main → workflow runs → `caua726.github.io/orbital-fork/` loads.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(i18n): dict completeness fixes from playtesting"
```

---

## Notes for executors

- **Phase C is independent** and can be done at any time (even first).
- **Phase A (input) and Phase B (i18n) are independent** of each other, but if you do A first, the input labels are in PT; when B comes along, Task 16 migrates them to `t()`.
- **The dict grows during migration**: Tasks 13-16 each add keys to `dict.ts`. The initial dict in Task 10 has ~50 keys; by Task 16 it should have ~180.
- **Panels that recreate on open** (planet, ship, build, colonizer, colony-modal, confirm-dialog, new-world-modal, renderer-info, settings) do NOT need config listeners for i18n — `t()` reads the current language fresh each time.
- **Persistent components** (main-menu, sidebar) DO need a `onConfigChange` listener to re-render their text nodes.
- **Commit messages**: `feat(input): ...`, `feat(i18n): ...`, `feat(deploy): ...`, `ci: ...`.
- **If spec disagrees with reality**: pause and raise it. Spec is `docs/superpowers/specs/2026-04-15-input-i18n-deploy-design.md`.
