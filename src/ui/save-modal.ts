/**
 * In-game modal for save-related errors and reconciliation reports.
 *
 * Replaces the native window.prompt() previously used when a save file
 * fails to load, and also surfaces the reconciler's diagnostic list when
 * a save was auto-healed on load.
 *
 * Matches the confirm-dialog aesthetic (HUD-styled, animated, promise-
 * based) but with richer content — severity icon, scrollable details,
 * multiple action buttons. Only one save modal can be open at a time.
 */

import { marcarInteracaoUi } from './interacao-ui';

export type SaveModalSeverity = 'info' | 'warn' | 'erro';

export interface SaveModalAction {
  label: string;
  /** Return value if this button is clicked. */
  value: string;
  /** Visual style. */
  variant?: 'primary' | 'danger' | 'neutral';
}

export interface SaveModalOptions {
  title: string;
  severity: SaveModalSeverity;
  /** One-line summary, big and visible. */
  summary: string;
  /** Optional longer detail text (rendered pre-wrapped, can be multi-line). */
  details?: string;
  /** Optional structured list — rendered as bullet rows. */
  items?: Array<{ text: string; tone?: 'info' | 'warn' | 'erro' }>;
  /** Action buttons (rightmost is default / Enter). Always non-empty. */
  actions: SaveModalAction[];
}

let _backdrop: HTMLDivElement | null = null;
let _modal: HTMLDivElement | null = null;
let _iconEl: HTMLDivElement | null = null;
let _titleEl: HTMLDivElement | null = null;
let _summaryEl: HTMLDivElement | null = null;
let _detailsEl: HTMLPreElement | null = null;
let _itemsEl: HTMLUListElement | null = null;
let _buttonsEl: HTMLDivElement | null = null;
let _styleInjected = false;

