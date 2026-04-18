import { getConfig, setConfig, DEFAULTS } from '../core/config';
import { aplicarPreset, presetBateComFlagsDerivadas } from '../core/graphics-preset';
import { rodarBenchmark } from '../core/benchmark';
import { comHelp } from './tooltip';
import { abrirRendererInfoModal } from './renderer-info-modal';
import { toast } from './toast';
import { confirmarAcao } from './confirmar-acao';
import { confirmar } from './confirm-dialog';
import { ACTIONS, CATEGORIAS_ORDEM, ACTION_BY_ID, type ActionDef } from '../core/input/actions';
import { getActiveKeymap, detectarConflito } from '../core/input/keymap';
import { setDispatcherHabilitado } from '../core/input/dispatcher';
import { trocarIdioma, getIdioma } from '../core/i18n/idioma';
import { t } from '../core/i18n/t';

type Tab = 'audio' | 'graphics' | 'gameplay';

let _overlay: HTMLDivElement | null = null;
let _currentTab: Tab = 'audio';
let _refreshBody: (() => void) | null = null;
let _fullscreenListenerInstalled = false;

function instalarFullscreenListener(): void {
  if (_fullscreenListenerInstalled) return;
  _fullscreenListenerInstalled = true;
  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    if (getConfig().graphics.fullscreen !== isFs) {
      setConfig({ graphics: { ...getConfig().graphics, fullscreen: isFs } });
    }
  });
}
let _styleInjected = false;

// ─── Tooltip keys (resolved via t() at render time) ──────────────────

type TooltipKey =
  | 'qualidade' | 'fullscreen' | 'scanlines' | 'fps' | 'ram' | 'fpsCap' | 'vsync' | 'renderScale'
  | 'renderer' | 'webglVersion' | 'gpuPref' | 'verInfo' | 'orbitas'
  | 'starfield' | 'fantasmas' | 'shaderLive' | 'autosave' | 'saveMode'
  | 'confirmar' | 'edge';

function tooltip(key: TooltipKey): string {
  return t(`tooltips.${key}`);
}

// ─── Custom select helper ────────────────────────────────────────────

function criarSelect(
  options: Array<[string, string]>,
  currentValue: string,
): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-select';

  const display = document.createElement('button');
  display.className = 'settings-select-display';
  const currentLabel = options.find(([v]) => v === currentValue)?.[1] ?? currentValue;
  display.textContent = currentLabel + ' \u25BE';
  wrapper.appendChild(display);

  // Store the current value as a data attribute
  wrapper.dataset.value = currentValue;

  const dropdown = document.createElement('div');
  dropdown.className = 'settings-select-dropdown';

  for (const [value, label] of options) {
    const opt = document.createElement('button');
    opt.className = 'settings-select-option';
    if (value === currentValue) opt.classList.add('active');
    opt.textContent = label;
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      wrapper.dataset.value = value;
      display.textContent = label + ' \u25BE';
      dropdown.querySelectorAll('.settings-select-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      dropdown.classList.remove('open');
      wrapper.dispatchEvent(new Event('change'));
    });
    dropdown.appendChild(opt);
  }
  wrapper.appendChild(dropdown);

  display.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any other open dropdowns
    document.querySelectorAll('.settings-select-dropdown.open').forEach(d => {
      if (d !== dropdown) d.classList.remove('open');
    });
    dropdown.classList.toggle('open');
  });

  return wrapper;
}

// Single shared listener to close all open custom selects on outside click.
let _selectCloseListenerInstalled = false;
function instalarSelectCloseListener(): void {
  if (_selectCloseListenerInstalled) return;
  _selectCloseListenerInstalled = true;
  document.addEventListener('click', () => {
    document.querySelectorAll('.settings-select-dropdown.open').forEach(d => d.classList.remove('open'));
  });
}

