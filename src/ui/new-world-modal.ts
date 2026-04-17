import { marcarInteracaoUi } from './interacao-ui';
import { getTipos } from './selecao';
import type { TipoJogador } from '../types';
import { getBackendAtivo } from '../world/save';
import { t } from '../core/i18n/t';

interface OpenOpts {
  onConfirm: (nome: string, tipoJogador: TipoJogador) => void;
  onCancel: () => void;
}

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .new-world-modal {
      position: fixed;
      inset: 0;
      z-index: 600;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--hud-font);
      color: var(--hud-text);
      animation: nwm-backdrop-in 200ms ease-out forwards;
    }
    @keyframes nwm-backdrop-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .new-world-modal.closing {
      opacity: 0;
      transition: opacity 200ms ease-out;
    }
    .new-world-modal.closing .nwm-card {
      transform: translateY(calc(var(--hud-unit) * 0.3)) scale(0.98);
      opacity: 0;
      transition: opacity 150ms ease-out, transform 200ms ease-out;
    }
    .nwm-card {
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      backdrop-filter: blur(8px);
      padding: calc(var(--hud-unit) * 2);
      min-width: calc(var(--hud-unit) * 22);
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 1);
      box-shadow: 0 calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1.2) rgba(0, 0, 0, 0.6);
      animation: nwm-card-in 240ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
    }
    @keyframes nwm-card-in {
      from { opacity: 0; transform: translateY(calc(var(--hud-unit) * 0.5)) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .nwm-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.6);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      text-align: center;
      margin: 0 0 calc(var(--hud-unit) * 0.8);
      border-bottom: 1px solid var(--hud-line);
      padding-bottom: calc(var(--hud-unit) * 0.8);
    }
    .nwm-label {
      font-size: calc(var(--hud-unit) * 0.8);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin-bottom: calc(var(--hud-unit) * 0.3);
    }
    .nwm-input {
      width: 100%;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--hud-border);
      border-radius: calc(var(--hud-radius) * 0.6);
      color: var(--hud-text);
      padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 0.7);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.95);
      outline: none;
      transition: border-color 140ms ease;
    }
    .nwm-input:focus {
      border-color: #8ce0ff;
    }
    .nwm-error {
      color: #ff6b6b;
      font-size: calc(var(--hud-unit) * 0.75);
      min-height: calc(var(--hud-unit) * 1);
    }
    .nwm-row {
      display: flex;
      gap: calc(var(--hud-unit) * 0.5);
      margin-top: calc(var(--hud-unit) * 0.5);
    }
    .nwm-btn {
      flex: 1;
      height: calc(var(--hud-unit) * 2.2);
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: calc(var(--hud-radius) * 0.6);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.85);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 140ms ease, letter-spacing 140ms ease;
    }
    .nwm-btn:hover { background: rgba(255,255,255,0.08); letter-spacing: 0.18em; }
    .nwm-btn:active { transform: translateY(1px); }
    .nwm-btn.primary { background: rgba(255,255,255,0.12); border-color: #fff; }
  `;
  document.head.appendChild(style);
}

export function abrirNewWorldModal(opts: OpenOpts): void {
  injectStyles();
  fechar();

  const container = document.createElement('div');
  container.className = 'new-world-modal';
  container.setAttribute('data-ui', 'true');
  container.style.pointerEvents = 'auto';

  const card = document.createElement('div');
  card.className = 'nwm-card';
  container.appendChild(card);

  const title = document.createElement('h2');
  title.className = 'nwm-title';
  title.textContent = t('novo_mundo.titulo');
  card.appendChild(title);

  const labelNome = document.createElement('div');
  labelNome.className = 'nwm-label';
  labelNome.textContent = t('novo_mundo.nome_label');
  card.appendChild(labelNome);

  const input = document.createElement('input');
  input.className = 'nwm-input';
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = t('novo_mundo.placeholder');
  card.appendChild(input);

  const erro = document.createElement('div');
  erro.className = 'nwm-error';
  card.appendChild(erro);

  const row = document.createElement('div');
  row.className = 'nwm-row';
  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.className = 'nwm-btn';
  btnCancel.textContent = t('novo_mundo.cancelar');
  const btnOk = document.createElement('button');
  btnOk.type = 'button';
  btnOk.className = 'nwm-btn primary';
  btnOk.textContent = t('novo_mundo.criar');
  row.appendChild(btnCancel);
  row.appendChild(btnOk);
  card.appendChild(row);

  function validar(nome: string): string | null {
    const trimmed = nome.trim();
    if (trimmed.length < 1) return t('novo_mundo.erro_vazio');
    if (trimmed.length > 40) return t('novo_mundo.erro_longo');
    const backend = getBackendAtivo();
    const existe = backend.existe(trimmed);
    if (existe instanceof Promise) return null;
    if (existe) return t('novo_mundo.erro_duplicado');
    return null;
  }

  function confirmar(): void {
    const nome = input.value.trim();
    const err = validar(nome);
    if (err) {
      erro.textContent = err;
      return;
    }
    marcarInteracaoUi();
    fechar();
    const tipoJogador = getTipos()[0];
    opts.onConfirm(nome, tipoJogador);
  }

  btnOk.addEventListener('click', (e) => { e.preventDefault(); confirmar(); });
  btnCancel.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    fechar();
    opts.onCancel();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
    if (e.key === 'Escape') { e.preventDefault(); fechar(); opts.onCancel(); }
  });
  input.addEventListener('input', () => { erro.textContent = ''; });

  document.body.appendChild(container);
  _container = container;
  setTimeout(() => input.focus(), 0);
}

function fechar(): void {
  if (!_container) return;
  const c = _container;
  _container = null;
  c.classList.add('closing');
  setTimeout(() => c.remove(), 200);
}
