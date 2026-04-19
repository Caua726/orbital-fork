import type { Mundo, Nave, Planeta } from '../types';
import { VELOCIDADE_NAVE } from '../world/constantes';
import { marcarInteracaoUi } from './interacao-ui';
import { injectBottomSheetStyles } from './bottom-sheet.css';
import {
  obterNaveSelecionada,
  cancelarMovimentoNave,
  confirmarColonizacao,
  manterComoOutpost,
  recolherColonizadoraParaOrigem,
  sucatearNave,
  ehColonizadoraOutpost,
  iniciarPilotagem,
  setNaveThrust,
} from '../world/mundo';
import { TEMPO_SURVEY_MS } from '../world/constantes';
import { carregarSpritesheet, getSpritesheetImage } from '../world/spritesheets';
import { iniciarComandoNave, cancelarComandoNave, getComandoNaveTipo } from '../core/player';
import { confirmar } from './confirm-dialog';
import { t } from '../core/i18n/t';

// ─── Constants ──────────────────────────────────────────────────────────────

const SPRITE_CELL = 96;
const SHIP_ROW_COLONIZADORA = 0;
const SHIP_COL_COLONIZADORA = 0;

// Panel "stages" — these are the visual modes the panel morphs between.
type Stage =
  | 'idle'          // orbiting origem, no mission in progress
  | 'outpost'       // orbiting a non-origin target (post-survey outpost)
  | 'traveling'     // in transit to a target
  | 'piloting'      // real-time thrust via joystick/D-pad
  | 'surveying'    // fazendo_survey
  | 'deciding';    // aguardando_decisao

function stageForNave(nave: Nave): Stage {
  if (nave.estado === 'fazendo_survey') return 'surveying';
  if (nave.estado === 'aguardando_decisao') return 'deciding';
  if (nave.estado === 'viajando') return 'traveling';
  if (nave.estado === 'pilotando') return 'piloting';
  if (nave.estado === 'orbitando' && ehColonizadoraOutpost(nave)) return 'outpost';
  return 'idle';
}

// ─── Module state ───────────────────────────────────────────────────────────

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

let _portraitCanvas: HTMLCanvasElement | null = null;
let _stageBadgeEl: HTMLDivElement | null = null;
let _infoTitleEl: HTMLDivElement | null = null;
let _middleEl: HTMLDivElement | null = null;       // swappable middle section
let _infoSubtitleEl: HTMLDivElement | null = null;
let _progressBarEl: HTMLDivElement | null = null;
let _progressLabelEl: HTMLDivElement | null = null;
let _actionsEl: HTMLDivElement | null = null;
let _movePanelEl: HTMLDivElement | null = null;     // movement sub-panel
let _decisionNameInput: HTMLInputElement | null = null;

let _selectedNave: Nave | null = null;
let _mundoRef: Mundo | null = null;
let _movePanelOpen = false;

// Stable key we compare each frame to decide whether to re-render the DOM.
let _renderKey = '';

// ─── Sprite drawing (reuse the shared loader) ──────────────────────────────

function drawPortrait(canvas: HTMLCanvasElement): void {
  const img = getSpritesheetImage('ships');
  if (!img) return;
  const cssSize = canvas.clientWidth || 64;
  if (cssSize === 0) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    img,
    SHIP_COL_COLONIZADORA * SPRITE_CELL,
    SHIP_ROW_COLONIZADORA * SPRITE_CELL,
    SPRITE_CELL, SPRITE_CELL,
    0, 0, canvas.width, canvas.height,
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stageLabel(stage: Stage): string {
  switch (stage) {
    case 'idle': return t('colonizer_panel.stage_idle');
    case 'outpost': return t('colonizer_panel.stage_outpost');
    case 'traveling': return t('colonizer_panel.stage_traveling');
    case 'piloting': return t('colonizer_panel.stage_piloting');
    case 'surveying': return t('colonizer_panel.stage_surveying');
    case 'deciding': return t('colonizer_panel.stage_deciding');
  }
}

function targetName(nave: Nave): string {
  const a = nave.alvo;
  if (!a) return '—';
  if (a._tipoAlvo === 'planeta') return a.dados.nome ?? t('colonizer_panel.alvo_planeta_fallback');
  if (a._tipoAlvo === 'sol') return t('colonizer_panel.alvo_estrela');
  return `(${Math.round(a.x)}, ${Math.round(a.y)})`;
}

function distanceToTarget(nave: Nave): number | null {
  const a = nave.alvo;
  if (!a) return null;
  const dx = a.x - nave.x;
  const dy = a.y - nave.y;
  return Math.hypot(dx, dy);
}

function etaLabel(nave: Nave): string {
  const dist = distanceToTarget(nave);
  if (dist == null || dist <= 0) return '—';
  const ms = dist / VELOCIDADE_NAVE;
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function surveyProgress(nave: Nave): number {
  const total = nave.surveyTempoTotalMs ?? TEMPO_SURVEY_MS;
  const remaining = nave.surveyTempoRestanteMs ?? 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - remaining / total));
}