// ─── Styles ──────────────────────────────────────────────────────────

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  instalarSelectCloseListener();
  const s = document.createElement('style');
  s.textContent = `
    @keyframes settings-backdrop-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes settings-card-in {
      from { opacity: 0; transform: translateY(calc(var(--hud-unit) * 0.5)) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .settings-overlay {
      position: fixed; inset: 0; z-index: 650;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font-family: var(--hud-font); color: var(--hud-text);
      animation: settings-backdrop-in 200ms ease-out forwards;
    }
    .settings-overlay.closing {
      opacity: 0;
      transition: opacity 200ms ease-out;
    }
    .settings-overlay.closing .settings-card {
      transform: translateY(calc(var(--hud-unit) * 0.3)) scale(0.98);
      opacity: 0;
      transition: opacity 150ms ease-out, transform 200ms ease-out;
    }
    .settings-card {
      background: var(--hud-bg); border: 1px solid var(--hud-border);
      padding: calc(var(--hud-unit) * 1.4);
      min-width: calc(var(--hud-unit) * 30);
      max-width: calc(var(--hud-unit) * 40);
      max-height: 80vh; overflow-y: auto;
      animation: settings-card-in 240ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
    }
    .settings-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: calc(var(--hud-unit) * 1); }
    .settings-title { font-family: var(--hud-font-display); font-size: calc(var(--hud-unit) * 1.5); letter-spacing: 0.12em; text-transform: uppercase; margin: 0; }
    .settings-close { background: transparent; border: none; color: var(--hud-text); font-size: calc(var(--hud-unit) * 1.2); cursor: pointer; padding: 0 calc(var(--hud-unit) * 0.4); }
    .settings-close:hover { color: #ff6b6b; }
    .settings-tabs { display: flex; gap: calc(var(--hud-unit) * 0.3); margin-bottom: calc(var(--hud-unit) * 1); border-bottom: 1px solid var(--hud-border); }
    .settings-tab { background: transparent; border: 1px solid var(--hud-border); border-bottom: none; color: var(--hud-text-dim); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8); letter-spacing: 0.1em; text-transform: uppercase; padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 1); cursor: pointer; }
    .settings-tab.active { background: rgba(255,255,255,0.08); color: var(--hud-text); }
    @keyframes settings-tab-in {
      from { opacity: 0; transform: translateX(calc(var(--hud-unit) * 0.5)); }
      to { opacity: 1; transform: translateX(0); }
    }
    .settings-body { min-height: calc(var(--hud-unit) * 10); animation: settings-tab-in 180ms ease-out; }
    .settings-row { display: flex; justify-content: space-between; align-items: center; gap: calc(var(--hud-unit) * 1); padding: calc(var(--hud-unit) * 0.5) 0; }
    .settings-row label { font-size: calc(var(--hud-unit) * 0.85); color: var(--hud-text); flex: 1; display: flex; align-items: center; }
    .settings-row input[type="range"] {
      flex: 1; max-width: calc(var(--hud-unit) * 10);
      -webkit-appearance: none; appearance: none;
      height: calc(var(--hud-unit) * 0.25);
      background: rgba(255,255,255,0.15);
      border: none; border-radius: calc(var(--hud-unit) * 0.15);
      outline: none;
    }
    .settings-row input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: calc(var(--hud-unit) * 0.8); height: calc(var(--hud-unit) * 0.8);
      background: var(--hud-text); border: none;
      border-radius: 50%; cursor: pointer;
      transition: transform 100ms ease;
    }
    .settings-row input[type="range"]::-webkit-slider-thumb:hover {
      transform: scale(1.3);
    }
    .settings-row input[type="range"]::-moz-range-thumb {
      width: calc(var(--hud-unit) * 0.8); height: calc(var(--hud-unit) * 0.8);
      background: var(--hud-text); border: none;
      border-radius: 50%; cursor: pointer;
    }
    .settings-row input[type="range"]::-moz-range-track {
      height: calc(var(--hud-unit) * 0.25);
      background: rgba(255,255,255,0.15);
      border: none; border-radius: calc(var(--hud-unit) * 0.15);
    }
    .settings-row input[type="checkbox"] { width: calc(var(--hud-unit) * 1); height: calc(var(--hud-unit) * 1); }
    .settings-row .value-display { min-width: calc(var(--hud-unit) * 2.5); text-align: right; font-family: monospace; font-size: calc(var(--hud-unit) * 0.75); color: var(--hud-text-dim); }
    .settings-row .mute-btn {
      background: transparent; border: 1px solid var(--hud-border); color: var(--hud-text);
      cursor: pointer; padding: calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.4);
      width: calc(var(--hud-unit) * 2); height: calc(var(--hud-unit) * 1.4);
      font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.6);
      letter-spacing: 0.05em; text-transform: uppercase;
      display: flex; align-items: center; justify-content: center;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .settings-row .mute-btn:hover { background: rgba(255,255,255,0.06); }
    .settings-row .mute-btn.muted { color: #ff6b6b; border-color: #ff6b6b; background: rgba(255,100,100,0.08); }
    .settings-section { font-family: var(--hud-font-display); font-size: calc(var(--hud-unit) * 0.75); letter-spacing: 0.1em; text-transform: uppercase; color: var(--hud-text-dim); margin: calc(var(--hud-unit) * 1.2) 0 calc(var(--hud-unit) * 0.4); padding-top: calc(var(--hud-unit) * 0.4); border-top: 1px solid var(--hud-border); }
    .settings-reload-banner { margin-top: calc(var(--hud-unit) * 0.3); padding: calc(var(--hud-unit) * 0.4); background: rgba(255,107,107,0.1); border: 1px solid #ff6b6b; color: #ff6b6b; font-size: calc(var(--hud-unit) * 0.7); display: flex; justify-content: space-between; align-items: center; }
    .settings-reload-banner button { background: #ff6b6b; border: none; color: #000; padding: calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.6); cursor: pointer; font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.7); }
    .settings-footer { display: flex; gap: calc(var(--hud-unit) * 0.5); margin-top: calc(var(--hud-unit) * 1.5); padding-top: calc(var(--hud-unit) * 0.8); border-top: 1px solid var(--hud-border); }
    .settings-footer button { flex: 1; background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text-dim); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.75); padding: calc(var(--hud-unit) * 0.5); cursor: pointer; text-transform: uppercase; letter-spacing: 0.08em; }
    .settings-footer button:hover { color: var(--hud-text); border-color: var(--hud-text); }
    .settings-select { position: relative; display: inline-block; }
    .settings-select-display { background: rgba(0,0,0,0.4); color: var(--hud-text); border: 1px solid var(--hud-border); padding: calc(var(--hud-unit) * 0.3) calc(var(--hud-unit) * 0.8); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8); cursor: pointer; min-width: calc(var(--hud-unit) * 8); text-align: left; transition: border-color 120ms ease; }
    .settings-select-display:hover { border-color: var(--hud-text); }
    @keyframes settings-dropdown-in {
      from { opacity: 0; transform: translateY(calc(var(--hud-unit) * -0.3)) scaleY(0.95); }
      to { opacity: 1; transform: translateY(0) scaleY(1); }
    }
    .settings-select-dropdown { display: none; position: absolute; top: 100%; left: 0; right: 0; background: rgba(10, 12, 18, 0.95); border: 1px solid var(--hud-border); border-top: none; z-index: 950; max-height: calc(var(--hud-unit) * 15); overflow-y: auto; transform-origin: top center; }
    .settings-select-dropdown.open { display: block; animation: settings-dropdown-in 150ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards; }
    .settings-select-option { display: block; width: 100%; background: transparent; border: none; color: var(--hud-text-dim); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8); padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 0.8); cursor: pointer; text-align: left; transition: background 100ms ease, color 100ms ease; }
    .settings-select-option:hover { background: rgba(255,255,255,0.08); color: var(--hud-text); }
    .settings-select-option.active { color: var(--hud-text); background: rgba(255,255,255,0.05); }
  `;
  document.head.appendChild(s);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function rowWithLabel(text: string, tooltipKey: TooltipKey): [HTMLDivElement, HTMLLabelElement] {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const lbl = document.createElement('label');
  lbl.textContent = text;
  comHelp(lbl, tooltip(tooltipKey));
  row.appendChild(lbl);
  return [row, lbl];
}

