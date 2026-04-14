import type { Application } from 'pixi.js';
import type { Mundo, CheatsState, DebugConfig, ProfilingData } from '../types';
import { getCamera } from '../core/player';
// Reuse the state objects that the existing game systems already read from.
// Flipping these here affects the game live, no wiring needed.
import { cheats, config, getRendererPreference, setRendererPreference } from './debug';
import { profiling } from '../world/mundo';

interface DebugState {
  gameSpeed: number;
}

const _state: DebugState = {
  gameSpeed: 1,
};

let _fastMenu: HTMLDivElement | null = null;
let _popup: HTMLDivElement | null = null;
let _toggleBtn: HTMLButtonElement | null = null;
let _styleInjected = false;
let _fastVisible = false;
let _popupVisible = false;
let _app: Application | null = null;
let _mundo: Mundo | null = null;

// Stat readouts that get updated every frame
let _fpsEl: HTMLSpanElement | null = null;
let _deltaEl: HTMLSpanElement | null = null;
let _planetsEl: HTMLSpanElement | null = null;
let _shipsEl: HTMLSpanElement | null = null;
let _sistemasEl: HTMLSpanElement | null = null;
let _cameraEl: HTMLSpanElement | null = null;
let _zoomEl: HTMLSpanElement | null = null;
let _rendererEl: HTMLSpanElement | null = null;

// Profiling readouts
const _profEls: Partial<Record<keyof ProfilingData, HTMLSpanElement>> = {};
let _profBarEl: HTMLDivElement | null = null;

// FPS tracking
let _frameCount = 0;
let _lastFpsUpdate = performance.now();
let _fpsValue = 0;

export function getDebugState(): Readonly<DebugState> {
  return _state;
}

