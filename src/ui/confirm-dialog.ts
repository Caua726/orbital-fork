import { marcarInteracaoUi } from './interacao-ui';

/**
 * In-game replacement for the native `confirm()` dialog. Promise-based,
 * styled with the HUD tokens, supports Enter (confirm) / Escape (cancel) /
 * backdrop click (cancel).
 *
 * Only one dialog can be open at a time — concurrent calls are rejected
 * with a rejected promise. That's simpler than queuing and matches the
 * behavior of the native API.
 */

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (reddish). */
  danger?: boolean;
}

let _backdrop: HTMLDivElement | null = null;
let _modal: HTMLDivElement | null = null;
let _titleEl: HTMLDivElement | null = null;
let _messageEl: HTMLDivElement | null = null;
let _confirmBtn: HTMLButtonElement | null = null;
let _cancelBtn: HTMLButtonElement | null = null;
let _styleInjected = false;

let _activeResolver: ((ok: boolean) => void) | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(3px);
      z-index: 220;
      display: none;
    }
    .confirm-backdrop.visible { display: block; }

    .confirm-dialog {
      position: fixed;
      top: 50%;
      left: 50%;
      width: clamp(260px, 26vmin, 380px);
      padding: calc(var(--hud-unit) * 1) calc(var(--hud-unit) * 1.2);
      box-sizing: border-box;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(4px);
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      z-index: 221;

      opacity: 0;
      transform: translate(-50%, calc(-50% + var(--hud-unit) * 0.5)) scale(0.98);
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 160ms ease-out,
        transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 200ms;
    }

    .confirm-dialog.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 160ms ease-out,
        transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    .confirm-title {
      font-family: var(--hud-font-display);
      font-size: var(--hud-text-md);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text);
      margin: 0 0 calc(var(--hud-unit) * 0.5);
      line-height: 1.1;
    }

    .confirm-message {
      font-family: var(--hud-font-body);
      font-size: var(--hud-text-md);
      color: var(--hud-text-dim);
      line-height: 1.35;
      margin-bottom: calc(var(--hud-unit) * 1);
    }

    .confirm-buttons {
      display: flex;
      gap: calc(var(--hud-unit) * 0.5);
      justify-content: flex-end;
    }

    .confirm-btn {
      appearance: none;
      min-width: calc(var(--hud-unit) * 4);
      padding: calc(var(--hud-unit) * 0.45) calc(var(--hud-unit) * 0.8);
      background: transparent;
      border: 1px solid var(--hud-border);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 120ms ease;
    }

    .confirm-btn:hover {
      background: rgba(255,255,255,0.08);
    }

    .confirm-btn.primary {
      background: rgba(255,255,255,0.1);
    }

    .confirm-btn.primary:hover {
      background: rgba(255,255,255,0.18);
    }

    .confirm-btn.danger {
      background: rgba(255, 100, 100, 0.12);
      border-color: rgba(255, 100, 100, 0.5);
      color: #ff9090;
    }

    .confirm-btn.danger:hover {
      background: rgba(255, 100, 100, 0.22);
      border-color: #ff9090;
    }
  `;
  document.head.appendChild(style);
}

function resolveWith(value: boolean): void {
  if (_activeResolver) {
    const r = _activeResolver;
    _activeResolver = null;
    r(value);
  }
  hide();
}

function hide(): void {
  _backdrop?.classList.remove('visible');
  _modal?.classList.remove('visible');
}

function handleKey(e: KeyboardEvent): void {
  if (!_activeResolver) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    resolveWith(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    resolveWith(false);
  }
}

export function criarConfirmDialog(): void {
  if (_modal) return;
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-backdrop';
  backdrop.addEventListener('pointerdown', () => marcarInteracaoUi());
  backdrop.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resolveWith(false);
  });
  _backdrop = backdrop;
  document.body.appendChild(backdrop);

  const modal = document.createElement('div');
  modal.className = 'confirm-dialog';
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });

  const title = document.createElement('h2');
  title.className = 'confirm-title';
  _titleEl = title;
  modal.appendChild(title);

  const message = document.createElement('div');
  message.className = 'confirm-message';
  _messageEl = message;
  modal.appendChild(message);

  const buttons = document.createElement('div');
  buttons.className = 'confirm-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'confirm-btn';
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    resolveWith(false);
  });
  _cancelBtn = cancelBtn;

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'confirm-btn primary';
  confirmBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    resolveWith(true);
  });
  _confirmBtn = confirmBtn;

  buttons.append(cancelBtn, confirmBtn);
  modal.appendChild(buttons);

  _modal = modal;
  document.body.appendChild(modal);

  window.addEventListener('keydown', handleKey);
}

export function confirmar(opts: ConfirmOptions): Promise<boolean> {
  // Lazy-create the dialog if the caller forgot to wire criarConfirmDialog().
  if (!_modal) criarConfirmDialog();
  if (!_modal || !_backdrop || !_titleEl || !_messageEl || !_confirmBtn || !_cancelBtn) {
    return Promise.resolve(false);
  }
  // Reject concurrent calls — only one dialog at a time.
  if (_activeResolver) return Promise.resolve(false);

  _titleEl.textContent = opts.title;
  _messageEl.textContent = opts.message;
  _confirmBtn.textContent = opts.confirmLabel ?? 'Confirmar';
  _cancelBtn.textContent = opts.cancelLabel ?? 'Cancelar';
  _confirmBtn.classList.toggle('danger', !!opts.danger);
  _confirmBtn.classList.toggle('primary', !opts.danger);

  _backdrop.classList.add('visible');
  _modal.classList.add('visible');

  // Focus the cancel button by default — safer for destructive actions.
  setTimeout(() => (opts.danger ? _cancelBtn : _confirmBtn)?.focus(), 30);

  return new Promise<boolean>((resolve) => {
    _activeResolver = resolve;
  });
}

export function destruirConfirmDialog(): void {
  window.removeEventListener('keydown', handleKey);
  _modal?.remove();
  _backdrop?.remove();
  _modal = null;
  _backdrop = null;
  _titleEl = null;
  _messageEl = null;
  _confirmBtn = null;
  _cancelBtn = null;
  _styleInjected = false;
  if (_activeResolver) {
    const r = _activeResolver;
    _activeResolver = null;
    r(false);
  }
}