function showReloadBanner(afterRow: HTMLDivElement): void {
  // Don't duplicate existing banner
  if (afterRow.nextElementSibling?.classList?.contains('settings-reload-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'settings-reload-banner';
  const msg = document.createElement('span');
  msg.textContent = t('settings.requer_reload');
  const btn = document.createElement('button');
  btn.textContent = t('settings.recarregar_agora');
  btn.addEventListener('click', () => window.location.reload());
  banner.append(msg, btn);
  afterRow.insertAdjacentElement('afterend', banner);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Renders the settings tabs + body + footer into an arbitrary host element.
 * Used by the main-menu to embed settings as a sliding screen instead of
 * a floating overlay.
 */
export function renderSettingsInto(host: HTMLDivElement): void {
  injectStyles();
  instalarFullscreenListener();

  // Tabs
  const tabsEl = document.createElement('div');
  tabsEl.className = 'settings-tabs';
  const tabs: Array<[Tab, string]> = [
    ['audio', t('settings.aba_audio')],
    ['graphics', t('settings.aba_graficos')],
    ['gameplay', t('settings.aba_jogabilidade')],
  ];
  for (const [id, label] of tabs) {
    const btn = document.createElement('button');
    btn.className = 'settings-tab';
    if (id === _currentTab) btn.classList.add('active');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      _currentTab = id;
      refreshBody();
    });
    tabsEl.appendChild(btn);
  }
  host.appendChild(tabsEl);

  // Body
  const body = document.createElement('div');
  body.className = 'settings-body';
  host.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'settings-footer';
  const resetTab = document.createElement('button');
  resetTab.textContent = t('settings.resetar_aba');
  resetTab.addEventListener('click', () => {
    resetarAba(_currentTab);
    refreshBody();
  });
  const resetAll = document.createElement('button');
  resetAll.textContent = t('settings.resetar_tudo');
  resetAll.addEventListener('click', () => {
    confirmarAcao(t('settings.resetar_tudo_confirm'), () => {
      resetarTudo();
      refreshBody();
    });
  });
  footer.append(resetTab, resetAll);
  host.appendChild(footer);

  function refreshBody(): void {
    body.replaceChildren();
    body.style.animation = 'none';
    void body.offsetHeight;
    body.style.animation = '';
    tabsEl.querySelectorAll('.settings-tab').forEach((b, i) => {
      b.classList.toggle('active', tabs[i][0] === _currentTab);
    });
    if (_currentTab === 'audio') renderAudioTab(body);
    else if (_currentTab === 'graphics') renderGraphicsTab(body);
    else renderGameplayTab(body);
  }
  _refreshBody = refreshBody;
  refreshBody();
}

/** @deprecated Kept for potential future in-game use; not called from main menu. */
export function abrirSettings(): void {
  injectStyles();
  instalarFullscreenListener();
  if (_overlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.setAttribute('data-ui', 'true');
  overlay.style.pointerEvents = 'auto';

  const card = document.createElement('div');
  card.className = 'settings-card';
  overlay.appendChild(card);

  // Header
  const header = document.createElement('div');
  header.className = 'settings-header';
  const title = document.createElement('h2');
  title.className = 'settings-title';
  title.textContent = t('settings.titulo');
  const close = document.createElement('button');
  close.className = 'settings-close';
  close.textContent = '\u2715';
  close.addEventListener('click', () => fecharSettings());
  header.append(title, close);
  card.appendChild(header);

  // Tabs
  const tabsEl = document.createElement('div');
  tabsEl.className = 'settings-tabs';
  const tabs: Array<[Tab, string]> = [
    ['audio', t('settings.aba_audio')],
    ['graphics', t('settings.aba_graficos')],
    ['gameplay', t('settings.aba_jogabilidade')],
  ];
  for (const [id, label] of tabs) {
    const btn = document.createElement('button');
    btn.className = 'settings-tab';
    if (id === _currentTab) btn.classList.add('active');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      _currentTab = id;
      refreshBody();
    });
    tabsEl.appendChild(btn);
  }
  card.appendChild(tabsEl);

  // Body
  const body = document.createElement('div');
  body.className = 'settings-body';
  card.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'settings-footer';
  const resetTab = document.createElement('button');
  resetTab.textContent = t('settings.resetar_aba');
  resetTab.addEventListener('click', () => {
    resetarAba(_currentTab);
    refreshBody();
  });
  const resetAll = document.createElement('button');
  resetAll.textContent = t('settings.resetar_tudo');
  resetAll.addEventListener('click', () => {
    confirmarAcao(t('settings.resetar_tudo_confirm'), () => {
      resetarTudo();
      refreshBody();
    });
  });
  footer.append(resetTab, resetAll);
  card.appendChild(footer);

  function refreshBody(): void {
    body.replaceChildren();
    body.style.animation = 'none';
    void body.offsetHeight;
    body.style.animation = '';
    tabsEl.querySelectorAll('.settings-tab').forEach((b, i) => {
      b.classList.toggle('active', tabs[i][0] === _currentTab);
    });
    if (_currentTab === 'audio') renderAudioTab(body);
    else if (_currentTab === 'graphics') renderGraphicsTab(body);
    else renderGameplayTab(body);
  }
  _refreshBody = refreshBody;
  refreshBody();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharSettings();
  });
  function onEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape') fecharSettings();
  }
  window.addEventListener('keydown', onEsc);
  _escListener = onEsc;

  document.body.appendChild(overlay);
  _overlay = overlay;
}

let _escListener: ((e: KeyboardEvent) => void) | null = null;

export function fecharSettings(): void {
  if (_escListener) {
    window.removeEventListener('keydown', _escListener);
    _escListener = null;
  }
  // Only null _refreshBody if it was set by the overlay, not by renderSettingsInto
  if (_overlay) _refreshBody = null;
  if (!_overlay) return;
  const ov = _overlay;
  ov.classList.add('closing');
  setTimeout(() => {
    ov.remove();
  }, 250);
  _overlay = null;
}

// ─── Audio tab (Task 24) ─────────────────────────────────────────────

function renderAudioTab(body: HTMLDivElement): void {
  const cfg = getConfig();
  type CatKey = 'master' | 'sfx' | 'ui' | 'aviso' | 'musica';
  const cats: Array<[CatKey, string]> = [
    ['master', t('settings.audio.master')],
    ['musica', t('settings.audio.musica')],
    ['sfx', t('settings.audio.sfx')],
    ['ui', t('settings.audio.ui')],
    ['aviso', t('settings.audio.aviso')],
  ];
  for (const [key, label] of cats) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.appendChild(lbl);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(cfg.audio[key].volume * 100));
    slider.addEventListener('input', () => {
      const v = Number(slider.value) / 100;
      const current = getConfig();
      setConfig({
        audio: {
          ...current.audio,
          [key]: { ...current.audio[key], volume: v },
        },
      });
      display.textContent = `${slider.value}%`;
    });
    row.appendChild(slider);

    const display = document.createElement('span');
    display.className = 'value-display';
    display.textContent = `${slider.value}%`;
    row.appendChild(display);

    const muteBtn = document.createElement('button');
    muteBtn.className = 'mute-btn';
    muteBtn.textContent = cfg.audio[key].muted ? t('settings.audio.mute') : t('settings.audio.on');
    if (cfg.audio[key].muted) muteBtn.classList.add('muted');
    muteBtn.addEventListener('click', () => {
      const current = getConfig();
      const newMuted = !current.audio[key].muted;
      setConfig({
        audio: {
          ...current.audio,
          [key]: { ...current.audio[key], muted: newMuted },
        },
      });
      muteBtn.textContent = newMuted ? t('settings.audio.mute') : t('settings.audio.on');
      muteBtn.classList.toggle('muted', newMuted);
    });
    row.appendChild(muteBtn);

    body.appendChild(row);
  }
}

