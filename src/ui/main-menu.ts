/**
 * Main menu overlay — first thing the player sees. Full-screen starfield
 * background, stylised title, and three buttons: Novo Jogo / Mundos
 * Salvos / Configurações. Calls back to main.ts to start the game on
 * user action.
 */

import { marcarInteracaoUi } from './interacao-ui';
import { confirmarAcao } from './confirmar-acao';
import { getBackendAtivo } from '../world/save';
import type { SaveMetadata } from '../world/save';
import { renderSettingsInto } from './settings-panel';
import { t } from '../core/i18n/t';
import { onConfigChange } from '../core/config';

interface MainMenuOptions {
  onNewGame: () => void;
  onLoadGame: (saveId: string) => void;
}

let _container: HTMLDivElement | null = null;
let _mainScreen: HTMLDivElement | null = null;
let _savesScreen: HTMLDivElement | null = null;
let _settingsScreen: HTMLDivElement | null = null;
let _styleInjected = false;
let _options: MainMenuOptions | null = null;
let _unsubConfig: (() => void) | null = null;
let _refreshTextos: (() => void) | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* Menu is a transparent overlay — the Pixi world renders behind it
       (cinematic camera pan around the starting system). Overlay
       applies a backdrop blur so the world is still visible but
       softened, with a subtle darkening pass on top for text contrast. */
    .main-menu {
      position: fixed;
      inset: 0;
      z-index: 500;
      color: var(--hud-text);
      font-family: var(--hud-font);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      opacity: 1;
      background: rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      transition: opacity 400ms ease-out, visibility 0s linear 0s;
    }

    .main-menu::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.2) 70%, rgba(0,0,0,0.4) 100%);
      pointer-events: none;
    }

    .main-menu.hidden {
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
      transition: opacity 400ms ease-out, visibility 0s linear 400ms;
    }

    /* ── Title + menu container ── */
    .menu-screen {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0 var(--hud-margin);
      box-sizing: border-box;
    }

    .menu-screen.hidden {
      opacity: 0;
      transform: translateX(calc(var(--hud-unit) * 1.5));
      pointer-events: none;
      position: absolute;
      transition: opacity 220ms ease-out, transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1);
    }
    .menu-screen:not(.hidden) {
      opacity: 1;
      transform: translateX(0);
      transition: opacity 220ms ease-out, transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1);
    }

    .menu-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 3.6);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--hud-text);
      text-align: center;
      margin: 0 0 calc(var(--hud-unit) * 0.55);
      line-height: 1;
    }

    .menu-subtitle {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.85);
      letter-spacing: 0.32em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      text-align: center;
      margin: 0 0 calc(var(--hud-unit) * 2.2);
      line-height: 1;
    }

    .menu-buttons {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.5);
      width: calc(var(--hud-unit) * 16);
    }

    /* Bigger, more presence than the in-game HUD buttons. Still pure
       black/white — no colored fills — but with a hairline top-inset
       highlight and a subtle bottom shadow for depth. Hover widens the
       letter-spacing slightly for tactile feedback. */
    .menu-btn {
      appearance: none;
      width: 100%;
      height: calc(var(--hud-unit) * 3);
      padding: 0 calc(var(--hud-unit) * 1);
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        0 calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.6) rgba(0, 0, 0, 0.5);
      color: var(--hud-text);
      cursor: pointer;
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.95);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      text-align: center;
      transition:
        background 140ms ease,
        border-color 140ms ease,
        letter-spacing 220ms ease,
        transform 140ms ease;
    }

    .menu-btn:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: #fff;
      letter-spacing: 0.18em;
    }

    .menu-btn:active {
      transform: translateY(1px);
    }

    .menu-btn.primary {
      background: rgba(255, 255, 255, 0.12);
      border-color: #fff;
    }

    .menu-btn.primary:hover {
      background: rgba(255, 255, 255, 0.22);
    }

    /* ── Back button + section titles for sub-screens ── */
    .menu-back {
      position: absolute;
      top: var(--hud-margin);
      left: var(--hud-margin);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.7);
      cursor: pointer;
      backdrop-filter: blur(3px);
      transition: color 120ms ease, background 120ms ease;
      z-index: 3;
    }

    .menu-back:hover {
      color: var(--hud-text);
      background: rgba(255, 255, 255, 0.08);
    }

    .menu-section-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.8);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--hud-text);
      text-align: center;
      margin: 0 0 calc(var(--hud-unit) * 1.4);
      line-height: 1;
    }

    /* ── Saved worlds list ── */
    .menu-saves-list {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.4);
      width: calc(var(--hud-unit) * 20);
    }

    .menu-saves-empty {
      text-align: center;
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.85);
      letter-spacing: 0.1em;
      color: var(--hud-text-dim);
      padding: calc(var(--hud-unit) * 1.6) 0;
      border: 1px dashed var(--hud-line);
      background: var(--hud-bg);
    }

    .menu-save-card {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1);
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 calc(var(--hud-unit) * 0.15) calc(var(--hud-unit) * 0.4) rgba(0, 0, 0, 0.4);
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .menu-save-card:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: #fff;
    }

    .menu-save-name {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.9);
      color: var(--hud-text);
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }

    .menu-save-meta {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.75);
      color: var(--hud-text-dim);
      letter-spacing: 0.06em;
    }

    .menu-save-delete {
      position: absolute;
      top: calc(var(--hud-unit) * 0.3);
      right: calc(var(--hud-unit) * 0.3);
      background: transparent;
      border: none;
      color: var(--hud-text-dim);
      font-size: calc(var(--hud-unit) * 0.9);
      cursor: pointer;
      opacity: 0;
      transition: opacity 120ms ease, color 120ms ease;
    }
    .menu-save-card:hover .menu-save-delete { opacity: 1; }
    .menu-save-delete:hover { color: #ff6b6b; }

    /* ── Footer ── */
    .menu-footer {
      position: absolute;
      bottom: var(--hud-margin);
      left: 0;
      right: 0;
      text-align: center;
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.1em;
      color: var(--hud-text-faint);
      pointer-events: none;
      z-index: 3;
    }
  `;
  document.head.appendChild(style);
}

function buildMainScreen(): HTMLDivElement {
  const screen = document.createElement('div');
  screen.className = 'menu-screen';

  const title = document.createElement('h1');
  title.className = 'menu-title';
  title.textContent = t('menu.titulo');
  screen.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'menu-subtitle';
  subtitle.textContent = t('menu.subtitulo');
  screen.appendChild(subtitle);

  const buttons = document.createElement('div');
  buttons.className = 'menu-buttons';

  const newGame = document.createElement('button');
  newGame.type = 'button';
  newGame.className = 'menu-btn primary';
  newGame.textContent = t('menu.novo_jogo');
  newGame.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    _options?.onNewGame();
  });
  buttons.appendChild(newGame);

  const loadGame = document.createElement('button');
  loadGame.type = 'button';
  loadGame.className = 'menu-btn';
  loadGame.textContent = t('menu.mundos_salvos');
  loadGame.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    showSavesScreen();
  });
  buttons.appendChild(loadGame);

  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'menu-btn ghost';
  settings.textContent = t('menu.configuracoes');
  settings.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    showSettingsScreen();
  });
  buttons.appendChild(settings);

  screen.appendChild(buttons);
  (screen as any)._refresh = () => {
    title.textContent = t('menu.titulo');
    subtitle.textContent = t('menu.subtitulo');
    newGame.textContent = t('menu.novo_jogo');
    loadGame.textContent = t('menu.mundos_salvos');
    settings.textContent = t('menu.configuracoes');
  };
  return screen;
}

function buildSavesScreen(): HTMLDivElement {
  const screen = document.createElement('div');
  screen.className = 'menu-screen hidden';

  const title = document.createElement('h2');
  title.className = 'menu-section-title';
  title.textContent = t('menu.titulo_saves');
  screen.appendChild(title);

  const list = document.createElement('div');
  list.className = 'menu-saves-list';
  void refreshSavesList(list);
  screen.appendChild(list);

  (screen as any)._refresh = () => {
    title.textContent = t('menu.titulo_saves');
    void refreshSavesList(list);
  };
  return screen;
}

function buildSettingsScreen(): HTMLDivElement {
  const screen = document.createElement('div');
  screen.className = 'menu-screen hidden';

  const title = document.createElement('h2');
  title.className = 'menu-section-title';
  title.textContent = t('menu.configuracoes');
  screen.appendChild(title);

  const settingsHost = document.createElement('div');
  settingsHost.style.cssText = `
    background: var(--hud-bg);
    border: 1px solid var(--hud-border);
    border-radius: var(--hud-radius);
    box-shadow: 0 calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1.2) rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    padding: calc(var(--hud-unit) * 1.2);
    max-height: 60vh;
    overflow-y: auto;
    width: calc(var(--hud-unit) * 32);
  `;
  screen.appendChild(settingsHost);

  renderSettingsInto(settingsHost);

  (screen as any)._refresh = () => {
    title.textContent = t('menu.configuracoes');
    settingsHost.replaceChildren();
    renderSettingsInto(settingsHost);
  };
  return screen;
}

async function refreshSavesList(list: HTMLDivElement): Promise<void> {
  list.replaceChildren();
  const saves = await listSavedWorlds();
  if (saves.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-saves-empty';
    empty.textContent = t('menu.nenhum_save');
    list.appendChild(empty);
    return;
  }
  for (const save of saves) {
    const card = document.createElement('div');
    card.className = 'menu-save-card';

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'menu-save-name';
    name.textContent = save.nome;
    const meta = document.createElement('div');
    meta.className = 'menu-save-meta';
    meta.textContent = `${save.tipoJogador.nome} · ${formatarTempoJogado(save.tempoJogadoMs)} · ${formatarSalvoEm(save.salvoEm)}`;
    info.append(name, meta);
    card.appendChild(info);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'menu-save-delete';
    del.textContent = '\u2715';
    del.title = 'Apagar';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      marcarInteracaoUi();
      confirmarAcao(t('menu.apagar_save', { nome: save.nome }), () => {
        const backend = getBackendAtivo();
        void Promise.resolve(backend.apagar(save.nome)).then(() => refreshSavesList(list));
      });
    });
    card.appendChild(del);

    card.addEventListener('click', (e) => {
      e.preventDefault();
      marcarInteracaoUi();
      _options?.onLoadGame(save.nome);
    });
    list.appendChild(card);
  }
}

async function listSavedWorlds(): Promise<SaveMetadata[]> {
  const backend = getBackendAtivo();
  return Promise.resolve(backend.listarMundos());
}

function formatarTempoJogado(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}min`;
}