export function getCheats(): Readonly<CheatsState> {
  return cheats;
}

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .debug-toggle {
      /* Anchored to the top-right corner just below the credits-bar.
         5.4u matches the credits-bar min-height; adding hud-gap leaves a
         clean visual separation. */
      position: fixed;
      top: calc(var(--hud-margin) + var(--hud-unit) * 5.4 + var(--hud-gap));
      right: var(--hud-margin);
      width: calc(var(--hud-unit) * 2.4);
      height: calc(var(--hud-unit) * 2.4);
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      border: 1px solid rgba(255,255,255,0.4);
      border-radius: calc(var(--hud-unit) * 0.5);
      color: rgba(255,255,255,0.6);
      cursor: pointer;
      font-family: "Silkscreen", monospace;
      font-size: calc(var(--hud-unit) * 0.9);
      outline: none;
      transition: all 120ms ease;
      padding: 0;
      z-index: 101;
    }

    .debug-toggle:hover {
      border-color: rgba(255,255,255,0.85);
      color: #fff;
    }

    .debug-toggle.active {
      background: rgba(40,40,40,0.95);
      border-color: rgba(255,255,255,0.9);
      color: #fff;
    }

    /* ═══ Fast floating menu (near DEV button) ═══ */
    .debug-fast {
      /* Drops down from below the DEV toggle in the top-right corner.
         Top = credits-bar bottom + gap + toggle height + small gap. */
      position: fixed;
      top: calc(var(--hud-margin) + var(--hud-unit) * 8.2 + var(--hud-gap));
      right: var(--hud-margin);
      min-width: clamp(240px, 26vmin, 320px);
      display: none;
      flex-direction: column;
      padding: calc(var(--hud-unit) * 0.8);
      z-index: 150;
      font-family: "Silkscreen", "VT323", monospace;
    }

    .debug-fast.open { display: flex; }

    .debug-fast-footer {
      display: flex;
      gap: calc(var(--hud-unit) * 0.4);
      margin-top: calc(var(--hud-unit) * 0.6);
      padding-top: calc(var(--hud-unit) * 0.5);
      border-top: 1px solid rgba(255,255,255,0.15);
    }

    .debug-fast-footer .debug-action-btn {
      margin-top: 0;
      flex: 1;
    }

    /* ═══ Full debug popup (modal, center) ═══ */
    .debug-menu {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: clamp(320px, 40vmin, 480px);
      max-height: 85vh;
      overflow-y: auto;
      display: none;
      flex-direction: column;
      padding: calc(var(--hud-unit) * 1.2);
      z-index: 200;
      font-family: "Silkscreen", "VT323", monospace;
    }

    .debug-menu.open { display: flex; }

    .debug-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      z-index: 199;
      display: none;
    }

    .debug-backdrop.open { display: block; }

    .debug-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: calc(var(--hud-unit) * 0.8);
      padding-bottom: calc(var(--hud-unit) * 0.6);
      border-bottom: 1px solid rgba(255,255,255,0.2);
    }

    .debug-title {
      font-size: clamp(12px, 1.3vmin, 16px);
      color: #f5f5f5;
      letter-spacing: 2px;
      text-transform: uppercase;
    }

    .debug-close {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.3);
      color: rgba(255,255,255,0.7);
      width: calc(var(--hud-unit) * 1.6);
      height: calc(var(--hud-unit) * 1.6);
      cursor: pointer;
      font-family: inherit;
      font-size: clamp(11px, 1.1vmin, 14px);
      line-height: 1;
      padding: 0;
      outline: none;
      border-radius: 4px;
    }

    .debug-close:hover {
      border-color: #fff;
      color: #fff;
    }

    .debug-section {
      margin-bottom: calc(var(--hud-unit) * 1);
    }

    .debug-section-title {
      font-size: clamp(9px, 0.9vmin, 11px);
      color: rgba(255,255,255,0.4);
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-bottom: calc(var(--hud-unit) * 0.5);
      padding-bottom: 3px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }

    .debug-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: calc(var(--hud-unit) * 0.4) 0;
      font-size: clamp(11px, 1.1vmin, 13px);
    }

    .debug-label {
      color: rgba(255,255,255,0.75);
    }

    .debug-value {
      color: #f5f5f5;
      font-weight: 700;
      font-family: "VT323", monospace;
      font-size: clamp(13px, 1.3vmin, 16px);
    }

    .debug-toggle-sw {
      width: calc(var(--hud-unit) * 2.2);
      height: calc(var(--hud-unit) * 1.2);
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: calc(var(--hud-unit) * 0.6);
      cursor: pointer;
      position: relative;
      transition: all 150ms ease;
      flex-shrink: 0;
    }

    .debug-toggle-sw::after {
      content: '';
      position: absolute;
      top: 1px;
      left: 1px;
      width: calc(var(--hud-unit) * 0.9);
      height: calc(var(--hud-unit) * 0.9);
      background: rgba(255,255,255,0.6);
      border-radius: calc(var(--hud-unit) * 0.5);
      transition: all 150ms ease;
    }

    .debug-toggle-sw.on {
      background: rgba(255,255,255,0.18);
      border-color: rgba(255,255,255,0.85);
    }

    .debug-toggle-sw.on::after {
      left: calc(100% - var(--hud-unit) * 0.9 - 2px);
      background: #fff;
    }

    .debug-slider {
      display: flex;
      gap: calc(var(--hud-unit) * 0.3);
      align-items: center;
    }

    .debug-slider button {
      width: calc(var(--hud-unit) * 1.6);
      height: calc(var(--hud-unit) * 1.4);
      background: transparent;
      border: 1px solid rgba(255,255,255,0.3);
      color: rgba(255,255,255,0.75);
      cursor: pointer;
      font-family: inherit;
      font-size: clamp(11px, 1.1vmin, 14px);
      line-height: 1;
      padding: 0;
      outline: none;
      border-radius: 3px;
    }

    .debug-slider button:hover {
      border-color: #fff;
      color: #fff;
    }

    .debug-action-btn {
      width: 100%;
      padding: calc(var(--hud-unit) * 0.6);
      background: transparent;
      border: 1px solid rgba(255,255,255,0.3);
      color: rgba(255,255,255,0.85);
      font-family: inherit;
      font-size: clamp(10px, 1vmin, 12px);
      letter-spacing: 1px;
      text-transform: uppercase;
      cursor: pointer;
      outline: none;
      border-radius: 4px;
      margin-top: calc(var(--hud-unit) * 0.3);
      transition: all 150ms ease;
    }

    .debug-action-btn:hover {
      background: rgba(255,255,255,0.1);
      border-color: #fff;
      color: #fff;
    }

    .debug-prof-bar {
      display: flex;
      height: calc(var(--hud-unit) * 1.2);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 3px;
      overflow: hidden;
      margin: calc(var(--hud-unit) * 0.4) 0;
    }

    .debug-prof-bar > div {
      height: 100%;
      min-width: 2px;
      transition: width 200ms ease;
    }

    .debug-slider-row {
      display: flex;
      flex-direction: column;
      padding: calc(var(--hud-unit) * 0.3) 0;
      gap: 3px;
    }

    .debug-slider-header {
      display: flex;
      justify-content: space-between;
      font-size: clamp(10px, 1vmin, 12px);
    }

    .debug-slider-header .label { color: rgba(255,255,255,0.75); }
    .debug-slider-header .value { color: #f5f5f5; font-weight: 700; }

    .debug-slider-input {
      width: 100%;
      accent-color: rgba(255,255,255,0.85);
      height: 4px;
      cursor: pointer;
      appearance: none;
      background: rgba(255,255,255,0.15);
      border-radius: 2px;
      outline: none;
    }

    .debug-select {
      width: 100%;
      background: rgba(0,0,0,0.5);
      color: #f5f5f5;
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 3px;
      padding: calc(var(--hud-unit) * 0.4);
      font-family: inherit;
      font-size: clamp(10px, 1vmin, 12px);
      outline: none;
      margin-top: calc(var(--hud-unit) * 0.3);
    }

    .debug-value-warn { color: #ffcc40 !important; }
    .debug-value-bad { color: #ff5050 !important; }
    .debug-value-ok { color: #60ff90 !important; }
  `;
  document.head.appendChild(style);
}

function createCheatToggle(label: string, cheatKey: keyof CheatsState): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'debug-row';

  const lbl = document.createElement('span');
  lbl.className = 'debug-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  const sw = document.createElement('div');
  sw.className = 'debug-toggle-sw';
  if (cheats[cheatKey]) sw.classList.add('on');
  sw.addEventListener('click', () => {
    cheats[cheatKey] = !cheats[cheatKey];
    sw.classList.toggle('on', cheats[cheatKey]);
  });
  row.appendChild(sw);

  return row;
}

function createReadout(label: string): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement('div');
  row.className = 'debug-row';

  const lbl = document.createElement('span');
  lbl.className = 'debug-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  const value = document.createElement('span');
  value.className = 'debug-value';
  value.textContent = '—';
  row.appendChild(value);

  return { row, value };
}

function createSlider(label: string, min: number, max: number, step: number, initial: number, onChange: (v: number) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'debug-slider-row';

  const header = document.createElement('div');
  header.className = 'debug-slider-header';
  const lbl = document.createElement('span');
  lbl.className = 'label';
  lbl.textContent = label;
  header.appendChild(lbl);
  const val = document.createElement('span');
  val.className = 'value';
  val.textContent = step >= 1 ? String(initial) : initial.toFixed(2);
  header.appendChild(val);
  row.appendChild(header);

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'debug-slider-input';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = step >= 1 ? String(v) : v.toFixed(2);
    onChange(v);
  });
  row.appendChild(input);

  return row;
}

function createProfRow(label: string, key: keyof ProfilingData, indent: boolean = false): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'debug-row';
  if (indent) row.style.paddingLeft = 'calc(var(--hud-unit) * 0.8)';

  const lbl = document.createElement('span');
  lbl.className = 'debug-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  const value = document.createElement('span');
  value.className = 'debug-value';
  value.textContent = '0.00';
  _profEls[key] = value;
  row.appendChild(value);

  return row;
}

function createSpeedSlider(): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'debug-row';

  const lbl = document.createElement('span');
  lbl.className = 'debug-label';
  lbl.textContent = 'Game Speed';
  row.appendChild(lbl);

  const slider = document.createElement('div');
  slider.className = 'debug-slider';

  const value = document.createElement('span');
  value.className = 'debug-value';
  value.textContent = `${_state.gameSpeed}x`;
  value.style.minWidth = 'calc(var(--hud-unit) * 2)';
  value.style.textAlign = 'center';

  const btnDown = document.createElement('button');
  btnDown.textContent = '−';
  btnDown.addEventListener('click', () => {
    _state.gameSpeed = Math.max(0.25, _state.gameSpeed - 0.25);
    value.textContent = `${_state.gameSpeed}x`;
  });

  const btnUp = document.createElement('button');
  btnUp.textContent = '+';
  btnUp.addEventListener('click', () => {
    _state.gameSpeed = Math.min(4, _state.gameSpeed + 0.25);
    value.textContent = `${_state.gameSpeed}x`;
  });

  slider.appendChild(btnDown);
  slider.appendChild(value);
  slider.appendChild(btnUp);
  row.appendChild(slider);

  return row;
}

function buildFastMenu(): HTMLDivElement {
  const fast = document.createElement('div');
  fast.className = 'hud-panel debug-fast';

  // Header
  const header = document.createElement('div');
  header.className = 'debug-header';
  const title = document.createElement('div');
  title.className = 'debug-title';
  title.textContent = 'DEBUG';
  header.appendChild(title);
  fast.appendChild(header);

  // Quick cheats
  fast.appendChild(createCheatToggle('Reveal Fog', 'visaoTotal'));
  fast.appendChild(createCheatToggle('Free Resources', 'recursosInfinitos'));
  fast.appendChild(createCheatToggle('Instant Build', 'construcaoInstantanea'));
  fast.appendChild(createCheatToggle('Instant Research', 'pesquisaInstantanea'));
  fast.appendChild(createCheatToggle('Fast Ships 10x', 'velocidadeNave'));
  fast.appendChild(createSpeedSlider());

  // Footer with "More" and keyboard hint
  const footer = document.createElement('div');
  footer.className = 'debug-fast-footer';

  const moreBtn = document.createElement('button');
  moreBtn.className = 'debug-action-btn';
  moreBtn.textContent = 'More  ( F3 )';
  moreBtn.addEventListener('click', () => {
    togglePopup(true);
    toggleFastMenu(false);
  });
  footer.appendChild(moreBtn);

  fast.appendChild(footer);

  return fast;
}

export function criarDebugMenu(app: Application, mundo: Mundo): HTMLDivElement {
  if (_popup) return _popup;
  injectStyles();
  _app = app;
  _mundo = mundo;

  // Toggle button (always visible, bottom-center)
  const toggle = document.createElement('button');
  toggle.className = 'debug-toggle';
  toggle.title = 'Debug Menu  ( F1 )';
  toggle.textContent = 'DEV';
  toggle.addEventListener('click', () => toggleFastMenu());
  document.body.appendChild(toggle);
  _toggleBtn = toggle;

  // --- Fast menu ---
  _fastMenu = buildFastMenu();
  document.body.appendChild(_fastMenu);

  // --- Full popup (modal, detailed) ---
  const backdrop = document.createElement('div');
  backdrop.className = 'debug-backdrop';
  backdrop.addEventListener('click', () => togglePopup(false));
  document.body.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'hud-panel debug-menu';

  // Header
  const header = document.createElement('div');
  header.className = 'debug-header';
  const title = document.createElement('div');
  title.className = 'debug-title';
  title.textContent = 'DEBUG CONSOLE';
  header.appendChild(title);
  const close = document.createElement('button');
  close.className = 'debug-close';
  close.textContent = '×';
  close.addEventListener('click', () => togglePopup(false));
  header.appendChild(close);
  panel.appendChild(header);
  _popup = panel;

  // --- Stats section (live readouts)
  const statsSec = document.createElement('div');
  statsSec.className = 'debug-section';
  const statsTitle = document.createElement('div');
  statsTitle.className = 'debug-section-title';
  statsTitle.textContent = 'Stats';
  statsSec.appendChild(statsTitle);

  const fps = createReadout('FPS');
  _fpsEl = fps.value;
  statsSec.appendChild(fps.row);

  const delta = createReadout('Delta (ms)');
  _deltaEl = delta.value;
  statsSec.appendChild(delta.row);

  const rend = createReadout('Renderer');
  _rendererEl = rend.value;
  statsSec.appendChild(rend.row);

  const planets = createReadout('Planets');
  _planetsEl = planets.value;
  statsSec.appendChild(planets.row);

  const ships = createReadout('Ships');
  _shipsEl = ships.value;
  statsSec.appendChild(ships.row);

  const sistemas = createReadout('Systems');
  _sistemasEl = sistemas.value;
  statsSec.appendChild(sistemas.row);

  const cam = createReadout('Camera');
  _cameraEl = cam.value;
  statsSec.appendChild(cam.row);

  const zoom = createReadout('Zoom');
  _zoomEl = zoom.value;
  statsSec.appendChild(zoom.row);

  panel.appendChild(statsSec);

  // --- Profiling section
  const profSec = document.createElement('div');
  profSec.className = 'debug-section';
  const profTitle = document.createElement('div');
  profTitle.className = 'debug-section-title';
  profTitle.textContent = 'Profiling  (ms / frame)';
  profSec.appendChild(profTitle);

  profSec.appendChild(createProfRow('Logic', 'logica'));
  profSec.appendChild(createProfRow('Background', 'fundo'));
  profSec.appendChild(createProfRow('Fog', 'fog'));
  profSec.appendChild(createProfRow('Planets', 'planetas'));
  profSec.appendChild(createProfRow('Render', 'render'));
  profSec.appendChild(createProfRow('Total', 'total'));

  // Stacked bar
  const bar = document.createElement('div');
  bar.className = 'debug-prof-bar';
  _profBarEl = bar;
  profSec.appendChild(bar);

  panel.appendChild(profSec);

  // --- Vision Config section
  const visionSec = document.createElement('div');
  visionSec.className = 'debug-section';
  const visionTitle = document.createElement('div');
  visionTitle.className = 'debug-section-title';
  visionTitle.textContent = 'Vision / Fog Config';
  visionSec.appendChild(visionTitle);

  visionSec.appendChild(createSlider('Planet vision radius', 200, 2000, 50, config.raioVisaoBase, (v) => { config.raioVisaoBase = v; }));
  visionSec.appendChild(createSlider('Ship vision radius', 100, 1500, 50, config.raioVisaoNave, (v) => { config.raioVisaoNave = v; }));
  visionSec.appendChild(createSlider('Scout vision radius', 200, 2500, 50, config.raioVisaoBatedora, (v) => { config.raioVisaoBatedora = v; }));
  visionSec.appendChild(createSlider('Fog alpha', 0, 1, 0.05, config.fogAlpha, (v) => { config.fogAlpha = v; }));
  visionSec.appendChild(createSlider('Fog throttle (frames)', 1, 10, 1, config.fogThrottle, (v) => { config.fogThrottle = v; }));

  panel.appendChild(visionSec);

  // --- Renderer section
  const rendererSec = document.createElement('div');
  rendererSec.className = 'debug-section';
  const rendererTitle = document.createElement('div');
  rendererTitle.className = 'debug-section-title';
  rendererTitle.textContent = 'Renderer';
  rendererSec.appendChild(rendererTitle);

  const select = document.createElement('select');
  select.className = 'debug-select';
  for (const [val, label] of [['webgl', 'WebGL'], ['webgpu', 'WebGPU']]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = getRendererPreference();
  rendererSec.appendChild(select);

  const applyBtn = document.createElement('button');
  applyBtn.className = 'debug-action-btn';
  applyBtn.textContent = 'Apply & Reload';
  applyBtn.addEventListener('click', () => {
    setRendererPreference(select.value);
    window.location.reload();
  });
  rendererSec.appendChild(applyBtn);

  panel.appendChild(rendererSec);

  // --- Actions section
  const actionsSec = document.createElement('div');
  actionsSec.className = 'debug-section';
  const actionsTitle = document.createElement('div');
  actionsTitle.className = 'debug-section-title';
  actionsTitle.textContent = 'Actions';
  actionsSec.appendChild(actionsTitle);

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'debug-action-btn';
  reloadBtn.textContent = 'Reload World';
  reloadBtn.addEventListener('click', () => window.location.reload());
  actionsSec.appendChild(reloadBtn);

  panel.appendChild(actionsSec);

  document.body.appendChild(panel);

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    if (e.key === 'F1') {
      e.preventDefault();
      toggleFastMenu();
    } else if (e.key === 'F3') {
      e.preventDefault();
      togglePopup();
      if (_popupVisible) toggleFastMenu(false);
    } else if (e.key === 'Escape') {
      if (_popupVisible) togglePopup(false);
      else if (_fastVisible) toggleFastMenu(false);
    }
  });

  return panel;
}

function toggleFastMenu(force?: boolean): void {
  if (!_fastMenu || !_toggleBtn) return;
  _fastVisible = force !== undefined ? force : !_fastVisible;
  _fastMenu.classList.toggle('open', _fastVisible);
  _toggleBtn.classList.toggle('active', _fastVisible || _popupVisible);
}

function togglePopup(force?: boolean): void {
  if (!_popup || !_toggleBtn) return;
  _popupVisible = force !== undefined ? force : !_popupVisible;
  _popup.classList.toggle('open', _popupVisible);
  const backdrop = document.querySelector('.debug-backdrop');
  if (backdrop) backdrop.classList.toggle('open', _popupVisible);
  _toggleBtn.classList.toggle('active', _fastVisible || _popupVisible);
}

const PROF_COLORS: Partial<Record<keyof ProfilingData, string>> = {
  logica: '#4488cc',
  fundo: '#44aa88',
  fog: '#ff6060',
  planetas: '#ffcc40',
  render: '#aa66ff',
};

function colorForFps(fps: number): string {
  if (fps >= 50) return 'debug-value-ok';
  if (fps >= 30) return 'debug-value-warn';
  return 'debug-value-bad';
}

function colorForMs(ms: number): string {
  if (ms <= 2) return 'debug-value-ok';
  if (ms <= 5) return 'debug-value-warn';
  return 'debug-value-bad';
}

function setValueClass(el: HTMLElement | null, cls: string): void {
  if (!el) return;
  el.classList.remove('debug-value-ok', 'debug-value-warn', 'debug-value-bad');
  if (cls) el.classList.add(cls);
}

export function atualizarDebugMenu(): void {
  if (!_popupVisible || !_app || !_mundo) return;

  // FPS (moving average, update every ~250ms)
  _frameCount++;
  const now = performance.now();
  if (now - _lastFpsUpdate >= 250) {
    _fpsValue = Math.round((_frameCount * 1000) / (now - _lastFpsUpdate));
    _frameCount = 0;
    _lastFpsUpdate = now;
    if (_fpsEl) {
      _fpsEl.textContent = String(_fpsValue);
      setValueClass(_fpsEl, colorForFps(_fpsValue));
    }
  }

  if (_deltaEl) _deltaEl.textContent = _app.ticker.deltaMS.toFixed(1);

  if (_rendererEl) {
    const r = _app.renderer as { name?: string; constructor: { name: string } };
    _rendererEl.textContent = r.name ?? r.constructor.name ?? '?';
  }

  if (_planetsEl) {
    const visible = _mundo.planetas.filter(p => p._visivelAoJogador).length;
    _planetsEl.textContent = `${visible} / ${_mundo.planetas.length}`;
  }
  if (_shipsEl) _shipsEl.textContent = String(_mundo.naves.length);
  if (_sistemasEl) _sistemasEl.textContent = `${_mundo.sistemas.length} / ${_mundo.sois.length} suns`;

  const cam = getCamera();
  if (_cameraEl) _cameraEl.textContent = `${Math.round(cam.x)}, ${Math.round(cam.y)}`;
  if (_zoomEl) _zoomEl.textContent = `${cam.zoom.toFixed(2)}x`;

  // Profiling numbers + color
  for (const key of Object.keys(_profEls) as Array<keyof ProfilingData>) {
    const el = _profEls[key];
    if (!el) continue;
    const val = profiling[key];
    el.textContent = val.toFixed(2);
    setValueClass(el, colorForMs(val));
  }

  // Profiling stacked bar
  if (_profBarEl) {
    while (_profBarEl.firstChild) _profBarEl.removeChild(_profBarEl.firstChild);
    const total = Math.max(profiling.total, 0.01);
    for (const [key, color] of Object.entries(PROF_COLORS) as [keyof ProfilingData, string][]) {
      const val = profiling[key] ?? 0;
      const pct = Math.max((val / total) * 100, 0.5);
      const seg = document.createElement('div');
      seg.style.width = `${pct}%`;
      seg.style.background = color;
      seg.title = `${key}: ${val.toFixed(2)}ms`;
      _profBarEl.appendChild(seg);
    }
  }
}

export function destruirDebugMenu(): void {
  if (_popup) {
    _popup.remove();
    _popup = null;
  }
  if (_fastMenu) {
    _fastMenu.remove();
    _fastMenu = null;
  }
  if (_toggleBtn) {
    _toggleBtn.remove();
    _toggleBtn = null;
  }
  document.querySelector('.debug-backdrop')?.remove();
}