function surveyCountdownLabel(nave: Nave): string {
  const remaining = Math.max(0, Math.ceil((nave.surveyTempoRestanteMs ?? 0) / 1000));
  return `${remaining}s`;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    .colonizer-panel {
      position: fixed;
      z-index: 100;
      bottom: var(--hud-margin);
      left: 50%;
      width: max-content;
      max-width: calc(100vw - var(--hud-margin) * 2);
      box-sizing: border-box;
      color: var(--hud-text);
      font-family: var(--hud-font);
      display: flex;

      transform: translate(-50%, calc(var(--hud-unit) * 1.4));
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 180ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 240ms;
    }

    .colonizer-panel.visible {
      transform: translate(-50%, 0);
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 180ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    @media (prefers-reduced-motion: reduce) {
      .colonizer-panel,
      .colonizer-panel.visible {
        transition: none;
      }
    }

    .cp-row {
      display: flex;
      align-items: stretch;
      gap: calc(var(--hud-unit) * 0.5);
    }

    /* Sections use the same HUD tokens as every other panel (ship-panel,
       planet-panel, build-panel) — no tactical accents, no gradients. */
    .cp-section {
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(3px);
      padding: calc(var(--hud-unit) * 0.7) calc(var(--hud-unit) * 0.9);
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.8);
    }

    /* ── Left: portrait + stage badge ── */

    .cp-left {
      min-width: calc(var(--hud-unit) * 12);
    }

    .cp-portrait {
      width: calc(var(--hud-unit) * 3.4);
      height: calc(var(--hud-unit) * 3.4);
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
      flex: 0 0 auto;
    }

    .cp-left-text {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.25);
      min-width: 0;
    }

    .cp-name {
      font-family: var(--hud-font-display);
      font-size: var(--hud-text-md);
      line-height: 1.1;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--hud-text);
      white-space: nowrap;
    }

    .cp-stage-badge {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      line-height: 1;
      white-space: nowrap;
    }

    /* ── Middle: info + progress ── */

    .cp-middle {
      min-width: calc(var(--hud-unit) * 12);
      flex: 1 1 auto;
    }

    .cp-info {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.25);
      width: 100%;
    }

    .cp-info-title {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      line-height: 1;
    }

    .cp-info-value {
      font-family: var(--hud-font-body);
      font-size: var(--hud-text-md);
      color: var(--hud-text);
      line-height: 1.2;
      white-space: nowrap;
    }

    .cp-progress {
      width: 100%;
      height: calc(var(--hud-unit) * 0.35);
      border: 1px solid var(--hud-line);
      background: rgba(255,255,255,0.05);
      position: relative;
      margin-top: calc(var(--hud-unit) * 0.35);
    }

    .cp-progress-fill {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      background: rgba(255,255,255,0.85);
      transition: width 200ms ease-out;
    }

    .cp-progress-label {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      color: var(--hud-text-dim);
      letter-spacing: 0.05em;
      margin-top: calc(var(--hud-unit) * 0.2);
      font-variant-numeric: tabular-nums;
    }

    /* ── Right: action buttons ── */

    .cp-actions {
      display: grid;
      grid-template-columns: repeat(2, auto);
      gap: calc(var(--hud-unit) * 0.3);
      align-items: center;
    }

    .cp-btn {
      min-width: calc(var(--hud-unit) * 3.2);
      height: calc(var(--hud-unit) * 2.2);
      padding: 0 calc(var(--hud-unit) * 0.5);
      border: 1px solid var(--hud-border);
      background: transparent;
      color: var(--hud-text);
      cursor: pointer;
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 120ms ease, border-color 120ms ease;
      appearance: none;
      white-space: nowrap;
    }

    .cp-btn:hover:not(.disabled) {
      background: rgba(255,255,255,0.06);
    }

    .cp-btn.primary {
      background: rgba(255,255,255,0.08);
    }

    .cp-btn.primary:hover:not(.disabled) {
      background: rgba(255,255,255,0.14);
    }

    .cp-btn.active {
      background: rgba(255,255,255,0.18);
      color: #fff;
    }

    .cp-btn.disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    /* ── Decision prompt (replaces middle section) ── */
    .cp-decision {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.3);
      min-width: calc(var(--hud-unit) * 12);
    }

    .cp-name-input {
      width: 100%;
      padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.55);
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--hud-line);
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      font-size: var(--hud-text-md);
      letter-spacing: 0.04em;
      outline: none;
      box-sizing: border-box;
    }

    .cp-name-input:focus {
      border-color: var(--hud-border);
      background: rgba(255,255,255,0.08);
    }

    .cp-bonus {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      line-height: 1.3;
      margin-top: calc(var(--hud-unit) * 0.2);
    }

    /* ── Cockpit movement console ──
       Same HUD tokens as all other panels — no tactical accents, just a
       consistent minimal surface with a joystick and D-pad inside it. */

    .cp-cockpit {
      position: fixed;
      z-index: 101;
      bottom: calc(var(--hud-margin) + var(--hud-unit) * 7);
      left: 50%;
      padding: calc(var(--hud-unit) * 0.8) calc(var(--hud-unit) * 1);
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(3px);

      transform: translateX(-50%) translateY(calc(var(--hud-unit) * 0.6));
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 160ms ease-out,
        transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 220ms;
    }

    .cp-cockpit.visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
      transition:
        opacity 160ms ease-out,
        transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    .cp-cockpit-title {
      font-family: var(--hud-font);
      font-size: var(--hud-text-sm);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      text-align: center;
      margin-bottom: calc(var(--hud-unit) * 0.5);
    }

    .cp-cockpit-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: calc(var(--hud-unit) * 1);
    }

    /* ── Analog joystick ── */

    .cp-joystick {
      position: relative;
      width: calc(var(--hud-unit) * 4.4);
      height: calc(var(--hud-unit) * 4.4);
      border-radius: 50%;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--hud-line);
      cursor: grab;
      touch-action: none;
    }

    .cp-joystick:active {
      cursor: grabbing;
    }

    /* Crosshair guides inside the joystick */
    .cp-joystick::before,
    .cp-joystick::after {
      content: '';
      position: absolute;
      background: rgba(255,255,255,0.12);
      pointer-events: none;
    }
    .cp-joystick::before {
      top: 50%;
      left: 12%;
      right: 12%;
      height: 1px;
    }
    .cp-joystick::after {
      left: 50%;
      top: 12%;
      bottom: 12%;
      width: 1px;
    }

    .cp-joystick-nub {
      position: absolute;
      top: 50%;
      left: 50%;
      width: calc(var(--hud-unit) * 1.6);
      height: calc(var(--hud-unit) * 1.6);
      border-radius: 50%;
      background: rgba(255,255,255,0.85);
      border: 1px solid var(--hud-border);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    /* ── D-pad ── */

    .cp-dpad {
      display: grid;
      grid-template-columns: repeat(3, calc(var(--hud-unit) * 1.6));
      grid-template-rows: repeat(3, calc(var(--hud-unit) * 1.6));
      gap: calc(var(--hud-unit) * 0.12);
    }

    .cp-dpad-btn {
      appearance: none;
      border: 1px solid var(--hud-border);
      background: transparent;
      color: var(--hud-text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: calc(var(--hud-unit) * 0.9);
      font-family: var(--hud-font);
      transition: background 80ms ease;
      user-select: none;
    }

    .cp-dpad-btn:hover {
      background: rgba(255,255,255,0.08);
    }

    .cp-dpad-btn:active {
      background: rgba(255,255,255,0.16);
    }

    .cp-dpad-btn.empty {
      background: transparent;
      border: none;
      pointer-events: none;
    }

    .cp-dpad-btn.stop {
      color: var(--hud-text-dim);
      font-size: calc(var(--hud-unit) * 0.7);
    }

    .cp-cockpit-footer {
      display: flex;
      gap: calc(var(--hud-unit) * 0.4);
      margin-top: calc(var(--hud-unit) * 0.6);
      justify-content: center;
    }
  `;
  document.head.appendChild(style);
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function computeRenderKey(nave: Nave): string {
  const stage = stageForNave(nave);
  const dist = distanceToTarget(nave);
  // Thrust quantized to 10 steps so we get smooth-ish bar updates without
  // rebuilding DOM on every sub-pixel drag delta.
  const thrust = Math.round(Math.hypot(nave.thrustX ?? 0, nave.thrustY ?? 0) * 10);
  return [
    nave.id,
    stage,
    (nave.alvo as { dados?: { nome?: string } })?.dados?.nome ?? '',
    nave.alvo?._tipoAlvo ?? '',
    dist == null ? '' : Math.floor(dist / 50),
    Math.floor((nave.surveyTempoRestanteMs ?? 0) / 250),
    nave.origem?.dados.nome ?? '',
    getComandoNaveTipo() ?? '',
    _movePanelOpen ? '1' : '0',
    thrust,
  ].join('|');
}

function renderPanel(nave: Nave): void {
  if (!_container || !_middleEl) return;
  const stage = stageForNave(nave);

  // ── Left section ──
  if (_infoTitleEl) _infoTitleEl.textContent = nave.origem?.dados.nome
    ? t('colonizer_panel.origem_subtitle', { nome: nave.origem.dados.nome })
    : '';
  if (_stageBadgeEl) {
    _stageBadgeEl.textContent = stageLabel(stage);
  }

  // ── Middle section ──
  // The deciding stage swaps the middle content entirely — it becomes an
  // inline decision prompt instead of a progress display.
  if (stage === 'deciding') {
    renderMiddleDecision(nave);
  } else {
    renderMiddleInfo(nave, stage);
  }

  // ── Right section ──
  renderActions(nave, stage);

  // Keep the joystick nub in sync with the ship's current thrust vector.
  updateJoystickNubFromThrust(nave);
}

function renderMiddleInfo(nave: Nave, stage: Stage): void {
  if (!_middleEl) return;
  // Rebuild progress-style middle if it was swapped out for a decision prompt.
  if (!_infoSubtitleEl || !_progressBarEl || !_progressLabelEl || !_middleEl.contains(_infoSubtitleEl)) {
    _middleEl.replaceChildren();
    const info = document.createElement('div');
    info.className = 'cp-info';
    const infoTitle = document.createElement('div');
    infoTitle.className = 'cp-info-title';
    infoTitle.textContent = t('colonizer_panel.missao');
    const infoValue = document.createElement('div');
    infoValue.className = 'cp-info-value';
    _infoSubtitleEl = infoValue;
    const progress = document.createElement('div');
    progress.className = 'cp-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'cp-progress-fill';
    _progressBarEl = progressFill;
    progress.appendChild(progressFill);
    const progressLabel = document.createElement('div');
    progressLabel.className = 'cp-progress-label';
    _progressLabelEl = progressLabel;
    info.append(infoTitle, infoValue, progress, progressLabel);
    _middleEl.appendChild(info);
  }

  switch (stage) {
    case 'idle':
      _infoSubtitleEl.textContent = t('colonizer_panel.aguardando_ordens');
      _progressBarEl.style.width = '0%';
      _progressLabelEl.textContent = '';
      break;
    case 'outpost':
      _infoSubtitleEl.textContent = t('colonizer_panel.orbitando', { nome: targetName(nave) });
      _progressBarEl.style.width = '100%';
      _progressLabelEl.textContent = t('colonizer_panel.posto_ativo');
      break;
    case 'traveling':
      _infoSubtitleEl.textContent = t('colonizer_panel.rumo_a', { nome: targetName(nave) });
      _progressBarEl.style.width = '0%';
      _progressLabelEl.textContent = t('colonizer_panel.eta', { tempo: etaLabel(nave) });
      break;
    case 'piloting': {
      const tx = nave.thrustX ?? 0;
      const ty = nave.thrustY ?? 0;
      const mag = Math.hypot(tx, ty);
      const thrusting = mag > 0.01;
      _infoSubtitleEl.textContent = thrusting ? t('colonizer_panel.thrusters_ativos') : t('colonizer_panel.motores_lenta');
      _progressBarEl.style.width = `${Math.round(mag * 100)}%`;
      _progressLabelEl.textContent = thrusting
        ? t('colonizer_panel.thrust_pct', { pct: Math.round(mag * 100) })
        : t('colonizer_panel.solte_joystick');
      break;
    }
    case 'surveying': {
      const pct = Math.round(surveyProgress(nave) * 100);
      _infoSubtitleEl.textContent = t('colonizer_panel.escaneando', { nome: targetName(nave) });
      _progressBarEl.style.width = `${pct}%`;
      _progressLabelEl.textContent = t('colonizer_panel.survey_restante', { tempo: surveyCountdownLabel(nave) });
      break;
    }
    default:
      break;
  }
}

function renderMiddleDecision(nave: Nave): void {
  if (!_middleEl) return;
  const planeta = nave.alvo && nave.alvo._tipoAlvo === 'planeta' ? nave.alvo as Planeta : null;
  _middleEl.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'cp-decision';

  const title = document.createElement('div');
  title.className = 'cp-info-title';
  title.textContent = t('colonizer_panel.decision_titulo');
  wrap.appendChild(title);

  const label = document.createElement('div');
  label.className = 'cp-info-title';
  label.textContent = t('colonizer_panel.nome_colonia');
  label.style.marginTop = 'calc(var(--hud-unit) * 0.35)';
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cp-name-input';
  input.maxLength = 32;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = planeta?.dados.nome ?? '';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmarDecisao(); }
    else if (e.key === 'Escape') { e.preventDefault(); decidirOutpost(); }
  });
  _decisionNameInput = input;
  wrap.appendChild(input);

  const bonus = document.createElement('div');
  bonus.className = 'cp-bonus';
  bonus.textContent = t('colonizer_panel.bonus');
  wrap.appendChild(bonus);

  _middleEl.appendChild(wrap);

  // Refocus the input each time so Enter/Esc shortcuts work.
  setTimeout(() => _decisionNameInput?.focus(), 20);

  // Reset the progress refs so renderMiddleInfo will rebuild on next stage change.
  _infoSubtitleEl = null;
  _progressBarEl = null;
  _progressLabelEl = null;
}

interface ActionSpec {
  id: string;
  labelKey: string;
  hintKey?: string;
  variant?: 'default' | 'primary' | 'active';
  visible: (nave: Nave, stage: Stage) => boolean;
  enabled?: (nave: Nave, stage: Stage) => boolean;
  onClick: (nave: Nave) => void;
}

const ACTIONS: ActionSpec[] = [
  {
    id: 'target',
    labelKey: 'colonizer_panel.action_target',
    hintKey: 'colonizer_panel.action_target_hint',
    variant: 'primary',
    visible: (_n, stage) => stage === 'idle' || stage === 'outpost' || stage === 'piloting',
    enabled: () => true,
    onClick: (n) => {
      if (getComandoNaveTipo() === 'target_colonizadora') {
        cancelarComandoNave();
      } else {
        iniciarComandoNave('target_colonizadora', n);
      }
    },
  },
  {
    id: 'move',
    labelKey: 'colonizer_panel.action_move',
    hintKey: 'colonizer_panel.action_move_hint',
    visible: (_n, stage) => stage === 'idle' || stage === 'outpost' || stage === 'piloting',
    enabled: () => true,
    onClick: () => { _movePanelOpen = !_movePanelOpen; },
  },
  {
    id: 'recall',
    labelKey: 'colonizer_panel.action_recall',
    hintKey: 'colonizer_panel.action_recall_hint',
    visible: (_n, stage) => stage === 'outpost' || stage === 'idle' || stage === 'piloting',
    enabled: (n, stage) => stage !== 'idle' || n.alvo !== n.origem,
    onClick: (n) => {
      if (_mundoRef) recolherColonizadoraParaOrigem(_mundoRef, n);
    },
  },
  {
    id: 'cancel',
    labelKey: 'colonizer_panel.action_cancel',
    hintKey: 'colonizer_panel.action_cancel_hint',
    visible: (_n, stage) => stage === 'traveling',
    enabled: () => true,
    onClick: (n) => cancelarMovimentoNave(n),
  },
  {
    id: 'abort_survey',
    labelKey: 'colonizer_panel.action_abort',
    hintKey: 'colonizer_panel.action_abort_hint',
    visible: (_n, stage) => stage === 'surveying',
    enabled: () => true,
    onClick: (n) => cancelarMovimentoNave(n),
  },
  {
    id: 'colonize',
    labelKey: 'colonizer_panel.action_colonize',
    hintKey: 'colonizer_panel.action_colonize_hint',
    variant: 'primary',
    visible: (_n, stage) => stage === 'deciding',
    enabled: () => true,
    onClick: (n) => {
      if (!_mundoRef) return;
      const nome = _decisionNameInput?.value.trim() || undefined;
      confirmarColonizacao(_mundoRef, n, nome);
    },
  },
  {
    id: 'outpost',
    labelKey: 'colonizer_panel.action_outpost',
    hintKey: 'colonizer_panel.action_outpost_hint',
    visible: (_n, stage) => stage === 'deciding',
    enabled: () => true,
    onClick: (n) => manterComoOutpost(n),
  },
  {
    id: 'scrap',
    labelKey: 'colonizer_panel.action_scrap',
    hintKey: 'colonizer_panel.action_scrap_hint',
    visible: (_n, stage) => stage === 'idle' || stage === 'outpost' || stage === 'piloting',
    enabled: () => true,
    onClick: (n) => {
      if (!_mundoRef) return;
      confirmar({
        title: t('colonizer_panel.scrap_titulo'),
        message: t('colonizer_panel.scrap_mensagem'),
        confirmLabel: t('colonizer_panel.scrap_confirm'),
        cancelLabel: t('colonizer_panel.scrap_cancel'),
        danger: true,
      }).then((ok) => {
        // Sanity check: mundo and selected ship may have changed while the
        // dialog was open.
        if (ok && _mundoRef && mundoHasNave(_mundoRef, n)) {
          sucatearNave(_mundoRef, n);
        }
      });
    },
  },
];

function confirmarDecisao(): void {
  if (!_mundoRef || !_selectedNave) return;
  const nome = _decisionNameInput?.value.trim() || undefined;
  confirmarColonizacao(_mundoRef, _selectedNave, nome);
}

function decidirOutpost(): void {
  if (!_selectedNave) return;
  manterComoOutpost(_selectedNave);
}

function renderActions(nave: Nave, stage: Stage): void {
  if (!_actionsEl) return;
  _actionsEl.replaceChildren();

  const visibleActions = ACTIONS.filter((a) => a.visible(nave, stage));
  const targetingActive = getComandoNaveTipo() === 'target_colonizadora';

  for (const spec of visibleActions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cp-btn';
    if (spec.variant === 'primary') btn.classList.add('primary');
    if (spec.id === 'target' && targetingActive) btn.classList.add('active');
    if (spec.id === 'move' && _movePanelOpen) btn.classList.add('active');
    const isEnabled = spec.enabled ? spec.enabled(nave, stage) : true;
    if (!isEnabled) btn.classList.add('disabled');
    btn.textContent = t(spec.labelKey);
    if (spec.hintKey) btn.title = t(spec.hintKey);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      marcarInteracaoUi();
      if (!isEnabled || !_selectedNave) return;
      spec.onClick(_selectedNave);
      _renderKey = ''; // force refresh on next frame
    });
    _actionsEl.appendChild(btn);
  }

  // Movement sub-panel: shown as a floating panel anchored above the main
  // panel, containing free-move click + directional nudges.
  renderMovePanel(nave);
}

// Real-time piloting with inertial velocity. The thrust vector is a
// persistent direction+magnitude — setting it makes the ship cruise in
// that direction, releasing the joystick/button does NOT reset it. The
// ship keeps moving until the player sets a new direction or hits STOP.
//
// Visual: the joystick nub sticks at the current thrust position so the
// player can see the current velocity vector at a glance.

let _joystickNubEl: HTMLDivElement | null = null;
let _joystickMaxR = 0;

function ensurePiloting(nave: Nave): void {
  if (nave.estado !== 'pilotando') {
    iniciarPilotagem(nave);
  }
}

function mundoHasNave(mundo: Mundo, nave: Nave): boolean {
  return mundo.naves.includes(nave);
}

function applyThrust(nave: Nave, tx: number, ty: number): void {
  ensurePiloting(nave);
  setNaveThrust(nave, tx, ty);
}

/** Sync the nub visual to the ship's current thrust vector. */
function updateJoystickNubFromThrust(nave: Nave): void {
  if (!_joystickNubEl || _joystickMaxR <= 0) return;
  const tx = nave.thrustX ?? 0;
  const ty = nave.thrustY ?? 0;
  const px = tx * _joystickMaxR;
  const py = ty * _joystickMaxR;
  _joystickNubEl.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
}

function renderMovePanel(_nave: Nave): void {
  if (!_movePanelEl) return;
  _movePanelEl.classList.toggle('visible', _movePanelOpen);
  if (!_movePanelOpen) return;

  // The cockpit DOM is built once per open — only re-rebuild if empty.
  if (_movePanelEl.childElementCount !== 0) return;

  const title = document.createElement('div');
  title.className = 'cp-cockpit-title';
  title.textContent = t('colonizer_panel.console_header');
  _movePanelEl.appendChild(title);

  const row = document.createElement('div');
  row.className = 'cp-cockpit-row';
  _movePanelEl.appendChild(row);

  // ── Analog joystick ──
  // Drag to set thrust direction + magnitude. Release = ship KEEPS
  // cruising in that direction (inertial). Nub visually stays at the
  // current thrust position so the player can read the velocity vector.
  const stick = document.createElement('div');
  stick.className = 'cp-joystick';
  const nub = document.createElement('div');
  nub.className = 'cp-joystick-nub';
  stick.appendChild(nub);
  row.appendChild(stick);

  _joystickNubEl = nub;

  const joystickState = { active: false, pointerId: -1, maxR: 0 };

  const applyFromPointer = (clientX: number, clientY: number) => {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.38;
    joystickState.maxR = maxR;
    _joystickMaxR = maxR;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    // Normalize to magnitude 0..1 for the thrust vector.
    const tx = dx / maxR;
    const ty = dy / maxR;
    if (_selectedNave) applyThrust(_selectedNave, tx, ty);
    nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    joystickState.active = true;
    joystickState.pointerId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    stick.classList.add('active');
    applyFromPointer(e.clientX, e.clientY);
  });
  stick.addEventListener('pointermove', (e) => {
    if (!joystickState.active || e.pointerId !== joystickState.pointerId) return;
    applyFromPointer(e.clientX, e.clientY);
  });
  const endDrag = (e: PointerEvent) => {
    if (!joystickState.active || e.pointerId !== joystickState.pointerId) return;
    joystickState.active = false;
    try { stick.releasePointerCapture(e.pointerId); } catch {}
    stick.classList.remove('active');
    // Do NOT reset thrust — the ship keeps cruising in the current direction.
  };
  stick.addEventListener('pointerup', endDrag);
  stick.addEventListener('pointercancel', endDrag);

  // ── D-pad ──
  // Each click SETS the thrust direction to a cardinal unit vector.
  // Ship cruises in that direction until another direction is picked or
  // the stop button zeroes it out.
  const dpad = document.createElement('div');
  dpad.className = 'cp-dpad';

  const setThrustDir = (tx: number, ty: number) => {
    if (_selectedNave) applyThrust(_selectedNave, tx, ty);
  };

  const makeDpadBtn = (label: string, cls: string, onPress: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cp-dpad-btn ${cls}`;
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      marcarInteracaoUi();
      onPress();
      _renderKey = '';
    });
    return btn;
  };
  const empty = () => {
    const d = document.createElement('div');
    d.className = 'cp-dpad-btn empty';
    return d;
  };

  // 3×3 grid; only cardinal cells are active buttons, corners are empty.
  dpad.appendChild(empty());
  dpad.appendChild(makeDpadBtn('▲', 'up', () => setThrustDir(0, -1)));
  dpad.appendChild(empty());
  dpad.appendChild(makeDpadBtn('◀', 'left', () => setThrustDir(-1, 0)));
  dpad.appendChild(makeDpadBtn('■', 'stop', () => {
    if (_selectedNave) applyThrust(_selectedNave, 0, 0);
  }));
  dpad.appendChild(makeDpadBtn('▶', 'right', () => setThrustDir(1, 0)));
  dpad.appendChild(empty());
  dpad.appendChild(makeDpadBtn('▼', 'down', () => setThrustDir(0, 1)));
  dpad.appendChild(empty());
  row.appendChild(dpad);

  // ── Footer buttons: click-to-go mode + close ──
  const footer = document.createElement('div');
  footer.className = 'cp-cockpit-footer';
  _movePanelEl.appendChild(footer);

  const moveActive = getComandoNaveTipo() === 'move_colonizadora';
  const freeBtn = document.createElement('button');
  freeBtn.type = 'button';
  freeBtn.className = 'cp-btn primary';
  if (moveActive) freeBtn.classList.add('active');
  freeBtn.textContent = moveActive ? t('colonizer_panel.aguardando_clique') : t('colonizer_panel.click_to_go');
  freeBtn.title = t('colonizer_panel.click_to_go_hint');
  freeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    if (getComandoNaveTipo() === 'move_colonizadora') {
      cancelarComandoNave();
    } else if (_selectedNave) {
      iniciarComandoNave('move_colonizadora', _selectedNave);
    }
    _renderKey = '';
  });
  footer.appendChild(freeBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cp-btn';
  closeBtn.textContent = t('colonizer_panel.fechar');
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    _movePanelOpen = false;
    if (getComandoNaveTipo() === 'move_colonizadora') cancelarComandoNave();
    if (_movePanelEl) {
      _movePanelEl.replaceChildren();
      _movePanelEl.classList.remove('visible');
    }
    _joystickNubEl = null;
    _joystickMaxR = 0;
    _renderKey = '';
  });
  footer.appendChild(closeBtn);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function criarColonizerPanel(): HTMLDivElement {
  if (_container) return _container;
  injectStyles();
  injectBottomSheetStyles();
  loadShipsSheet();

  const panel = document.createElement('div');
  panel.className = 'colonizer-panel bottom-sheet-capable';
  panel.setAttribute('data-ui', 'true');
  panel.style.pointerEvents = 'auto';
  panel.addEventListener('pointerdown', () => marcarInteracaoUi());

  const row = document.createElement('div');
  row.className = 'cp-row';

  // Left section
  const left = document.createElement('div');
  left.className = 'cp-section cp-left';

  const portrait = document.createElement('canvas');
  portrait.className = 'cp-portrait';
  _portraitCanvas = portrait;

  const leftText = document.createElement('div');
  leftText.className = 'cp-left-text';

  const name = document.createElement('div');
  name.className = 'cp-name';
  name.textContent = t('colonizer_panel.nome');

  const stageBadge = document.createElement('div');
  stageBadge.className = 'cp-stage-badge';
  _stageBadgeEl = stageBadge;

  const originTitle = document.createElement('div');
  originTitle.className = 'cp-info-title';
  originTitle.textContent = '—';
  _infoTitleEl = originTitle;

  leftText.append(name, stageBadge, originTitle);
  left.append(portrait, leftText);

  // Middle section — content is built dynamically in renderMiddleInfo /
  // renderMiddleDecision depending on the current stage.
  const middle = document.createElement('div');
  middle.className = 'cp-section cp-middle';
  _middleEl = middle;

  // Right section
  const right = document.createElement('div');
  right.className = 'cp-section';
  const actions = document.createElement('div');
  actions.className = 'cp-actions';
  _actionsEl = actions;
  right.appendChild(actions);

  row.append(left, middle, right);
  panel.appendChild(row);
  document.body.appendChild(panel);

  // Movement sub-panel (separate top-level element so its position is
  // independent of the main panel's layout and its own transition works).
  const movePanel = document.createElement('div');
  movePanel.className = 'cp-cockpit';
  movePanel.addEventListener('pointerdown', () => marcarInteracaoUi());
  _movePanelEl = movePanel;
  document.body.appendChild(movePanel);

  _container = panel;
  return panel;
}