function formatarSalvoEm(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `há ${Math.floor(diff / 3_600_000)} h`;
  return `há ${Math.floor(diff / 86_400_000)} dias`;
}

function showMainScreen(): void {
  _mainScreen?.classList.remove('hidden');
  _savesScreen?.classList.add('hidden');
  _settingsScreen?.classList.add('hidden');
  updateBackButton(false);
}

function showSavesScreen(): void {
  _mainScreen?.classList.add('hidden');
  _savesScreen?.classList.remove('hidden');
  _settingsScreen?.classList.add('hidden');
  updateBackButton(true);
  const list = _savesScreen?.querySelector('.menu-saves-list') as HTMLDivElement | null;
  if (list) void refreshSavesList(list);
}

function showSettingsScreen(): void {
  _mainScreen?.classList.add('hidden');
  _savesScreen?.classList.add('hidden');
  _settingsScreen?.classList.remove('hidden');
  updateBackButton(true);
}

let _backBtn: HTMLButtonElement | null = null;
function updateBackButton(visible: boolean): void {
  if (!_backBtn) return;
  _backBtn.style.display = visible ? '' : 'none';
}

export function criarMainMenu(options: MainMenuOptions): HTMLDivElement {
  if (_container) return _container;
  injectStyles();
  _options = options;

  const container = document.createElement('div');
  container.className = 'main-menu';
  container.setAttribute('data-ui', 'true');
  container.style.pointerEvents = 'auto';

  // Back button (hidden on main screen)
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'menu-back';
  back.textContent = t('menu.voltar');
  back.style.display = 'none';
  back.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    showMainScreen();
  });
  _backBtn = back;

  // Screens (wrapped for slide transitions)
  _mainScreen = buildMainScreen();
  _savesScreen = buildSavesScreen();
  _settingsScreen = buildSettingsScreen();
  const screensWrapper = document.createElement('div');
  screensWrapper.style.cssText = 'position: relative; width: 100%; flex: 1; display: flex; align-items: center; justify-content: center;';
  screensWrapper.append(_mainScreen, _savesScreen, _settingsScreen);
  container.appendChild(back);
  container.appendChild(screensWrapper);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'menu-footer';
  footer.textContent = t('menu.footer');
  container.appendChild(footer);

  _refreshTextos = () => {
    back.textContent = t('menu.voltar');
    footer.textContent = t('menu.footer');
    (_mainScreen as any)?._refresh?.();
    (_savesScreen as any)?._refresh?.();
    (_settingsScreen as any)?._refresh?.();
  };
  _unsubConfig = onConfigChange(() => _refreshTextos?.());

  // Esc on sub-screens goes back to main
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!_container || _container.classList.contains('hidden')) return;
    if (_mainScreen?.classList.contains('hidden')) {
      e.preventDefault();
      showMainScreen();
    }
  });

  document.body.appendChild(container);
  _container = container;
  return container;
}

export function esconderMainMenu(): void {
  _container?.classList.add('hidden');
}

export function mostrarMainMenu(): void {
  _container?.classList.remove('hidden');
  showMainScreen();
}

export function destruirMainMenu(): void {
  _unsubConfig?.();
  _unsubConfig = null;
  _refreshTextos = null;
  _container?.remove();
  _container = null;
  _mainScreen = null;
  _savesScreen = null;
  _settingsScreen = null;
  _backBtn = null;
  _options = null;
  _styleInjected = false;
}
