/**
 * Main menu overlay — first thing the player sees. Full-screen starfield
 * background, stylised title, and three buttons: Novo Jogo / Mundos
 * Salvos / Configurações. Calls back to main.ts to start the game on
 * user action.
 */

import { marcarInteracaoUi } from './interacao-ui';

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
      display: none;
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
  title.textContent = 'Orbital';
  screen.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'menu-subtitle';
  subtitle.textContent = 'Expedição Estelar';
  screen.appendChild(subtitle);

  const buttons = document.createElement('div');
  buttons.className = 'menu-buttons';

  const newGame = document.createElement('button');
  newGame.type = 'button';
  newGame.className = 'menu-btn primary';
  newGame.textContent = 'Novo Jogo';
  newGame.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    _options?.onNewGame();
  });
  buttons.appendChild(newGame);

  const loadGame = document.createElement('button');
  loadGame.type = 'button';
  loadGame.className = 'menu-btn';
  loadGame.textContent = 'Mundos Salvos';
  loadGame.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    showSavesScreen();
  });
  buttons.appendChild(loadGame);

  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'menu-btn ghost';
  settings.textContent = 'Configurações';
  settings.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    showSettingsScreen();
  });
  buttons.appendChild(settings);

  screen.appendChild(buttons);
  return screen;
}

function buildSavesScreen(): HTMLDivElement {
  const screen = document.createElement('div');
  screen.className = 'menu-screen hidden';

  const title = document.createElement('h2');
  title.className = 'menu-section-title';
  title.textContent = 'Mundos Salvos';
  screen.appendChild(title);

  const list = document.createElement('div');
  list.className = 'menu-saves-list';
  refreshSavesList(list);
  screen.appendChild(list);

  return screen;
}

function refreshSavesList(list: HTMLDivElement): void {
  list.replaceChildren();
  const saves = listSavedWorlds();
  if (saves.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-saves-empty';
    empty.textContent = 'Nenhum mundo salvo ainda';
    list.appendChild(empty);
    return;
  }
  for (const save of saves) {
    const card = document.createElement('div');
    card.className = 'menu-save-card';
    const name = document.createElement('div');
    name.className = 'menu-save-name';
    name.textContent = save.name;
    const meta = document.createElement('div');
    meta.className = 'menu-save-meta';
    meta.textContent = save.meta;
    card.append(name, meta);
    card.addEventListener('click', (e) => {
      e.preventDefault();
      marcarInteracaoUi();
      _options?.onLoadGame(save.id);
    });
    list.appendChild(card);
  }
}

/** Phase 2: actual save serialization goes here. For now returns empty. */
function listSavedWorlds(): Array<{ id: string; name: string; meta: string }> {
  try {
    const raw = localStorage.getItem('orbital_saves');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ id: string; name: string; meta: string }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildSettingsScreen(): HTMLDivElement {
  const screen = document.createElement('div');
  screen.className = 'menu-screen hidden';

  const title = document.createElement('h2');
  title.className = 'menu-section-title';
  title.textContent = 'Configurações';
  screen.appendChild(title);

  const placeholder = document.createElement('div');
  placeholder.className = 'menu-saves-empty';
  placeholder.textContent = 'Em breve';
  screen.appendChild(placeholder);

  return screen;
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

  // Back button (hidden on main screen)
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'menu-back';
  back.textContent = '◀ Voltar';
  back.style.display = 'none';
  back.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    showMainScreen();
  });
  _backBtn = back;
  container.appendChild(back);

  // Screens
  _mainScreen = buildMainScreen();
  _savesScreen = buildSavesScreen();
  _settingsScreen = buildSettingsScreen();
  container.append(_mainScreen, _savesScreen, _settingsScreen);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'menu-footer';
  footer.textContent = 'v0.1  ·  protótipo';
  container.appendChild(footer);

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
  _container?.remove();
  _container = null;
  _mainScreen = null;
  _savesScreen = null;
  _settingsScreen = null;
  _backBtn = null;
  _options = null;
  _styleInjected = false;
}
