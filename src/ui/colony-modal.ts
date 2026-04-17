import type { Mundo, Nave, Planeta } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { confirmarColonizacao, manterComoOutpost } from '../world/mundo';
import { t } from '../core/i18n/t';

// ─── Module state ───────────────────────────────────────────────────────────

let _container: HTMLDivElement | null = null;
let _backdrop: HTMLDivElement | null = null;
let _styleInjected = false;
let _nameInputEl: HTMLInputElement | null = null;
let _subtitleEl: HTMLDivElement | null = null;
let _bonusEl: HTMLDivElement | null = null;

let _pendingNave: Nave | null = null;
let _pendingPlaneta: Planeta | null = null;
let _mundoRef: Mundo | null = null;

// ─── Styles ─────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .colony-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(3px);
      z-index: 210;
      display: none;
    }
    .colony-backdrop.visible { display: block; }

    .colony-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      width: clamp(320px, 34vmin, 460px);
      padding: calc(var(--hud-unit) * 1.1) calc(var(--hud-unit) * 1.3);
      box-sizing: border-box;
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      z-index: 211;
      display: none;

      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.03), 0 20px 60px rgba(0,0,0,0.7);
      backdrop-filter: blur(6px);

      opacity: 0;
      transform: translate(-50%, calc(-50% + var(--hud-unit) * 0.6)) scale(0.96);
      transition:
        opacity 200ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1);
    }

    .colony-modal.visible {
      display: block;
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    .colony-title {
      font-family: var(--hud-font-display);
      font-size: var(--hud-text-md);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--hud-text);
      margin: 0 0 calc(var(--hud-unit) * 0.5);
    }

    .colony-subtitle {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin-bottom: calc(var(--hud-unit) * 0.9);
    }

    .colony-label {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin-bottom: calc(var(--hud-unit) * 0.3);
    }

    .colony-name-input {
      width: 100%;
      padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 0.6);
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--hud-line);
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      font-size: var(--hud-text-md);
      letter-spacing: 0.04em;
      outline: none;
      box-sizing: border-box;
      border-radius: calc(var(--hud-unit) * 0.2);
    }

    .colony-name-input:focus {
      border-color: #fff;
      background: rgba(255,255,255,0.08);
    }

    .colony-bonus {
      margin-top: calc(var(--hud-unit) * 0.8);
      padding: calc(var(--hud-unit) * 0.55) calc(var(--hud-unit) * 0.7);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-unit) * 0.2);
      background: rgba(255,255,255,0.02);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      color: var(--hud-text-dim);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1.6;
    }

    .colony-bonus-line {
      display: flex;
      justify-content: space-between;
    }

    .colony-bonus-line span:last-child {
      color: var(--hud-text);
      font-variant-numeric: tabular-nums;
    }

    .colony-buttons {
      display: flex;
      gap: calc(var(--hud-unit) * 0.5);
      margin-top: calc(var(--hud-unit) * 1.1);
    }

    .colony-btn {
      flex: 1;
      appearance: none;
      padding: calc(var(--hud-unit) * 0.55) calc(var(--hud-unit) * 0.8);
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--hud-border);
      border-radius: calc(var(--hud-unit) * 0.2);
      color: var(--hud-text);
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
    }

    .colony-btn:hover {
      background: rgba(255,255,255,0.12);
      border-color: #fff;
      transform: translateY(-1px);
    }

    .colony-btn.primary {
      background: rgba(140, 224, 255, 0.12);
      border-color: #8ce0ff;
      color: #8ce0ff;
    }

    .colony-btn.primary:hover {
      background: rgba(140, 224, 255, 0.22);
    }
  `;
  document.head.appendChild(style);
}

// ─── DOM construction ───────────────────────────────────────────────────────

function buildModal(): HTMLDivElement {
  const modal = document.createElement('div');
  modal.className = 'colony-modal';
  modal.setAttribute('data-ui', 'true');
  modal.style.pointerEvents = 'auto';
  modal.addEventListener('pointerdown', () => marcarInteracaoUi());

  const title = document.createElement('h2');
  title.className = 'colony-title';
  title.textContent = t('colony_modal.titulo');
  modal.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'colony-subtitle';
  subtitle.textContent = t('colony_modal.subtitulo');
  _subtitleEl = subtitle;
  modal.appendChild(subtitle);

  const label = document.createElement('div');
  label.className = 'colony-label';
  label.textContent = t('colony_modal.nome_label');
  modal.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'colony-name-input';
  input.maxLength = 32;
  input.autocomplete = 'off';
  input.spellcheck = false;
  _nameInputEl = input;
  modal.appendChild(input);

  const bonus = document.createElement('div');
  bonus.className = 'colony-bonus';
  _bonusEl = bonus;
  modal.appendChild(bonus);

  const buttons = document.createElement('div');
  buttons.className = 'colony-buttons';

  const outpostBtn = document.createElement('button');
  outpostBtn.type = 'button';
  outpostBtn.className = 'colony-btn';
  outpostBtn.textContent = t('colony_modal.manter_orbita');
  outpostBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    handleOutpost();
  });
  buttons.appendChild(outpostBtn);

  const colonizeBtn = document.createElement('button');
  colonizeBtn.type = 'button';
  colonizeBtn.className = 'colony-btn primary';
  colonizeBtn.textContent = t('colony_modal.colonizar');
  colonizeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    handleColonize();
  });
  buttons.appendChild(colonizeBtn);

  modal.appendChild(buttons);

  // Pressing Enter in the name field confirms colonization. Escape is
  // handled globally below so it fires regardless of which element is
  // focused (input, button, or nothing).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleColonize();
    }
  });

  return modal;
}

function populateBonus(): void {
  if (!_bonusEl) return;
  _bonusEl.replaceChildren();
  const rows: [string, string][] = [
    [t('colony_modal.bonus_fabrica'), 'T1'],
    [t('colony_modal.bonus_comum'), '+20'],
    [t('colony_modal.bonus_raro'), '+5'],
    [t('colony_modal.bonus_combustivel'), '+5'],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'colony-bonus-line';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    row.append(l, v);
    _bonusEl.appendChild(row);
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

function handleColonize(): void {
  if (!_pendingNave || !_mundoRef) return;
  const nome = _nameInputEl?.value.trim();
  confirmarColonizacao(_mundoRef, _pendingNave, nome || undefined);
  hide();
}

function handleOutpost(): void {
  if (!_pendingNave) return;
  manterComoOutpost(_pendingNave);
  hide();
}

function show(nave: Nave, planeta: Planeta): void {
  if (!_container || !_backdrop || !_nameInputEl || !_subtitleEl) return;
  _pendingNave = nave;
  _pendingPlaneta = planeta;
  _nameInputEl.value = planeta.dados.nome ?? '';
  _nameInputEl.select();
  _subtitleEl.textContent = t('colony_modal.subtitulo_sistema', { n: planeta.dados.sistemaId + 1 });
  populateBonus();
  _backdrop.classList.add('visible');
  _container.classList.add('visible');
  // Focus the input so the player can type a name immediately.
  setTimeout(() => _nameInputEl?.focus(), 50);
}

function hide(): void {
  if (!_container || !_backdrop) return;
  _container.classList.remove('visible');
  _backdrop.classList.remove('visible');
  _pendingNave = null;
  _pendingPlaneta = null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function criarColonyModal(): void {
  if (_container) return;
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'colony-backdrop';
  // Clicking the backdrop treats it as "keep in orbit" — the player
  // explicitly declined to colonize. Safer than a silent `hide()` that
  // would leave the ship stuck in `aguardando_decisao` forever.
  backdrop.addEventListener('pointerdown', () => marcarInteracaoUi());
  backdrop.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (_pendingNave) handleOutpost();
  });
  _backdrop = backdrop;
  document.body.appendChild(backdrop);

  const modal = buildModal();
  _container = modal;
  document.body.appendChild(modal);

  // Global Escape that works regardless of which element is focused.
  // Gated on _pendingNave so it doesn't interfere with other panels when
  // no colony decision is pending.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!_pendingNave) return;
    e.preventDefault();
    handleOutpost();
  });
}

export function atualizarColonyModal(mundo: Mundo): void {
  if (!_container) return;
  _mundoRef = mundo;

  // If the modal is already showing, keep showing it — the player is deciding.
  if (_pendingNave) {
    // Sanity checks:
    //   (1) the target planet changed owner externally (debug cheat)
    //   (2) the pending nave was removed from the world (destroyed)
    //   (3) the nave left aguardando_decisao externally
    const stillInWorld = mundo.naves.includes(_pendingNave);
    const planetValid = _pendingPlaneta?.dados.dono === 'neutro';
    const stillWaiting = _pendingNave.estado === 'aguardando_decisao';
    if (!stillInWorld || !planetValid || !stillWaiting) {
      hide();
    }
    return;
  }

  // Decision UI for colonizadoras is now inlined in colonizer-panel.ts,
  // so this modal is effectively dormant for that flow. We keep the
  // hook in case another ship type ever gets a decision state.
  for (const nave of mundo.naves) {
    if (nave.estado !== 'aguardando_decisao') continue;
    if (nave.tipo === 'colonizadora') continue;
    const alvo = nave.alvo;
    if (!alvo || alvo._tipoAlvo !== 'planeta') continue;
    show(nave, alvo);
    break;
  }
}

export function destruirColonyModal(): void {
  _container?.remove();
  _backdrop?.remove();
  _container = null;
  _backdrop = null;
  _styleInjected = false;
  _nameInputEl = null;
  _subtitleEl = null;
  _bonusEl = null;
  _pendingNave = null;
  _pendingPlaneta = null;
  _mundoRef = null;
}
