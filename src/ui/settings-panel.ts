import { getConfig, setConfig, DEFAULTS } from '../core/config';
import { aplicarPreset, presetBateComFlagsDerivadas } from '../core/graphics-preset';
import { comHelp } from './tooltip';
import { abrirRendererInfoModal } from './renderer-info-modal';
import { toast } from './toast';
import { confirmarAcao } from './confirmar-acao';

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

// ─── Tooltip texts ───────────────────────────────────────────────────

const TOOLTIPS = {
  qualidade: `Qualidade

Preset que ajusta m\u00FAltiplas op\u00E7\u00F5es avan\u00E7adas de
uma vez. Use 'Baixo' ou 'M\u00EDnimo' se o jogo estiver
travando.

Mostra '(personalizado)' quando voc\u00EA mexeu em
op\u00E7\u00F5es avan\u00E7adas depois de escolher um preset.`,
  fullscreen: `Fullscreen

Alterna tela cheia. O navegador pode pedir
permiss\u00E3o na primeira vez.`,
  scanlines: `Scanlines CRT

Efeito visual retr\u00F4 com linhas horizontais
sobrepostas. Custo de desempenho: desprez\u00EDvel.`,
  fps: `Mostrar FPS

Exibe o contador de quadros por segundo no canto
da tela. \u00DAtil pra diagnosticar queda de desempenho.`,
  fpsCap: `Limite de FPS

Limita a taxa de quadros. Valores menores
economizam CPU/GPU e bateria em laptops.

'Sem limite' deixa o jogo rodar t\u00E3o r\u00E1pido quanto
o navegador permitir.`,
  renderer: `Motor de renderiza\u00E7\u00E3o

Biblioteca gr\u00E1fica que o jogo usa pra desenhar.

\u2022 WebGL
  Padr\u00E3o est\u00E1vel. Funciona em todos os navegadores
  modernos e \u00E9 a escolha segura.

\u2022 WebGPU
  Sucessor do WebGL, pode ser 20\u201340% mais r\u00E1pido em
  hardware moderno. Exige navegador recente: Chrome
  e Edge atuais suportam bem; Firefox e Safari ainda
  t\u00EAm suporte limitado.

\u2022 Software (Canvas)
  Renderiza\u00E7\u00E3o por software via Canvas 2D, sem
  usar a GPU. Muito mais lento mas funciona em
  qualquer dispositivo. Aplica qualidade M\u00EDnimo
  automaticamente. Shaders n\u00E3o funcionam neste modo.

\u2022 Fallback autom\u00E1tico
  Se o WebGPU falhar ao iniciar, o jogo volta sozinho
  pro WebGL e avisa na tela.

Mudan\u00E7a exige recarregar o jogo.`,
  webglVersion: `Vers\u00E3o do WebGL

Vers\u00E3o da especifica\u00E7\u00E3o usada pela pipeline gr\u00E1fica.

\u2022 Autom\u00E1tico
  O Pixi escolhe WebGL 2 se dispon\u00EDvel, com fallback
  pra WebGL 1. Recomendado pra 99% dos casos.

\u2022 WebGL 2 for\u00E7ado
  For\u00E7a a vers\u00E3o mais nova, mais r\u00E1pida e com mais
  features. Falha ao iniciar se sua GPU ou driver
  n\u00E3o suportar.

\u2022 WebGL 1 for\u00E7ado
  For\u00E7a a vers\u00E3o antiga, compat\u00EDvel com GPUs muito
  velhas e drivers bugados. Use s\u00F3 se o WebGL 2
  estiver crashando ou renderizando com artefatos.

S\u00F3 aplica quando o motor \u00E9 WebGL (ignorado em WebGPU).
Requer recarregar o jogo.`,
  gpuPref: `Prefer\u00EAncia de GPU

Diz ao navegador qual GPU usar \u2014 importa em laptops
que t\u00EAm tanto uma GPU integrada (economia) quanto
uma discreta (performance).

\u2022 Autom\u00E1tico
  O navegador decide. Geralmente integrada pra
  economizar bateria. Recomendado.

\u2022 Alta performance
  For\u00E7a a GPU discreta. Jogo roda mais r\u00E1pido mas
  consome muito mais bateria em laptops.

\u2022 Economia de energia
  For\u00E7a a GPU integrada. Menor performance, mas
  m\u00E1xima autonomia em laptops.

Em desktops com uma GPU s\u00F3, n\u00E3o muda nada.
Requer recarregar o jogo.`,
  verInfo: `Ver informa\u00E7\u00F5es do renderer

Abre um di\u00E1logo com detalhes t\u00E9cnicos da pipeline
gr\u00E1fica ativa: motor em uso, GPU, vendor, vers\u00E3o,
capacidades (tamanho m\u00E1ximo de textura, vertex
attribs, extens\u00F5es suportadas) e aviso se estiver
rodando em software.

\u00DAtil pra debug e pra saber se vale a pena tentar
WebGPU ou se h\u00E1 problema de acelera\u00E7\u00E3o.`,
  orbitas: `Mostrar \u00F3rbitas

Desenha as linhas circulares que mostram o caminho
dos planetas em volta da estrela. Desligar reduz
custo de rendering em sistemas com muitos planetas.`,
  starfield: `Densidade de estrelas

Quantas estrelas comp\u00F5em o fundo espacial.

Valores baixos ganham performance em m\u00E1quinas
fracas. Requer recarregar o jogo pra aplicar
(o starfield \u00E9 gerado uma vez na cria\u00E7\u00E3o do mundo).`,
  fantasmas: `Max fantasmas

N\u00FAmero m\u00E1ximo de planetas 'lembrados' que aparecem
como sombra quando saem do seu campo de vis\u00E3o.

Limitar reduz custo de rendering sem alterar o
gameplay \u2014 o jogo ainda lembra de todos, s\u00F3 mostra
os N mais recentes visualmente.`,
  shaderLive: `Shader ao vivo

Quando ligado, planetas e estrelas t\u00EAm anima\u00E7\u00E3o de
superf\u00EDcie renderizada por shader em tempo real \u2014
bonito mas caro.

Quando desligado, a anima\u00E7\u00E3o congela imediatamente.
Mesmo visual, desempenho muito maior.`,
  autosave: `Intervalo de autosave\n\nCom que frequ\u00EAncia o jogo salva automaticamente.\n'Desligado' desativa o autosave \u2014 s\u00F3 salva manualmente.`,
  saveMode: `Save experimental (IndexedDB)\n\nQuando ligado, salva em tempo real via IndexedDB\nem vez do m\u00E9todo padr\u00E3o por localStorage.\n\nMais r\u00E1pido e confi\u00E1vel para saves grandes.`,
  confirmar: `Confirmar a\u00E7\u00F5es destrutivas

Mostra um di\u00E1logo de confirma\u00E7\u00E3o antes de a\u00E7\u00F5es
irrevers\u00EDveis como sucatear naves ou apagar saves.`,
  edge: `Edge-scroll

Move a c\u00E2mera automaticamente quando o cursor do
mouse fica perto das bordas da tela. Desliga se
o cursor estiver sobre um painel de interface.`,
};

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