// ─── Graphics tab (Tasks 25, 26, 27) ────────────────────────────────

function renderGraphicsTab(body: HTMLDivElement): void {
  const cfg = getConfig();
  const gfx = cfg.graphics;

  // ─── B\u00E1sico ───

  // Qualidade
  {
    const [row] = rowWithLabel(t('settings.row.qualidade'), 'qualidade');
    const isCustom = !presetBateComFlagsDerivadas(cfg);
    const options: Array<[string, string]> = [
      ['alto', t('settings.opt.alto')],
      ['medio', t('settings.opt.medio')],
      ['baixo', t('settings.opt.baixo')],
      ['minimo', t('settings.opt.minimo')],
    ];
    if (isCustom) {
      options.push(['personalizado', t('settings.opt.personalizado')]);
    }
    const select = criarSelect(options, isCustom ? 'personalizado' : gfx.qualidadeEfeitos);
    select.addEventListener('change', () => {
      const val = select.dataset.value!;
      if (val === 'personalizado') return; // no-op, already custom
      aplicarPreset(val as typeof gfx.qualidadeEfeitos);
      _refreshBody?.();
    });
    row.appendChild(select);

    // Benchmark trigger — stress-tests the GPU with a worst-case
    // scene and picks a preset + renderScale that fits. See
    // core/benchmark.ts for the workload details.
    const benchBtn = document.createElement('button');
    benchBtn.className = 'settings-btn';
    benchBtn.textContent = t('settings.benchmark.btn');
    benchBtn.style.cssText = 'margin-left: calc(var(--hud-unit) * 0.4); padding: 2px 8px; font-family: inherit; font-size: 0.85em; cursor: pointer; background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-radius: 3px;';
    const status = document.createElement('div');
    status.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.55); margin-top: 4px; grid-column: 1 / -1; display: none;';
    benchBtn.addEventListener('click', async () => {
      const app = (window as any)._app;
      if (!app) return;
      benchBtn.disabled = true;
      benchBtn.textContent = t('settings.benchmark.running');
      status.style.display = 'block';

      // Hide the settings modal itself so the user can see the Pixi
      // stage where the stress scene is rendering. The setProperty
      // with `important` guards against any CSS rule overriding a
      // plain inline display change.
      const settingsOverlay = document.querySelector('.settings-overlay') as HTMLElement | null;
      const prevDisplay = settingsOverlay?.style.getPropertyValue('display') ?? '';
      const prevPriority = settingsOverlay?.style.getPropertyPriority('display') ?? '';
      if (settingsOverlay) {
        settingsOverlay.style.setProperty('display', 'none', 'important');
      }
      // Also hide any HUD panels that might be covering the canvas.
      const hiddenHud: HTMLElement[] = [];
      document.querySelectorAll<HTMLElement>('[data-ui="true"]').forEach((el) => {
        if (el === settingsOverlay) return;
        const prev = el.style.getPropertyValue('visibility');
        if (prev !== 'hidden') {
          el.dataset._benchPrevVis = prev;
          el.style.setProperty('visibility', 'hidden', 'important');
          hiddenHud.push(el);
        }
      });

      // Fullscreen overlay with live stats while the benchmark runs.
      // Sits on top of the Pixi canvas so the user can see the stress
      // scene and the frame time ticker at the same time.
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position: fixed', 'inset: 0', 'z-index: 2147483000',
        'pointer-events: none',
        'display: flex', 'flex-direction: column',
        'justify-content: flex-end',  // card anchored to bottom so
        'align-items: center',        // the scene fills the rest
        'padding-bottom: 3vh',
        'font-family: var(--hud-font, monospace)',
      ].join(';');

      const card = document.createElement('div');
      card.style.cssText = [
        'background: rgba(0,0,0,0.55)',  // more transparent — scene shows through
        'backdrop-filter: blur(4px)',
        'border: 1px solid rgba(255,255,255,0.25)',
        'padding: 8px 14px', 'min-width: 300px',
        'border-radius: 4px',
        'color: #fff', 'text-align: center',
      ].join(';');
      const title = document.createElement('div');
      title.style.cssText = 'font-size: 1.05em; margin-bottom: 8px;';
      title.textContent = t('settings.benchmark.running');
      const progressWrap = document.createElement('div');
      progressWrap.style.cssText = 'width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-bottom: 6px;';
      const progressBar = document.createElement('div');
      progressBar.style.cssText = 'height: 100%; width: 0%; background: #6ec1ff; transition: width 80ms linear;';
      progressWrap.appendChild(progressBar);
      const liveStats = document.createElement('div');
      liveStats.style.cssText = 'font-size: 0.85em; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums;';
      liveStats.textContent = '—';
      card.append(title, progressWrap, liveStats);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      let reportShown = false;
      try {
        const result = await rodarBenchmark(app, (p, liveMs) => {
          progressBar.style.width = `${(p * 100).toFixed(1)}%`;
          const fps = liveMs > 0 ? Math.round(1000 / liveMs) : 0;
          liveStats.textContent = `${liveMs.toFixed(1)} ms · ${fps} FPS · ${Math.round(p * 100)}%`;
          status.textContent = `${Math.round(p * 100)}%`;
        });
        aplicarPreset(result.recommendedPreset);
        setConfig({ graphics: { ...getConfig().graphics, renderScale: result.recommendedRenderScale } });
        status.textContent = t('settings.benchmark.done', {
          ms: result.avgFrameMs.toFixed(1),
          preset: result.recommendedPreset,
          scale: result.recommendedRenderScale.toFixed(2),
        });
        _refreshBody?.();

        // Final report — a styled card with GPU tier, perf stats,
        // and applied recommendations. Stays visible until the
        // player clicks OK.
        while (card.firstChild) card.removeChild(card.firstChild);
        card.style.cssText = [
          'background: linear-gradient(180deg, rgba(12,16,28,0.92), rgba(4,6,12,0.92))',
          'backdrop-filter: blur(10px)',
          'border: 1px solid rgba(110,193,255,0.35)',
          'box-shadow: 0 0 40px rgba(110,193,255,0.15), inset 0 0 20px rgba(110,193,255,0.05)',
          'padding: 20px 26px 18px',
          'min-width: 420px', 'max-width: 520px',
          'border-radius: 6px',
          'color: #fff',
          'pointer-events: auto',
          'font-family: var(--hud-font, monospace)',
        ].join(';');

        const avgFps = result.avgFrameMs > 0 ? Math.round(1000 / result.avgFrameMs) : 0;
        const p95Fps = result.p95FrameMs > 0 ? Math.round(1000 / result.p95FrameMs) : 0;

        const tierColor: Record<string, string> = {
          'topo':         '#a8f0c8',
          'alto':         '#6ec1ff',
          'medio':        '#f5d86e',
          'entrada':      '#f5a86e',
          'fraco':        '#f27570',
          'muito-fraco':  '#c8585a',
        };
        const tierPt: Record<string, string> = {
          'topo':         'TOPO DE LINHA',
          'alto':         'ALTO',
          'medio':        'MÉDIO',
          'entrada':      'ENTRADA',
          'fraco':        'FRACO',
          'muito-fraco':  'MUITO FRACO',
        };
        const tierIdx: Record<string, number> = {
          'muito-fraco': 0, 'fraco': 1, 'entrada': 2, 'medio': 3, 'alto': 4, 'topo': 5,
        };

        // Header with big title + small subtitle
        const header = document.createElement('div');
        header.style.cssText = 'text-align: center; margin-bottom: 14px;';
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size: 1.2em; letter-spacing: 0.1em; color: #6ec1ff;';
        titleEl.textContent = '◆ RELATÓRIO DO BENCHMARK ◆';
        const subtitle = document.createElement('div');
        subtitle.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.5); margin-top: 2px;';
        subtitle.textContent = `${result.framesSampled} amostras · ${result.rendererName.toUpperCase()}`;
        header.append(titleEl, subtitle);

        // Section: GPU tier with colored bar
        const gpuSec = document.createElement('div');
        gpuSec.style.cssText = 'background: rgba(255,255,255,0.04); border-radius: 4px; padding: 10px 12px; margin-bottom: 10px;';
        const gpuLabel = document.createElement('div');
        gpuLabel.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.55); letter-spacing: 0.1em; margin-bottom: 4px;';
        gpuLabel.textContent = 'PARECIDO COM';
        // Main line: recognizable GPU models. Subtitle: plain-
        // language takeaway about what the machine handles. Tiny
        // line below: raw avg ms range for the curious.
        const gpuTierLine = document.createElement('div');
        gpuTierLine.style.cssText = `font-size: 1.05em; color: ${tierColor[result.gpuTier]}; font-weight: bold; line-height: 1.25;`;
        gpuTierLine.textContent = result.gpuPlainLabel;
        const gpuSummary = document.createElement('div');
        gpuSummary.style.cssText = 'font-size: 0.85em; color: rgba(255,255,255,0.8); margin-top: 4px;';
        gpuSummary.textContent = result.gpuPlainSummary;
        const gpuEq = document.createElement('div');
        gpuEq.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.45); margin-top: 4px; font-style: italic;';
        gpuEq.textContent = result.gpuTechLabel;
        // GPU tier bar — 6 segments colored by tier
        const tierBar = document.createElement('div');
        tierBar.style.cssText = 'display: flex; gap: 3px; margin-top: 8px;';
        const userIdx = tierIdx[result.gpuTier] ?? 0;
        for (let i = 0; i < 6; i++) {
          const seg = document.createElement('div');
          const active = i <= userIdx;
          seg.style.cssText = `flex: 1; height: 6px; border-radius: 2px; background: ${active ? tierColor[result.gpuTier] : 'rgba(255,255,255,0.08)'}; opacity: ${active ? (0.4 + (i / 6) * 0.6).toFixed(2) : '1'};`;
          tierBar.appendChild(seg);
        }
        gpuSec.append(gpuLabel, gpuTierLine, gpuSummary, gpuEq, tierBar);

        // Section: performance — two columns
        const perfSec = document.createElement('div');
        perfSec.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; background: rgba(255,255,255,0.04); border-radius: 4px; padding: 10px 12px; margin-bottom: 10px; font-variant-numeric: tabular-nums;';
        const perfTitle = document.createElement('div');
        perfTitle.style.cssText = 'grid-column: 1 / -1; font-size: 0.7em; color: rgba(255,255,255,0.55); letter-spacing: 0.1em; margin-bottom: 4px;';
        perfTitle.textContent = 'DESEMPENHO';
        const makeStat = (label: string, big: string, small: string, color = '#fff'): HTMLDivElement => {
          const box = document.createElement('div');
          const l = document.createElement('div');
          l.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.55);';
          l.textContent = label;
          const v = document.createElement('div');
          v.style.cssText = `font-size: 1em; color: ${color}; font-weight: bold;`;
          v.textContent = big;
          const s = document.createElement('div');
          s.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.45);';
          s.textContent = small;
          box.append(l, v, s);
          return box;
        };
        perfSec.append(
          perfTitle,
          makeStat('Frame médio', `${result.avgFrameMs.toFixed(1)} ms`, `${avgFps} FPS`),
          makeStat('Frame p95',   `${result.p95FrameMs.toFixed(1)} ms`, `${p95Fps} FPS`),
          makeStat('Mais rápido', `${result.minFrameMs.toFixed(1)} ms`, ''),
          makeStat('Mais lento',  `${result.maxFrameMs.toFixed(1)} ms`, ''),
        );

        // Section: recommendation (highlighted)
        const recSec = document.createElement('div');
        recSec.style.cssText = 'background: linear-gradient(180deg, rgba(110,193,255,0.14), rgba(110,193,255,0.04)); border: 1px solid rgba(110,193,255,0.3); border-radius: 4px; padding: 10px 12px; margin-bottom: 10px;';
        const recTitle = document.createElement('div');
        recTitle.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.6); letter-spacing: 0.1em; margin-bottom: 6px;';
        recTitle.textContent = 'RECOMENDADO';
        const recGrid = document.createElement('div');
        recGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;';
        const recPreset = document.createElement('div');
        recPreset.innerHTML = '';
        const presetLbl = document.createElement('div');
        presetLbl.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.5);';
        presetLbl.textContent = 'Preset';
        const presetVal = document.createElement('div');
        presetVal.style.cssText = 'font-size: 1.1em; color: #6ec1ff; font-weight: bold;';
        presetVal.textContent = result.recommendedPreset.toUpperCase();
        recPreset.append(presetLbl, presetVal);
        const recScale = document.createElement('div');
        const scaleLbl = document.createElement('div');
        scaleLbl.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.5);';
        scaleLbl.textContent = 'Escala de render';
        const scaleVal = document.createElement('div');
        scaleVal.style.cssText = 'font-size: 1.1em; color: #6ec1ff; font-weight: bold;';
        scaleVal.textContent = `${result.recommendedRenderScale.toFixed(2)}×`;
        recScale.append(scaleLbl, scaleVal);
        recGrid.append(recPreset, recScale);
        recSec.append(recTitle, recGrid);

        // Applied message + OK button
        const applied = document.createElement('div');
        applied.style.cssText = 'text-align: center; color: #5fbd6f; font-size: 0.85em; margin-bottom: 12px;';
        applied.textContent = '✓ configurações aplicadas automaticamente';

        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = [
          'display: block', 'margin: 0 auto',
          'padding: 8px 32px',
          'background: rgba(110,193,255,0.15)', 'color: #fff',
          'border: 1px solid rgba(110,193,255,0.5)', 'border-radius: 3px',
          'cursor: pointer', 'pointer-events: auto',
          'font-family: inherit', 'font-size: 0.9em', 'letter-spacing: 0.1em',
          'transition: background 120ms ease',
        ].join(';');
        closeBtn.textContent = 'OK';
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(110,193,255,0.3)'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'rgba(110,193,255,0.15)'; });
        closeBtn.addEventListener('click', () => { try { overlay.remove(); } catch { /* noop */ } });

        card.append(header, gpuSec, perfSec, recSec, applied, closeBtn);
        overlay.style.justifyContent = 'center';
        overlay.style.paddingBottom = '0';
        reportShown = true;
      } catch (err) {
        console.warn('[benchmark] failed:', err);
        status.textContent = t('settings.benchmark.failed');
      } finally {
        benchBtn.disabled = false;
        benchBtn.textContent = t('settings.benchmark.btn');
        // Only remove the overlay if we didn't show the persistent
        // report card — that one stays until the user clicks OK.
        if (!reportShown) {
          try { overlay.remove(); } catch { /* noop */ }
        }
        if (settingsOverlay) {
          settingsOverlay.style.setProperty('display', prevDisplay, prevPriority);
        }
        for (const el of hiddenHud) {
          el.style.setProperty('visibility', el.dataset._benchPrevVis ?? '');
          delete el.dataset._benchPrevVis;
        }
      }
    });
    row.appendChild(benchBtn);
    row.appendChild(status);
    body.appendChild(row);
  }

  // Fullscreen
  {
    const [row] = rowWithLabel(t('settings.row.fullscreen'), 'fullscreen');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.fullscreen;
    cb.addEventListener('change', () => {
      // Fullscreen must be called sync in the handler, BEFORE setConfig
      if (cb.checked) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn('[fullscreen] blocked:', err);
          cb.checked = false;
          toast(t('toast.fullscreen_bloqueado'), 'err');
        });
      } else {
        document.exitFullscreen().catch(() => {});
      }
      setConfig({ graphics: { ...getConfig().graphics, fullscreen: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Scanlines
  {
    const [row] = rowWithLabel(t('settings.row.scanlines'), 'scanlines');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.scanlines;
    cb.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, scanlines: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Mostrar FPS
  {
    const [row] = rowWithLabel(t('settings.row.mostrar_fps'), 'fps');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.mostrarFps;
    cb.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, mostrarFps: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Mostrar uso de RAM
  {
    const [row] = rowWithLabel(t('settings.row.mostrar_ram'), 'ram');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.mostrarRam;
    cb.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, mostrarRam: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Vsync — its own checkbox. Off drives the game loop via setTimeout
  // so the FPS counter reads the raw processing rate (past the monitor
  // refresh lock).
  {
    const [row] = rowWithLabel(t('settings.row.vsync'), 'vsync');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.vsync;
    cb.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, vsync: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // FPS cap — plain numeric cap, 0 = no cap. Applies on top of vsync.
  {
    const [row] = rowWithLabel(t('settings.row.limite_fps'), 'fpsCap');
    const select = criarSelect([
      ['0', t('settings.opt.sem_limite')],
      ['30', '30'],
      ['60', '60'],
      ['120', '120'],
      ['144', '144'],
      ['240', '240'],
    ], String(gfx.fpsCap));
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, fpsCap: Number(select.dataset.value!) } });
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // Render scale — slider from 0.1× to 4×. Multiplies the pixel
  // count the GPU processes without changing the on-screen layout.
  // A live readout below the slider shows the effective render
  // resolution (window.css × scale × dpr) alongside the native CSS
  // size so users can see exactly how many pixels they just saved.
  {
    const [row, lbl] = rowWithLabel(t('settings.row.escala_render'), 'renderScale');
    lbl.style.gridColumn = '1 / -1';
    row.style.gridTemplateColumns = '1fr';

    const controlBar = document.createElement('div');
    controlBar.style.cssText = 'display: flex; align-items: center; gap: calc(var(--hud-unit) * 0.6); width: 100%;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.1';
    slider.max = '4';
    slider.step = '0.05';
    slider.value = String(gfx.renderScale ?? 1);
    slider.style.cssText = 'flex: 1;';

    const scaleReadout = document.createElement('span');
    scaleReadout.style.cssText = 'min-width: 3.5em; text-align: right; font-variant-numeric: tabular-nums; color: #fff;';

    const resReadout = document.createElement('div');
    resReadout.style.cssText = 'font-size: 0.7em; color: rgba(255,255,255,0.55); margin-top: 3px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em;';

    const warnReadout = document.createElement('div');
    warnReadout.style.cssText = 'font-size: 0.7em; color: #ff9b6b; margin-top: 2px; display: none;';

    // Probe the live renderer for its maximum supported backing-store
    // size. WebGPU's default is 8192; WebGL2 is typically 16384. When
    // requested (viewport × scale × dpr) exceeds this, WebGPU fails
    // silently and the canvas renders blank — clamp is in place on the
    // render side, but we want the user to know why their 4× setting
    // isn't having full effect.
    const probeLimits = (): { max: number; rendererName: string } => {
      const anyApp = (window as any)._app;
      const r = anyApp?.renderer;
      const rendererName = String(r?.name ?? r?.type ?? 'unknown').toLowerCase();
      const max = r?.limits?.maxTextureSize ?? r?.maxTextureSize ?? 8192;
      return { max, rendererName };
    };

    const refresh = (v: number): void => {
      scaleReadout.textContent = `${v.toFixed(2)}×`;
      const dpr = window.devicePixelRatio || 1;
      const renderW = Math.round(window.innerWidth * v * dpr);
      const renderH = Math.round(window.innerHeight * v * dpr);
      resReadout.textContent = `${renderW}×${renderH}`;

      const { max, rendererName } = probeLimits();
      const biggest = Math.max(renderW, renderH);
      // Warn on WebGL / WebGPU (both have GPU texture size ceilings).
      // Canvas2D has no such limit so the warning stays off.
      const isGpuRenderer = rendererName.includes('webgl') || rendererName.includes('webgpu');
      if (isGpuRenderer && biggest > max) {
        const effective = (max / (Math.max(window.innerWidth, window.innerHeight) * dpr));
        const label = rendererName.includes('webgpu') ? 'WebGPU' : 'WebGL';
        warnReadout.style.display = 'block';
        warnReadout.textContent = `⚠ passa do limite ${label} (${max}px) — aplicado como ${effective.toFixed(2)}×`;
      } else {
        warnReadout.style.display = 'none';
      }
    };
    refresh(Number(slider.value));

    slider.addEventListener('input', () => {
      refresh(Number(slider.value));
    });
    slider.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, renderScale: Number(slider.value) } });
    });

    controlBar.append(slider, scaleReadout);
    row.appendChild(controlBar);
    row.appendChild(resReadout);
    row.appendChild(warnReadout);
    body.appendChild(row);
  }

  // Motor section (Task 26)
  renderGraphicsTabMotor(body);
  // Avan\u00E7ado section (Task 27)
  renderGraphicsTabAvancado(body);
}

