import { getConfig, setConfig, DEFAULTS } from '../core/config';
import { aplicarPreset, presetBateComFlagsDerivadas } from '../core/graphics-preset';
import { comHelp } from './tooltip';
import { abrirRendererInfoModal } from './renderer-info-modal';
import { notificarMudancaConfig, trocarModoSave } from '../world/save';
import { toast } from './toast';

type Tab = 'audio' | 'graphics' | 'gameplay';

let _overlay: HTMLDivElement | null = null;
let _currentTab: Tab = 'audio';
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

Quando desligado, o shader roda uma vez na cria\u00E7\u00E3o
e o resultado \u00E9 guardado como textura fixa: mesmo
visual, anima\u00E7\u00E3o congelada, desempenho muito maior.

Requer recarregar o jogo.`,
  confirmar: `Confirmar a\u00E7\u00F5es destrutivas

Mostra um di\u00E1logo de confirma\u00E7\u00E3o antes de a\u00E7\u00F5es
irrevers\u00EDveis como sucatear naves ou apagar saves.`,
  edge: `Edge-scroll

Move a c\u00E2mera automaticamente quando o cursor do
mouse fica perto das bordas da tela. Desliga se
o cursor estiver sobre um painel de interface.`,
};

// ─── Styles ──────────────────────────────────────────────────────────

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .settings-overlay {
      position: fixed; inset: 0; z-index: 650;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font-family: var(--hud-font); color: var(--hud-text);
    }
    .settings-card {
      background: var(--hud-bg); border: 1px solid var(--hud-border);
      padding: calc(var(--hud-unit) * 1.4);
      min-width: calc(var(--hud-unit) * 30);
      max-width: calc(var(--hud-unit) * 40);
      max-height: 80vh; overflow-y: auto;
    }
    .settings-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: calc(var(--hud-unit) * 1); }
    .settings-title { font-family: var(--hud-font-display); font-size: calc(var(--hud-unit) * 1.5); letter-spacing: 0.12em; text-transform: uppercase; margin: 0; }
    .settings-close { background: transparent; border: none; color: var(--hud-text); font-size: calc(var(--hud-unit) * 1.2); cursor: pointer; padding: 0 calc(var(--hud-unit) * 0.4); }
    .settings-close:hover { color: #ff6b6b; }
    .settings-tabs { display: flex; gap: calc(var(--hud-unit) * 0.3); margin-bottom: calc(var(--hud-unit) * 1); border-bottom: 1px solid var(--hud-border); }
    .settings-tab { background: transparent; border: 1px solid var(--hud-border); border-bottom: none; color: var(--hud-text-dim); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8); letter-spacing: 0.1em; text-transform: uppercase; padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 1); cursor: pointer; }
    .settings-tab.active { background: rgba(255,255,255,0.08); color: var(--hud-text); }
    .settings-body { min-height: calc(var(--hud-unit) * 10); }
    .settings-row { display: flex; justify-content: space-between; align-items: center; gap: calc(var(--hud-unit) * 1); padding: calc(var(--hud-unit) * 0.5) 0; }
    .settings-row label { font-size: calc(var(--hud-unit) * 0.85); color: var(--hud-text); flex: 1; display: flex; align-items: center; }
    .settings-row input[type="range"] { flex: 1; max-width: calc(var(--hud-unit) * 10); }
    .settings-row input[type="checkbox"] { width: calc(var(--hud-unit) * 1); height: calc(var(--hud-unit) * 1); }
    .settings-row select { background: rgba(0,0,0,0.4); color: var(--hud-text); border: 1px solid var(--hud-border); padding: calc(var(--hud-unit) * 0.3) calc(var(--hud-unit) * 0.5); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8); }
    .settings-row .value-display { min-width: calc(var(--hud-unit) * 2.5); text-align: right; font-family: monospace; font-size: calc(var(--hud-unit) * 0.75); color: var(--hud-text-dim); }
    .settings-row .mute-btn { background: transparent; border: 1px solid var(--hud-border); color: var(--hud-text); cursor: pointer; padding: 0 calc(var(--hud-unit) * 0.5); width: calc(var(--hud-unit) * 1.6); }
    .settings-row .mute-btn.muted { color: #ff6b6b; border-color: #ff6b6b; }
    .settings-section { font-family: var(--hud-font-display); font-size: calc(var(--hud-unit) * 0.75); letter-spacing: 0.1em; text-transform: uppercase; color: var(--hud-text-dim); margin: calc(var(--hud-unit) * 1.2) 0 calc(var(--hud-unit) * 0.4); padding-top: calc(var(--hud-unit) * 0.4); border-top: 1px solid var(--hud-border); }
    .settings-reload-banner { margin-top: calc(var(--hud-unit) * 0.3); padding: calc(var(--hud-unit) * 0.4); background: rgba(255,107,107,0.1); border: 1px solid #ff6b6b; color: #ff6b6b; font-size: calc(var(--hud-unit) * 0.7); display: flex; justify-content: space-between; align-items: center; }
    .settings-reload-banner button { background: #ff6b6b; border: none; color: #000; padding: calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.6); cursor: pointer; font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.7); }
    .settings-footer { display: flex; gap: calc(var(--hud-unit) * 0.5); margin-top: calc(var(--hud-unit) * 1.5); padding-top: calc(var(--hud-unit) * 0.8); border-top: 1px solid var(--hud-border); }
    .settings-footer button { flex: 1; background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text-dim); font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.75); padding: calc(var(--hud-unit) * 0.5); cursor: pointer; text-transform: uppercase; letter-spacing: 0.08em; }
    .settings-footer button:hover { color: var(--hud-text); border-color: var(--hud-text); }
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

export function abrirSettings(): void {
  injectStyles();
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
    if (!confirm('Resetar todas as configura\u00E7\u00F5es?')) return;
    resetarTudo();
    refreshBody();
  });
  footer.append(resetTab, resetAll);
  card.appendChild(footer);

  function refreshBody(): void {
    body.replaceChildren();
    // Update tab active class
    tabsEl.querySelectorAll('.settings-tab').forEach((b, i) => {
      b.classList.toggle('active', tabs[i][0] === _currentTab);
    });
    if (_currentTab === 'audio') renderAudioTab(body);
    else if (_currentTab === 'graphics') renderGraphicsTab(body);
    else renderGameplayTab(body);
  }
  refreshBody();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharSettings();
  });
  window.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      fecharSettings();
      window.removeEventListener('keydown', esc);
    }
  });

  document.body.appendChild(overlay);
  _overlay = overlay;
}

export function fecharSettings(): void {
  _overlay?.remove();
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
    muteBtn.textContent = cfg.audio[key].muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
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
      muteBtn.textContent = newMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
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
    const select = document.createElement('select');
    const opts: Array<[typeof gfx.qualidadeEfeitos, string]> = [
      ['alto', 'Alto'],
      ['medio', 'M\u00E9dio'],
      ['baixo', 'Baixo'],
      ['minimo', 'M\u00EDnimo'],
    ];
    for (const [val, label] of opts) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === gfx.qualidadeEfeitos) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      aplicarPreset(select.value as typeof gfx.qualidadeEfeitos);
    });
    row.appendChild(select);

    if (!presetBateComFlagsDerivadas(cfg)) {
      const tag = document.createElement('span');
      tag.textContent = '(personalizado)';
      tag.style.cssText = 'color: var(--hud-text-dim); font-size: calc(var(--hud-unit) * 0.7); margin-left: calc(var(--hud-unit) * 0.4);';
      row.appendChild(tag);
    }
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
    const select = document.createElement('select');
    const opts: Array<[number, string]> = [
      [0, 'Sem limite'],
      [30, '30'],
      [60, '60'],
      [120, '120'],
    ];
    for (const [val, label] of opts) {
      const opt = document.createElement('option');
      opt.value = String(val);
      opt.textContent = label;
      if (val === gfx.fpsCap) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, fpsCap: Number(select.value) } });
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
    const select = document.createElement('select');
    for (const [val, label] of [['webgl', 'WebGL'], ['webgpu', 'WebGPU']] as const) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === gfx.renderer) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, renderer: select.value as 'webgl' | 'webgpu' } });
      showReloadBanner(row);
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // WebGL version (only if renderer=webgl)
  if (gfx.renderer === 'webgl') {
    const [row] = rowWithLabel('Vers\u00E3o do WebGL', 'webglVersion');
    const select = document.createElement('select');
    const opts: Array<[typeof gfx.webglVersion, string]> = [
      ['auto', 'Autom\u00E1tico'],
      ['2', 'WebGL 2 for\u00E7ado'],
      ['1', 'WebGL 1 for\u00E7ado'],
    ];
    for (const [val, label] of opts) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === gfx.webglVersion) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, webglVersion: select.value as typeof gfx.webglVersion } });
      showReloadBanner(row);
    });
    row.appendChild(select);
    body.appendChild(row);
  }

  // GPU preference
  {
    const [row] = rowWithLabel('Prefer\u00EAncia de GPU', 'gpuPref');
    const select = document.createElement('select');
    const opts: Array<[typeof gfx.gpuPreference, string]> = [
      ['auto', 'Autom\u00E1tico'],
      ['high-performance', 'Alta performance'],
      ['low-power', 'Economia de energia'],
    ];
    for (const [val, label] of opts) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === gfx.gpuPreference) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, gpuPreference: select.value as typeof gfx.gpuPreference } });
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
    const select = document.createElement('select');
    const opts: Array<[number, string]> = [
      [-1, 'Ilimitado'],
      [50, '50'],
      [30, '30'],
      [15, '15'],
      [5, '5'],
      [0, 'Desligado'],
    ];
    for (const [val, label] of opts) {
      const opt = document.createElement('option');
      opt.value = String(val);
      opt.textContent = label;
      if (val === gfx.maxFantasmas) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      setConfig({ graphics: { ...getConfig().graphics, maxFantasmas: Number(select.value) } });
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
      showReloadBanner(row);
    });
    row.appendChild(cb);
    body.appendChild(row);
  }
}

// ─── Gameplay tab (Task 28) ──────────────────────────────────────────

function renderGameplayTab(body: HTMLDivElement): void {
  const gp = getConfig().gameplay;

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

// ─── Legacy export (used by main-menu.ts until Task 30) ──────────────

export function montarSettingsPanel(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'settings-panel';
  const cfg = getConfig();

  const autosaveRow = document.createElement('div');
  autosaveRow.className = 'settings-row';
  const autosaveLabel = document.createElement('label');
  autosaveLabel.textContent = 'Autosave';
  const autosaveSelect = document.createElement('select');
  const OPTIONS: Array<[string, number]> = [
    ['Desligado', 0],
    ['30s', 30_000],
    ['1min', 60_000],
    ['2min', 120_000],
    ['5min', 300_000],
  ];
  for (const [label, ms] of OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(ms);
    opt.textContent = label;
    if (ms === cfg.autosaveIntervalMs) opt.selected = true;
    autosaveSelect.appendChild(opt);
  }
  autosaveSelect.addEventListener('change', () => {
    setConfig({ autosaveIntervalMs: Number(autosaveSelect.value) });
    notificarMudancaConfig();
  });
  autosaveRow.append(autosaveLabel, autosaveSelect);
  container.appendChild(autosaveRow);

  const expRow = document.createElement('div');
  expRow.className = 'settings-row';
  const expLabel = document.createElement('label');
  expLabel.textContent = 'Save experimental em tempo real (IndexedDB)';
  const expToggle = document.createElement('input');
  expToggle.type = 'checkbox';
  expToggle.checked = cfg.saveMode === 'experimental';
  expToggle.addEventListener('change', () => {
    setConfig({ saveMode: expToggle.checked ? 'experimental' : 'periodic' });
    trocarModoSave();
    toast(
      expToggle.checked ? 'Modo experimental ativado' : 'Modo padr\u00E3o ativado',
      'info',
    );
  });
  expRow.append(expLabel, expToggle);
  container.appendChild(expRow);

  if (!document.getElementById('settings-panel-styles')) {
    const st = document.createElement('style');
    st.id = 'settings-panel-styles';
    st.textContent = `
      .settings-panel { display: flex; flex-direction: column; gap: calc(var(--hud-unit) * 0.8); min-width: calc(var(--hud-unit) * 20); }
      .settings-row { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 0.8); background: var(--hud-bg); border: 1px solid var(--hud-border); gap: calc(var(--hud-unit) * 1); }
      .settings-row label { font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.85); color: var(--hud-text); letter-spacing: 0.05em; }
      .settings-row select, .settings-row input[type="checkbox"] { background: rgba(0,0,0,0.4); color: var(--hud-text); border: 1px solid var(--hud-border); font-family: var(--hud-font); }
    `;
    document.head.appendChild(st);
  }

  return container;
}