function rowWithLabel(text: string, tooltipKey: keyof typeof TOOLTIPS): [HTMLDivElement, HTMLLabelElement] {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const lbl = document.createElement('label');
  lbl.textContent = text;
  comHelp(lbl, TOOLTIPS[tooltipKey]);
  row.appendChild(lbl);
  return [row, lbl];
}

function showReloadBanner(afterRow: HTMLDivElement): void {
  // Don't duplicate existing banner
  if (afterRow.nextElementSibling?.classList?.contains('settings-reload-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'settings-reload-banner';
  const msg = document.createElement('span');
  msg.textContent = 'Requer recarregar o jogo.';
  const btn = document.createElement('button');
  btn.textContent = 'Recarregar agora';
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
    ['audio', '\u00C1udio'],
    ['graphics', 'Gr\u00E1ficos'],
    ['gameplay', 'Jogabilidade'],
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
  resetTab.textContent = 'Resetar esta aba';
  resetTab.addEventListener('click', () => {
    resetarAba(_currentTab);
    refreshBody();
  });
  const resetAll = document.createElement('button');
  resetAll.textContent = 'Resetar tudo';
  resetAll.addEventListener('click', () => {
    confirmarAcao('Resetar todas as configura\u00E7\u00F5es?', () => {
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
  title.textContent = 'Configura\u00E7\u00F5es';
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
    ['audio', '\u00C1udio'],
    ['graphics', 'Gr\u00E1ficos'],
    ['gameplay', 'Jogabilidade'],
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
  resetTab.textContent = 'Resetar esta aba';
  resetTab.addEventListener('click', () => {
    resetarAba(_currentTab);
    refreshBody();
  });
  const resetAll = document.createElement('button');
  resetAll.textContent = 'Resetar tudo';
  resetAll.addEventListener('click', () => {
    confirmarAcao('Resetar todas as configurações?', () => {
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
  type CatKey = 'master' | 'sfx' | 'ui' | 'aviso';
  const cats: Array<[CatKey, string]> = [
    ['master', 'Master'],
    ['sfx', 'SFX Jogo'],
    ['ui', 'SFX UI'],
    ['aviso', 'Avisos'],
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
    muteBtn.textContent = cfg.audio[key].muted ? 'MUTE' : 'ON';
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
      muteBtn.textContent = newMuted ? 'MUTE' : 'ON';
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
    const [row] = rowWithLabel('Qualidade', 'qualidade');
    const isCustom = !presetBateComFlagsDerivadas(cfg);
    const options: Array<[string, string]> = [
      ['alto', 'Alto'],
      ['medio', 'M\u00E9dio'],
      ['baixo', 'Baixo'],
      ['minimo', 'M\u00EDnimo'],
    ];
    if (isCustom) {
      options.push(['personalizado', 'Personalizado']);
    }
    const select = criarSelect(options, isCustom ? 'personalizado' : gfx.qualidadeEfeitos);
    select.addEventListener('change', () => {
      const val = select.dataset.value!;
      if (val === 'personalizado') return; // no-op, already custom
      aplicarPreset(val as typeof gfx.qualidadeEfeitos);
      _refreshBody?.();
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // Fullscreen
  {
    const [row] = rowWithLabel('Fullscreen', 'fullscreen');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.fullscreen;
    cb.addEventListener('change', () => {
      // Fullscreen must be called sync in the handler, BEFORE setConfig
      if (cb.checked) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn('[fullscreen] blocked:', err);
          cb.checked = false;
          toast('Fullscreen bloqueado pelo navegador', 'err');
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
    const [row] = rowWithLabel('Scanlines CRT', 'scanlines');
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
    const [row] = rowWithLabel('Mostrar FPS', 'fps');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gfx.mostrarFps;
    cb.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, mostrarFps: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // FPS cap
  {
    const [row] = rowWithLabel('Limite de FPS', 'fpsCap');
    const select = criarSelect([
      ['0', 'Sem limite'],
      ['30', '30'],
      ['60', '60'],
      ['120', '120'],
    ], String(gfx.fpsCap));
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, fpsCap: Number(select.dataset.value!) } });
    });
    row.appendChild(select);
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
  sec.textContent = 'Motor';
  body.appendChild(sec);

  // Renderer
  {
    const [row] = rowWithLabel('Motor de renderiza\u00E7\u00E3o', 'renderer');
    const select = criarSelect([
      ['webgl', 'WebGL'],
      ['webgpu', 'WebGPU'],
      ['software', 'Software'],
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
    const [row] = rowWithLabel('Vers\u00E3o do WebGL', 'webglVersion');
    const select = criarSelect([
      ['auto', 'Autom\u00E1tico'],
      ['2', 'WebGL 2 for\u00E7ado'],
      ['1', 'WebGL 1 for\u00E7ado'],
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
    const [row] = rowWithLabel('Prefer\u00EAncia de GPU', 'gpuPref');
    const select = criarSelect([
      ['auto', 'Autom\u00E1tico'],
      ['high-performance', 'Alta performance'],
      ['low-power', 'Economia de energia'],
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
    btn.textContent = 'Ver informa\u00E7\u00F5es do renderer';
    btn.style.cssText = 'background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8); padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 1); cursor: pointer;';
    btn.addEventListener('click', () => {
      const app = (window as any)._app; // exposed by main.ts for debug
      if (app) abrirRendererInfoModal(app);
    });
    row.appendChild(btn);
    const helpWrap = document.createElement('span');
    comHelp(helpWrap, TOOLTIPS.verInfo);
    row.appendChild(helpWrap);
    body.appendChild(row);
  }
}

// ─── Graphics tab: Avan\u00E7ado section (Task 27) ────────────────────────

function renderGraphicsTabAvancado(body: HTMLDivElement): void {
  const gfx = getConfig().graphics;

  const sec = document.createElement('div');
  sec.className = 'settings-section';
  sec.textContent = 'Avan\u00E7ado';
  body.appendChild(sec);

  // Mostrar \u00F3rbitas
  {
    const [row] = rowWithLabel('Mostrar \u00F3rbitas', 'orbitas');
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
    const [row] = rowWithLabel('Densidade de estrelas', 'starfield');
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
    const [row] = rowWithLabel('Max fantasmas', 'fantasmas');
    const select = criarSelect([
      ['-1', 'Ilimitado'],
      ['50', '50'],
      ['30', '30'],
      ['15', '15'],
      ['5', '5'],
      ['0', 'Desligado'],
    ], String(gfx.maxFantasmas));
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, maxFantasmas: Number(select.dataset.value!) } });
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // Shader ao vivo
  {
    const [row] = rowWithLabel('Shader ao vivo', 'shaderLive');
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
    const [row] = rowWithLabel('Intervalo de autosave', 'autosave');
    const select = criarSelect([
      ['0', 'Desligado'],
      ['30000', '30 segundos'],
      ['60000', '1 minuto'],
      ['120000', '2 minutos'],
      ['300000', '5 minutos'],
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
    const [row] = rowWithLabel('Save experimental (IndexedDB)', 'saveMode');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = getConfig().saveMode === 'experimental';
    cb.addEventListener('change', () => {
      setConfig({ saveMode: cb.checked ? 'experimental' : 'periodic' });
      import('../world/save').then(({ trocarModoSave }) => trocarModoSave());
      import('./toast').then(({ toast }) => toast(cb.checked ? 'Modo experimental ativado' : 'Modo padr\u00E3o ativado', 'info'));
    });
    row.appendChild(cb);
    body.appendChild(row);
  }

  // Confirmar destrutivo
  {
    const [row] = rowWithLabel('Confirmar a\u00E7\u00F5es destrutivas', 'confirmar');
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
    const [row] = rowWithLabel('Edge-scroll', 'edge');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gp.edgeScroll;
    cb.addEventListener('change', () => {
      setConfig({ gameplay: { ...getConfig().gameplay, edgeScroll: cb.checked } });
    });
    row.appendChild(cb);
    body.appendChild(row);
  }
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