// ─── Graphics tab: Motor section (Task 26) ───────────────────────────

function renderGraphicsTabMotor(body: HTMLDivElement): void {
  const gfx = getConfig().graphics;

  const sec = document.createElement('div');
  sec.className = 'settings-section';
  sec.textContent = t('settings.secao_motor');
  body.appendChild(sec);

  // Renderer
  {
    const [row] = rowWithLabel(t('settings.row.renderer'), 'renderer');
    const select = criarSelect([
      ['webgl', t('settings.opt.webgl')],
      ['webgpu', t('settings.opt.webgpu')],
      ['software', t('settings.opt.software')],
    ], gfx.renderer);
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, renderer: select.dataset.value! as any } });
      showReloadBanner(row);
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // WebGL version (only if renderer=webgl)
  if (gfx.renderer === 'webgl') {
    const [row] = rowWithLabel(t('settings.row.webgl_version'), 'webglVersion');
    const select = criarSelect([
      ['auto', t('settings.opt.automatico')],
      ['2', t('settings.opt.webgl2_forcado')],
      ['1', t('settings.opt.webgl1_forcado')],
    ], gfx.webglVersion);
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, webglVersion: select.dataset.value! as typeof gfx.webglVersion } });
      showReloadBanner(row);
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // GPU preference
  {
    const [row] = rowWithLabel(t('settings.row.gpu_pref'), 'gpuPref');
    const select = criarSelect([
      ['auto', t('settings.opt.automatico')],
      ['high-performance', t('settings.opt.alta_perf')],
      ['low-power', t('settings.opt.economia')],
    ], gfx.gpuPreference);
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, gpuPreference: select.dataset.value! as typeof gfx.gpuPreference } });
      showReloadBanner(row);
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // "Ver informa\u00E7\u00F5es" button
  {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const btn = document.createElement('button');
    btn.textContent = t('settings.ver_info_renderer');
    btn.style.cssText = 'background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8); padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 1); cursor: pointer;';
    btn.addEventListener('click', () => {
      const app = (window as any)._app; // exposed by main.ts for debug
      if (app) abrirRendererInfoModal(app);
    });
    row.appendChild(btn);
    const helpWrap = document.createElement('span');
    comHelp(helpWrap, tooltip('verInfo'));
    row.appendChild(helpWrap);
    body.appendChild(row);
  }
}