let _activeResolver: ((value: string) => void) | null = null;
let _defaultValue: string | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .save-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.65);
      backdrop-filter: blur(4px);
      z-index: 960;
      display: none;
    }
    .save-modal-backdrop.visible { display: block; }

    .save-modal {
      position: fixed;
      top: 50%; left: 50%;
      width: clamp(320px, 40vmin, 520px);
      max-height: 80vh;
      box-sizing: border-box;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(6px);
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      z-index: 961;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      opacity: 0;
      transform: translate(-50%, calc(-50% + var(--hud-unit) * 0.6)) scale(0.98);
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 180ms ease-out,
        transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 220ms;
    }

    .save-modal.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 180ms ease-out,
        transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    .save-modal-header {
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.7);
      padding: calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1.1);
      border-bottom: 1px solid var(--hud-line);
    }

    .save-modal-icon {
      width: calc(var(--hud-unit) * 1.8);
      height: calc(var(--hud-unit) * 1.8);
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 1.1);
      font-weight: 700;
      flex-shrink: 0;
    }
    .save-modal-icon.info { background: rgba(100, 180, 255, 0.18); color: #8ec6ff; border: 1px solid #5fa8e0; }
    .save-modal-icon.warn { background: rgba(255, 200, 80, 0.18); color: #ffd27a; border: 1px solid #e0a740; }
    .save-modal-icon.erro { background: rgba(255, 100, 100, 0.18); color: #ff9090; border: 1px solid #e05050; }

    .save-modal-title {
      font-family: var(--hud-font-display);
      font-size: var(--hud-text-lg, calc(var(--hud-unit) * 1));
      letter-spacing: 0.08em;
      text-transform: uppercase;
      line-height: 1.1;
      color: var(--hud-text);
    }

    .save-modal-body {
      padding: calc(var(--hud-unit) * 0.9) calc(var(--hud-unit) * 1.1);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.7);
    }

    .save-modal-summary {
      color: var(--hud-text);
      font-size: var(--hud-text-md);
      line-height: 1.4;
    }

    .save-modal-details {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: calc(var(--hud-unit) * 0.72);
      color: var(--hud-text-dim);
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.7);
      padding: calc(var(--hud-unit) * 0.55) calc(var(--hud-unit) * 0.7);
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: calc(var(--hud-unit) * 12);
      overflow-y: auto;
    }

    .save-modal-items {
      margin: 0; padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.25);
      max-height: calc(var(--hud-unit) * 14);
      overflow-y: auto;
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.7);
      padding: calc(var(--hud-unit) * 0.5);
    }
    .save-modal-items li {
      font-size: calc(var(--hud-unit) * 0.8);
      line-height: 1.35;
      color: var(--hud-text-dim);
      padding-left: calc(var(--hud-unit) * 0.9);
      position: relative;
    }
    .save-modal-items li::before {
      content: '•';
      position: absolute;
      left: calc(var(--hud-unit) * 0.2);
      top: 0;
    }
    .save-modal-items li.info::before { color: #8ec6ff; }
    .save-modal-items li.warn::before { color: #ffd27a; }
    .save-modal-items li.erro::before { color: #ff9090; }

    .save-modal-buttons {
      display: flex;
      gap: calc(var(--hud-unit) * 0.5);
      justify-content: flex-end;
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 1.1);
      border-top: 1px solid var(--hud-line);
      background: rgba(0,0,0,0.2);
    }

    .save-modal-btn {
      appearance: none;
      min-width: calc(var(--hud-unit) * 4);
      padding: calc(var(--hud-unit) * 0.45) calc(var(--hud-unit) * 0.9);
      background: transparent;
      border: 1px solid var(--hud-border);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .save-modal-btn:hover { background: rgba(255,255,255,0.08); }
    .save-modal-btn.primary { background: rgba(255,255,255,0.12); }
    .save-modal-btn.primary:hover { background: rgba(255,255,255,0.2); }
    .save-modal-btn.danger {
      background: rgba(255, 100, 100, 0.12);
      border-color: rgba(255, 100, 100, 0.5);
      color: #ff9090;
    }
    .save-modal-btn.danger:hover {
      background: rgba(255, 100, 100, 0.22);
      border-color: #ff9090;
    }
  `;
  document.head.appendChild(style);
}

function resolveWith(value: string): void {
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
  if (e.key === 'Escape') {
    e.preventDefault();
    resolveWith(_defaultValue ?? 'cancel');
  } else if (e.key === 'Enter') {
    // Trigger the default (last) button
    e.preventDefault();
    const btns = _buttonsEl?.querySelectorAll<HTMLButtonElement>('button.save-modal-btn');
    if (btns && btns.length > 0) btns[btns.length - 1].click();
  }
}

function removeAllChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function ensureModal(): void {
  if (_modal) return;
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'save-modal-backdrop';
  backdrop.addEventListener('pointerdown', () => marcarInteracaoUi());
  backdrop.addEventListener('click', () => {
    resolveWith(_defaultValue ?? 'cancel');
  });
  _backdrop = backdrop;
  document.body.appendChild(backdrop);

  const modal = document.createElement('div');
  modal.className = 'save-modal';
  modal.setAttribute('data-ui', 'true');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });

  const header = document.createElement('div');
  header.className = 'save-modal-header';

  const icon = document.createElement('div');
  icon.className = 'save-modal-icon info';
  _iconEl = icon;
  header.appendChild(icon);

  const title = document.createElement('div');
  title.className = 'save-modal-title';
  _titleEl = title;
  header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'save-modal-body';

  const summary = document.createElement('div');
  summary.className = 'save-modal-summary';
  _summaryEl = summary;
  body.appendChild(summary);

  const items = document.createElement('ul');
  items.className = 'save-modal-items';
  items.style.display = 'none';
  _itemsEl = items;
  body.appendChild(items);

  const details = document.createElement('pre');
  details.className = 'save-modal-details';
  details.style.display = 'none';
  _detailsEl = details;
  body.appendChild(details);

  const buttons = document.createElement('div');
  buttons.className = 'save-modal-buttons';
  _buttonsEl = buttons;

  modal.append(header, body, buttons);
  _modal = modal;
  document.body.appendChild(modal);

  window.addEventListener('keydown', handleKey);
}

/**
 * Open the save modal and resolve with the clicked button's `value`.
 * Concurrent calls return 'cancel' immediately.
 */
export function abrirSaveModal(opts: SaveModalOptions): Promise<string> {
  ensureModal();
  if (!_modal || !_backdrop || !_iconEl || !_titleEl || !_summaryEl || !_detailsEl || !_itemsEl || !_buttonsEl) {
    return Promise.resolve('cancel');
  }
  if (_activeResolver) return Promise.resolve('cancel');

  _iconEl.className = `save-modal-icon ${opts.severity}`;
  _iconEl.textContent = opts.severity === 'erro' ? '!' : opts.severity === 'warn' ? '△' : 'i';
  _titleEl.textContent = opts.title;
  _summaryEl.textContent = opts.summary;

  // Items list (optional)
  removeAllChildren(_itemsEl);
  if (opts.items && opts.items.length > 0) {
    for (const item of opts.items) {
      const li = document.createElement('li');
      li.className = item.tone ?? 'info';
      li.textContent = item.text;
      _itemsEl.appendChild(li);
    }
    _itemsEl.style.display = '';
  } else {
    _itemsEl.style.display = 'none';
  }

  // Details pre (optional)
  if (opts.details && opts.details.length > 0) {
    _detailsEl.textContent = opts.details;
    _detailsEl.style.display = '';
  } else {
    _detailsEl.textContent = '';
    _detailsEl.style.display = 'none';
  }

  // Buttons
  removeAllChildren(_buttonsEl);
  const last = opts.actions[opts.actions.length - 1];
  _defaultValue = last?.value ?? 'cancel';
  for (const action of opts.actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `save-modal-btn ${action.variant ?? 'neutral'}`;
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      marcarInteracaoUi();
      resolveWith(action.value);
    });
    _buttonsEl.appendChild(btn);
  }

  _backdrop.classList.add('visible');
  _modal.classList.add('visible');

  setTimeout(() => {
    const btns = _buttonsEl?.querySelectorAll<HTMLButtonElement>('button.save-modal-btn');
    if (btns && btns.length > 0) btns[btns.length - 1].focus();
  }, 40);

  return new Promise<string>((resolve) => {
    _activeResolver = resolve;
  });
}

export function destruirSaveModal(): void {
  window.removeEventListener('keydown', handleKey);
  _modal?.remove();
  _backdrop?.remove();
  _modal = null;
  _backdrop = null;
  _iconEl = null;
  _titleEl = null;
  _summaryEl = null;
  _detailsEl = null;
  _itemsEl = null;
  _buttonsEl = null;
  _styleInjected = false;
  if (_activeResolver) {
    const r = _activeResolver;
    _activeResolver = null;
    r('cancel');
  }
}
