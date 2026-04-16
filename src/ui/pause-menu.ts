import { salvarAgora, pararAutosave, getUltimoErro } from '../world/save';
import { toast } from './toast';
import { marcarInteracaoUi } from './interacao-ui';

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .pause-menu {
      position: fixed;
      inset: 0;
      z-index: 550;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--hud-font);
      color: var(--hud-text);
      animation: pm-backdrop-in 200ms ease-out forwards;
    }
    @keyframes pm-backdrop-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .pause-menu.closing {
      opacity: 0;
      transition: opacity 180ms ease-out;
    }
    .pause-menu.closing .pm-card {
      transform: translateY(calc(var(--hud-unit) * 0.3)) scale(0.97);
      opacity: 0;
      transition: opacity 140ms ease-out, transform 180ms ease-out;
    }

    .pm-card {
      background: var(--hud-bg);
      backdrop-filter: blur(8px);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      padding: calc(var(--hud-unit) * 2) calc(var(--hud-unit) * 2.5);
      min-width: calc(var(--hud-unit) * 18);
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.5);
      box-shadow: var(--hud-shadow), 0 calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 2) rgba(0,0,0,0.6);
      animation: pm-card-in 260ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
    }
    @keyframes pm-card-in {
      from { opacity: 0; transform: translateY(calc(var(--hud-unit) * 0.6)) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .pm-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.3);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      text-align: center;
      padding-bottom: calc(var(--hud-unit) * 0.7);
      border-bottom: 1px solid var(--hud-line);
      margin-bottom: calc(var(--hud-unit) * 0.3);
    }

    .pm-btn {
      width: 100%;
      background: transparent;
      border: 1px solid transparent;
      border-radius: calc(var(--hud-radius) * 0.6);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.9);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 1);
      cursor: pointer;
      text-align: left;
      transition: background 140ms ease, border-color 140ms ease, letter-spacing 200ms ease, transform 100ms ease;
    }
    .pm-btn:hover {
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.15);
      letter-spacing: 0.16em;
    }
    .pm-btn:active {
      transform: translateY(1px);
    }

    .pm-sep {
      width: 100%;
      border: none;
      border-top: 1px solid var(--hud-line);
      margin: calc(var(--hud-unit) * 0.2) 0;
    }

    .pm-btn.danger {
      color: var(--hud-text-dim);
    }
    .pm-btn.danger:hover {
      color: #ff9090;
      border-color: rgba(255, 100, 100, 0.2);
      background: rgba(255, 100, 100, 0.06);
    }

    .pm-confirm-msg {
      font-size: calc(var(--hud-unit) * 0.8);
      color: var(--hud-text-dim);
      text-align: center;
      padding: calc(var(--hud-unit) * 0.5) 0;
      letter-spacing: 0.04em;
    }
    .pm-confirm-row {
      display: flex;
      gap: calc(var(--hud-unit) * 0.5);
    }
    .pm-confirm-row .pm-btn {
      flex: 1;
      text-align: center;
    }
  `;
  document.head.appendChild(s);
}

export function abrirPauseMenu(): void {
  if (_container) return; // already open
  injectStyles();
  marcarInteracaoUi();

  const overlay = document.createElement('div');
  overlay.className = 'pause-menu';

  const card = document.createElement('div');
  card.className = 'pm-card';
  overlay.appendChild(card);

  // Title
  const title = document.createElement('div');
  title.className = 'pm-title';
  title.textContent = 'Menu';
  card.appendChild(title);

  // Resume
  const btnResume = criarBotao('Continuar', () => fecharPauseMenu());
  card.appendChild(btnResume);

  // Save
  const btnSave = criarBotao('Salvar', () => {
    salvarAgora();
    const erro = getUltimoErro();
    if (erro) {
      toast(`Erro ao salvar: ${erro.message}`, 'err');
    } else {
      toast('Salvo', 'info');
    }
  });
  card.appendChild(btnSave);

  card.appendChild(criarSeparador());

  // Back to menu — inline confirmation
  let _confirmVisible = false;
  const btnMenu = criarBotao('Voltar ao Menu', () => {
    if (_confirmVisible) return;
    _confirmVisible = true;
    btnMenu.style.display = 'none';

    const msg = document.createElement('div');
    msg.className = 'pm-confirm-msg';
    msg.textContent = 'Seu progresso será salvo automaticamente.';

    const row = document.createElement('div');
    row.className = 'pm-confirm-row';

    const btnCancel = criarBotao('Cancelar', () => {
      msg.remove();
      row.remove();
      btnMenu.style.display = '';
      _confirmVisible = false;
    });
    const btnConfirm = criarBotao('Sair', () => {
      salvarAgora();
      pararAutosave();
      // Fade to black before reload for a smooth transition
      if (_container) {
        const c = _container;
        c.style.transition = 'background 400ms ease-out, backdrop-filter 400ms ease-out';
        c.style.background = 'rgba(0, 0, 0, 1)';
        const cardEl = c.querySelector('.pm-card') as HTMLElement | null;
        if (cardEl) {
          cardEl.style.transition = 'opacity 250ms ease-out, transform 300ms ease-out';
          cardEl.style.opacity = '0';
          cardEl.style.transform = 'translateY(calc(var(--hud-unit) * -0.5)) scale(0.97)';
        }
        setTimeout(() => {
          // Set body background black so the unload→reload doesn't flash white
          document.body.style.background = '#000';
          // Remove the canvas to prevent a white frame during unload
          const canvas = document.querySelector('canvas');
          if (canvas) canvas.style.display = 'none';
          window.dispatchEvent(new CustomEvent('orbital:voltar-ao-menu'));
        }, 420);
      } else {
        window.dispatchEvent(new CustomEvent('orbital:voltar-ao-menu'));
      }
    }, 'danger');

    row.append(btnCancel, btnConfirm);
    card.append(msg, row);
  }, 'danger');
  card.appendChild(btnMenu);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      marcarInteracaoUi();
      fecharPauseMenu();
    }
  });

  // Close on Escape
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fecharPauseMenu();
      window.removeEventListener('keydown', handleKey, true);
    }
  };
  window.addEventListener('keydown', handleKey, true);

  document.body.appendChild(overlay);
  _container = overlay;
}

export function fecharPauseMenu(): void {
  if (!_container) return;
  const c = _container;
  _container = null;
  c.classList.add('closing');
  setTimeout(() => c.remove(), 200);
}

export function isPauseMenuOpen(): boolean {
  return _container !== null;
}

function criarBotao(texto: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `pm-btn ${cls}`.trim();
  btn.textContent = texto;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    onClick();
  });
  return btn;
}

function criarSeparador(): HTMLHRElement {
  const hr = document.createElement('hr');
  hr.className = 'pm-sep';
  return hr;
}