// ─── Graphics tab: Avan\u00E7ado section (Task 27) ────────────────────────

function renderGraphicsTabAvancado(body: HTMLDivElement): void {
  const gfx = getConfig().graphics;

  const sec = document.createElement('div');
  sec.className = 'settings-section';
  sec.textContent = t('settings.secao_avancado');
  body.appendChild(sec);

  // Mostrar \u00F3rbitas
  {
    const [row] = rowWithLabel(t('settings.row.mostrar_orbitas'), 'orbitas');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.mostrarOrbitas;
    cb.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, mostrarOrbitas: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Densidade de estrelas
  {
    const [row] = rowWithLabel(t('settings.row.densidade_estrelas'), 'starfield');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(gfx.densidadeStarfield * 100));
    const display = document.createElement('span');
    display.className = 'value-display';
    display.textContent = `${slider.value}%`;
    slider.addEventListener('input', () => {
      display.textContent = `${slider.value}%`;
    });
    slider.addEventListener('change', () => {
      const v = Number(slider.value) / 100;
      setConfig({ graphics: { ...getConfig().graphics, densidadeStarfield: v } });
      showReloadBanner(row);
    });
    row.appendChild(slider);
    row.appendChild(display);
    body.appendChild(row);
  }

  // Max fantasmas
  {
    const [row] = rowWithLabel(t('settings.row.max_fantasmas'), 'fantasmas');
    const select = criarSelect([
      ['-1', t('settings.opt.ilimitado')],
      ['50', '50'],
      ['30', '30'],
      ['15', '15'],
      ['5', '5'],
      ['0', t('settings.opt.desligado')],
    ], String(gfx.maxFantasmas));
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, maxFantasmas: Number(select.dataset.value!) } });
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // Shader ao vivo
  {
    const [row] = rowWithLabel(t('settings.row.shader_live'), 'shaderLive');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.shaderLive;
    cb.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, shaderLive: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }
}