function loadShipsSheet(): void {
  if (getSpritesheetImage('ships')) return;
  carregarSpritesheet('ships').then(() => {
    if (_portraitCanvas) drawPortrait(_portraitCanvas);
  });
}

export function atualizarColonizerPanel(mundo: Mundo): void {
  if (!_container) return;
  _mundoRef = mundo;

  const nave = obterNaveSelecionada(mundo);
  if (!nave || nave.tipo !== 'colonizadora') {
    _container.classList.remove('visible');
    if (_movePanelEl) {
      _movePanelEl.classList.remove('visible');
      _movePanelEl.replaceChildren();
    }
    _movePanelOpen = false;
    _joystickNubEl = null;
    _joystickMaxR = 0;
    _selectedNave = null;
    _renderKey = '';
    return;
  }

  if (_selectedNave !== nave) {
    _selectedNave = nave;
    _renderKey = '';
    if (_portraitCanvas) {
      requestAnimationFrame(() => { if (_portraitCanvas) drawPortrait(_portraitCanvas); });
    }
  }

  _container.classList.add('visible');

  const key = computeRenderKey(nave);
  if (key !== _renderKey) {
    renderPanel(nave);
    _renderKey = key;
  }
}

/**
 * Tells the ship-panel whether it should hide itself because a colonizadora
 * is selected (and therefore owned by the colonizer-panel instead).
 */
export function colonizerPanelShouldHandleSelection(mundo: Mundo): boolean {
  const nave = obterNaveSelecionada(mundo);
  return !!nave && nave.tipo === 'colonizadora';
}

export function destruirColonizerPanel(): void {
  _container?.remove();
  _container = null;
  _styleInjected = false;
  _portraitCanvas = null;
  _stageBadgeEl = null;
  _infoTitleEl = null;
  _infoSubtitleEl = null;
  _progressBarEl = null;
  _progressLabelEl = null;
  _actionsEl = null;
  _selectedNave = null;
  _mundoRef = null;
  _renderKey = '';
}