// ─── Gameplay tab (Task 28) ──────────────────────────────────────────

function renderGameplayTab(body: HTMLDivElement): void {
  const gp = getConfig().gameplay;

  // Autosave
  {
    const [row] = rowWithLabel(t('settings.row.autosave'), 'autosave');
    const select = criarSelect([
      ['0', t('settings.opt.desligado')],
      ['30000', t('settings.opt.autosave_30s')],
      ['60000', t('settings.opt.autosave_1m')],
      ['120000', t('settings.opt.autosave_2m')],
      ['300000', t('settings.opt.autosave_5m')],
    ], String(getConfig().autosaveIntervalMs));
    select.addEventListener('change', () => {
      setConfig({ autosaveIntervalMs: Number(select.dataset.value!) });
      // Notify save system of config change
      import('../world/save').then(({ notificarMudancaConfig }) => notificarMudancaConfig());
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // Modo de save
  {
    const [row] = rowWithLabel(t('settings.row.save_experimental'), 'saveMode');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = getConfig().saveMode === 'experimental';
    cb.addEventListener('change', () => {
      setConfig({ saveMode: cb.checked ? 'experimental' : 'periodic' });
      import('../world/save').then(({ trocarModoSave }) => trocarModoSave());
      import('./toast').then(({ toast }) => toast(cb.checked ? t('toast.save_experimental_on') : t('toast.save_padrao_on'), 'info'));
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Confirmar destrutivo
  {
    const [row] = rowWithLabel(t('settings.row.confirmar_destrutivo'), 'confirmar');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gp.confirmarDestrutivo;
    cb.addEventListener('change', () => {
      setConfig({ gameplay: { ...getConfig().gameplay, confirmarDestrutivo: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Edge-scroll
  {
    const [row] = rowWithLabel(t('settings.row.edge_scroll'), 'edge');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gp.edgeScroll;
    cb.addEventListener('change', () => {
      setConfig({ gameplay: { ...getConfig().gameplay, edgeScroll: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Idioma
  {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const lbl = document.createElement('label');
    lbl.textContent = t('idioma.label');
    row.appendChild(lbl);
    const select = criarSelect([
      ['pt', t('idioma.pt')],
      ['en', t('idioma.en')],
    ], getIdioma());
    select.addEventListener('change', () => {
      trocarIdioma(select.dataset.value as 'pt' | 'en');
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // ── Controles section ──
  renderControlesSection(body);
}

function getCategoriaNames(): Record<ActionDef['categoria'], string> {
  return {
    camera: t('input.cat_camera'),
    interface: t('input.cat_interface'),
    jogo: t('input.cat_jogo'),
    debug: t('input.cat_debug'),
  };
}

const KEY_DISPLAY: Record<string, string> = {
  Equal: '=', Minus: '-', NumpadAdd: 'Num+', NumpadSubtract: 'Num-',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Space', Escape: 'Esc', Backquote: '`',
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
};

function formatKeyCode(code: string): string {
  return KEY_DISPLAY[code] ?? code.replace(/^Key/, '');
}

function renderControlesSection(body: HTMLDivElement): void {
  const sec = document.createElement('div');
  sec.className = 'settings-section';
  sec.textContent = t('input.titulo_secao');
  body.appendChild(sec);

  const keymap = getActiveKeymap();
  const categoriaNames = getCategoriaNames();

  for (const cat of CATEGORIAS_ORDEM) {
    const catActions = ACTIONS.filter((a) => a.categoria === cat);
    if (catActions.length === 0) continue;

    const catLabel = document.createElement('div');
    catLabel.style.cssText = 'font-size: calc(var(--hud-unit) * 0.7); color: var(--hud-text-dim); text-transform: uppercase; letter-spacing: 0.1em; margin-top: calc(var(--hud-unit) * 0.8); padding-bottom: calc(var(--hud-unit) * 0.2); border-bottom: 1px solid var(--hud-border);';
    catLabel.textContent = categoriaNames[cat] ?? cat;
    body.appendChild(catLabel);

    for (const action of catActions) {
      const row = document.createElement('div');
      row.className = 'settings-row';

      const lbl = document.createElement('label');
      lbl.textContent = t(action.labelKey);
      row.appendChild(lbl);

      const keys = keymap[action.id] ?? action.defaultKeys;
      const keyDisplay = document.createElement('span');
      keyDisplay.className = 'value-display';
      keyDisplay.textContent = keys.map(formatKeyCode).join(' / ');
      row.appendChild(keyDisplay);

      const rebindBtn = document.createElement('button');
      rebindBtn.textContent = t('input.rebind');
      rebindBtn.style.cssText = 'background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text-dim); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.7); padding: calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.5); cursor: pointer;';
      rebindBtn.addEventListener('click', () => {
        iniciarRebind(action, keyDisplay, rebindBtn);
      });
      row.appendChild(rebindBtn);

      body.appendChild(row);
    }
  }

  const resetBtn = document.createElement('button');
  resetBtn.textContent = t('input.resetar');
  resetBtn.style.cssText = 'margin-top: calc(var(--hud-unit) * 0.8); background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text-dim); font-family: var(--hud-font); padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1); cursor: pointer; width: 100%;';
  resetBtn.addEventListener('click', () => {
    setConfig({ input: { bindings: {} } });
    _refreshBody?.();
  });
  body.appendChild(resetBtn);
}

function iniciarRebind(action: ActionDef, display: HTMLSpanElement, btn: HTMLButtonElement): void {
  const originalText = btn.textContent;
  btn.textContent = t('input.pressione');
  display.textContent = '...';
  setDispatcherHabilitado(false);

  function cleanup(): void {
    window.removeEventListener('keydown', handler, true);
    setDispatcherHabilitado(true);
    btn.textContent = originalText;
    const keys = getActiveKeymap()[action.id] ?? action.defaultKeys;
    display.textContent = keys.map(formatKeyCode).join(' / ');
  }

  function applyBinding(code: string): void {
    const currentBindings: Record<string, string[]> = { ...(getConfig().input?.bindings ?? {}) };
    currentBindings[action.id] = [code];
    setConfig({ input: { bindings: currentBindings } });
    cleanup();
  }

  function handler(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') {
      cleanup();
      return;
    }

    const conflito = detectarConflito(e.code, action.id);
    if (conflito) {
      const conflictAction = ACTION_BY_ID[conflito];
      const code = e.code;
      window.removeEventListener('keydown', handler, true);
      void confirmar({
        title: t('input.conflito_titulo'),
        message: t('input.conflito', { acao: conflictAction ? t(conflictAction.labelKey) : conflito }),
        confirmLabel: t('input.trocar'),
        cancelLabel: t('confirm.cancelar'),
      }).then((ok) => {
        if (!ok) { cleanup(); return; }
        const currentBindings: Record<string, string[]> = { ...(getConfig().input?.bindings ?? {}) };
        const conflictCurrent = currentBindings[conflito] ?? conflictAction?.defaultKeys ?? [];
        const filtered = conflictCurrent.filter((k: string) => k !== code);
        if (filtered.length === 0) delete currentBindings[conflito];
        else currentBindings[conflito] = filtered;
        currentBindings[action.id] = [code];
        setConfig({ input: { bindings: currentBindings } });
        cleanup();
      });
      return;
    }

    applyBinding(e.code);
  }

  window.addEventListener('keydown', handler, true);
}

// ─── Reset functions (Task 29) ───────────────────────────────────────

function resetarAba(tab: Tab): void {
  if (tab === 'audio') {
    setConfig({ audio: DEFAULTS.audio });
  } else if (tab === 'graphics') {
    setConfig({ graphics: DEFAULTS.graphics });
  } else if (tab === 'gameplay') {
    setConfig({ gameplay: DEFAULTS.gameplay });
  }
}

function resetarTudo(): void {
  setConfig(DEFAULTS);
}

