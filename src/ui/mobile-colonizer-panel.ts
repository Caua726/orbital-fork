// Mobile-specific colonizer panel. Same monochromatic card-modal shell as
// mobile-ship-panel, but stage-aware (idle/outpost/traveling/surveying/
// deciding/piloting). Reuses the data + actions from colonizer-panel.

import type { Mundo, Nave } from '../types';
import { marcarInteracaoUi } from './interacao-ui';
import { pulseElement } from './animations.css';
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
import { iniciarComandoNave, cancelarComandoNave, getComandoNaveTipo, setCameraFollow } from '../core/player';
import { confirmar } from './confirm-dialog';
import { t } from '../core/i18n/t';
import {
  type Stage,
  stageForNave,
  drawPortrait,
  stageLabel,
  targetName,
  etaLabel,
  surveyProgress,
  surveyCountdownLabel,
} from './colonizer-panel';

interface ActionSpec {
  id: string;
  labelKey: string;
  variant?: 'default' | 'primary' | 'danger';
  visible: (nave: Nave, stage: Stage) => boolean;
  enabled?: (nave: Nave, stage: Stage) => boolean;
  onClick: (nave: Nave) => void;
}

const ACTIONS: ActionSpec[] = [
  {
    id: 'target',
    labelKey: 'colonizer_panel.action_target',
    variant: 'primary',
    visible: (_n, s) => s === 'idle' || s === 'outpost' || s === 'piloting',
    onClick: (n) => {
      if (getComandoNaveTipo() === 'target_colonizadora') cancelarComandoNave();
      else iniciarComandoNave('target_colonizadora', n);
    },
  },
  {
    id: 'move',
    labelKey: 'colonizer_panel.action_move',
    visible: (_n, s) => s === 'idle' || s === 'outpost' || s === 'piloting',
    onClick: () => {
      _pilotingOpen = !_pilotingOpen;
      if (_selectedNave && _pilotingOpen && _selectedNave.estado !== 'pilotando') {
        iniciarPilotagem(_selectedNave);
      }
      if (_selectedNave) renderActions(_selectedNave, stageForNave(_selectedNave));
      renderCockpit();
    },
  },
  {
    id: 'recall',
    labelKey: 'colonizer_panel.action_recall',
    visible: (_n, s) => s === 'outpost' || s === 'idle' || s === 'piloting',
    enabled: (n, s) => s !== 'idle' || n.alvo !== n.origem,
    onClick: (n) => { if (_mundoRef) recolherColonizadoraParaOrigem(_mundoRef, n); },
  },
  {
    id: 'cancel',
    labelKey: 'colonizer_panel.action_cancel',
    visible: (_n, s) => s === 'traveling',
    onClick: (n) => cancelarMovimentoNave(n),
  },
  {
    id: 'abort_survey',
    labelKey: 'colonizer_panel.action_abort',
    visible: (_n, s) => s === 'surveying',
    onClick: (n) => cancelarMovimentoNave(n),
  },
  {
    id: 'colonize',
    labelKey: 'colonizer_panel.action_colonize',
    variant: 'primary',
    visible: (_n, s) => s === 'deciding',
    onClick: (n) => {
      if (!_mundoRef) return;
      const nome = _decisionInput?.value.trim() || undefined;
      confirmarColonizacao(_mundoRef, n, nome);
    },
  },
  {
    id: 'outpost',
    labelKey: 'colonizer_panel.action_outpost',
    visible: (_n, s) => s === 'deciding',
    onClick: (n) => manterComoOutpost(n),
  },
  {
    id: 'scrap',
    labelKey: 'colonizer_panel.action_scrap',
    variant: 'danger',
    visible: (_n, s) => s === 'idle' || s === 'outpost' || s === 'piloting',
    onClick: (n) => {
      void confirmar({
        title: t('colonizer_panel.scrap_titulo'),
        message: t('colonizer_panel.scrap_mensagem'),
        confirmLabel: t('colonizer_panel.scrap_confirm'),
        cancelLabel: t('colonizer_panel.scrap_cancel'),
        danger: true,
      }).then((ok) => { if (ok && _mundoRef) sucatearNave(_mundoRef, n); });
    },
  },
];

let _styleInjected = false;
let _modal: HTMLDivElement | null = null;
let _portraitCanvas: HTMLCanvasElement | null = null;
let _nameEl: HTMLDivElement | null = null;
let _stageBadgeEl: HTMLDivElement | null = null;
let _subtitleEl: HTMLDivElement | null = null;
let _missionValueEl: HTMLDivElement | null = null;
let _progressEl: HTMLDivElement | null = null;
let _progressFillEl: HTMLDivElement | null = null;
let _progressLabelEl: HTMLDivElement | null = null;
let _decisionWrapEl: HTMLDivElement | null = null;
let _decisionInput: HTMLInputElement | null = null;
let _actionsEl: HTMLDivElement | null = null;
let _cockpitEl: HTMLDivElement | null = null;
let _joystickNubEl: HTMLDivElement | null = null;
let _joystickMaxR = 0;
let _selectedNave: Nave | null = null;
let _mundoRef: Mundo | null = null;
let _renderKey = '';
let _pilotingOpen = false;
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const orphan = document.head.querySelector('style[data-mobile-colonizer]');
  if (orphan) orphan.remove();
  const style = document.createElement('style');
  style.setAttribute('data-mobile-colonizer', '1');
  style.textContent = `
    .mcol-modal {
      position: fixed;
      inset: auto;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.88);
      width: min(90vw, 340px);
      max-width: 90vw;
      max-height: 72dvh;
      margin: 0;
      padding: 0;
      border: 1px solid rgba(255,255,255,0.5);
      border-radius: 14px;
      background: #000;
      color: #fff;
      font-family: var(--hud-font-body);
      z-index: 945;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.6);
      transition:
        opacity 220ms cubic-bezier(0.2, 0.7, 0.2, 1),
        transform 280ms cubic-bezier(0.2, 0.9, 0.2, 1.05),
        visibility 0s linear 280ms;
    }
    .mcol-modal.visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translate(-50%, -50%) scale(1);
      transition:
        opacity 220ms cubic-bezier(0.2, 0.7, 0.2, 1),
        transform 280ms cubic-bezier(0.2, 0.9, 0.2, 1.05),
        visibility 0s linear 0s;
    }
    /* Piloting mode — collapses to a bottom bar with just the cockpit so
       the player can see the ship traveling on the canvas behind. */
    .mcol-modal.piloting {
      top: auto !important;
      left: 50% !important;
      bottom: calc(12px + var(--safe-bottom, 0px)) !important;
      max-height: none !important;
      width: min(94vw, 340px) !important;
      transform: translate(-50%, 0) !important;
      background: rgba(0, 0, 0, 0.72) !important;
      backdrop-filter: blur(3px);
    }
    .mcol-modal.visible.piloting {
      transform: translate(-50%, 0) scale(1) !important;
    }
    /* Hide non-essential sections while piloting. Keep only head (so user
       knows which ship), cockpit (controls), and actions (Stop/Target). */
    .mcol-modal.piloting .mcol-mission,
    .mcol-modal.piloting .mcol-decision {
      display: none !important;
    }
    .mcol-modal.piloting .mcol-head {
      padding: 8px 40px 8px 10px !important;
      border-bottom: 1px solid rgba(255,255,255,0.08) !important;
    }
    .mcol-modal.piloting .mcol-portrait {
      width: 36px !important;
      height: 36px !important;
    }
    .mcol-modal.piloting .mcol-portrait canvas {
      width: 28px !important;
      height: 28px !important;
    }
    .mcol-modal.piloting .mcol-name {
      font-size: 12px !important;
    }
    .mcol-modal.piloting .mcol-stage,
    .mcol-modal.piloting .mcol-subtitle {
      display: none !important;
    }
    .mcol-modal.piloting .mcol-close {
      width: 28px !important;
      height: 28px !important;
      top: 4px !important;
      right: 4px !important;
    }
    .mcol-modal.piloting .mcol-body {
      padding: 8px 10px 10px !important;
      gap: 6px !important;
    }
    .mcol-modal.piloting .mcol-cockpit {
      padding: 0 !important;
      border-top: none !important;
    }
    .mcol-modal.piloting .mcol-joystick {
      width: 120px !important;
      height: 120px !important;
    }
    .mcol-modal.piloting .mcol-actions {
      grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)) !important;
      border-top: none !important;
      padding-top: 0 !important;
    }

    /* Targeting mode — modal shrinks to a thin bottom hint bar so the
       player can see and tap the planet they want to target. Only a
       "Toque num planeta" prompt + Cancel button remain. */
    .mcol-modal.targeting {
      top: auto !important;
      left: 50% !important;
      bottom: calc(12px + var(--safe-bottom, 0px)) !important;
      max-height: none !important;
      width: min(94vw, 340px) !important;
      transform: translate(-50%, 0) !important;
      background: rgba(0, 0, 0, 0.8) !important;
      backdrop-filter: blur(3px);
    }
    .mcol-modal.visible.targeting {
      transform: translate(-50%, 0) scale(1) !important;
    }
    .mcol-modal.targeting .mcol-head,
    .mcol-modal.targeting .mcol-mission,
    .mcol-modal.targeting .mcol-decision,
    .mcol-modal.targeting .mcol-cockpit,
    .mcol-modal.targeting .mcol-actions {
      display: none !important;
    }
    .mcol-targeting-hint {
      display: none;
      padding: 10px 12px;
      align-items: center;
      gap: 10px;
    }
    .mcol-modal.targeting .mcol-targeting-hint {
      display: flex !important;
    }
    .mcol-targeting-icon {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      border: 1px solid #fff;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #fff;
      font-family: var(--hud-font);
      font-size: 14px;
      animation: mcol-pulse 1400ms ease-in-out infinite;
    }
    @keyframes mcol-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.35); }
      50%      { box-shadow: 0 0 0 6px rgba(255,255,255,0); }
    }
    .mcol-targeting-text {
      flex: 1 1 auto;
      min-width: 0;
      font-family: var(--hud-font);
      font-size: 12px;
      letter-spacing: 0.06em;
      color: #fff;
    }
    .mcol-targeting-cancel {
      appearance: none;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.4);
      color: #fff;
      font-family: var(--hud-font);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 8px 12px;
      min-height: 36px;
      border-radius: 6px;
      cursor: pointer;
      flex: 0 0 auto;
    }
    .mcol-targeting-cancel:hover,
    .mcol-targeting-cancel:active {
      background: rgba(255,255,255,0.1);
      border-color: #fff;
    }
    .mcol-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.25);
      color: rgba(255,255,255,0.7);
      border-radius: 6px;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      touch-action: manipulation;
      z-index: 3;
      transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .mcol-close:hover {
      background: rgba(255,255,255,0.12);
      color: #fff;
      border-color: rgba(255,255,255,0.7);
    }
    .mcol-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 48px 12px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .mcol-portrait {
      width: 56px;
      height: 56px;
      flex: 0 0 auto;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      background: rgba(255,255,255,0.04);
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .mcol-portrait canvas {
      width: 44px;
      height: 44px;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    .mcol-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .mcol-name {
      font-family: var(--hud-font-display);
      font-size: 15px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #fff;
      line-height: 1.1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mcol-stage {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      padding: 2px 8px;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.85);
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.25);
      border-radius: 4px;
    }
    .mcol-subtitle {
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      letter-spacing: 0.04em;
    }
    .mcol-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 14px 14px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .mcol-mission {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .mcol-mission-title {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.5);
    }
    .mcol-mission-value {
      font-size: 13px;
      color: #fff;
      letter-spacing: 0.02em;
    }
    .mcol-progress {
      height: 6px;
      border-radius: 3px;
      background: rgba(255,255,255,0.08);
      overflow: hidden;
      margin-top: 6px;
    }
    .mcol-progress-fill {
      height: 100%;
      background: #fff;
      width: 0%;
      transition: width 200ms ease;
    }
    .mcol-progress-label {
      font-size: 10px;
      color: rgba(255,255,255,0.55);
      font-variant-numeric: tabular-nums;
      text-align: right;
      margin-top: 2px;
    }
    .mcol-decision {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .mcol-decision-label {
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.55);
    }
    .mcol-name-input {
      appearance: none;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.25);
      color: #fff;
      font-family: var(--hud-font);
      font-size: 14px;
      padding: 10px 12px;
      border-radius: 6px;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .mcol-name-input:focus {
      border-color: #fff;
      background: rgba(255,255,255,0.08);
    }
    .mcol-bonus {
      font-size: 11px;
      color: rgba(255,255,255,0.5);
      letter-spacing: 0.04em;
    }
    .mcol-actions {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 6px;
      padding-top: 4px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .mcol-action {
      appearance: none;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.2);
      color: #fff;
      border-radius: 8px;
      padding: 10px 8px;
      min-height: 44px;
      font-family: var(--hud-font);
      font-size: 12px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, transform 100ms ease;
    }
    .mcol-action:hover:not(.disabled),
    .mcol-action:active:not(.disabled) {
      background: rgba(255,255,255,0.12);
      border-color: #fff;
      transform: translateY(-1px);
    }
    .mcol-action.disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .mcol-action.primary {
      background: rgba(255,255,255,0.16);
      border-color: #fff;
    }
    .mcol-action.danger {
      color: rgba(255,140,140,0.95);
      border-color: rgba(255,140,140,0.45);
    }
    .mcol-action.danger:hover:not(.disabled) {
      background: rgba(255,140,140,0.1);
      border-color: rgba(255,140,140,0.85);
    }
    /* Cockpit (piloting) — joystick + stop button. Mounted inline below
       the mission section when "Mover" is pressed. */
    .mcol-cockpit {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 12px 0 6px;
      border-top: 1px solid rgba(255,255,255,0.08);
    }
    .mcol-cockpit.open { display: flex; }
    .mcol-joystick {
      position: relative;
      width: 150px;
      height: 150px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.35);
      background:
        radial-gradient(circle at 50% 50%, rgba(255,255,255,0.04), rgba(255,255,255,0) 70%),
        rgba(255,255,255,0.02);
      touch-action: none;
      user-select: none;
      flex-shrink: 0;
      cursor: grab;
    }
    .mcol-joystick:active,
    .mcol-joystick.active {
      cursor: grabbing;
      border-color: #fff;
    }
    .mcol-joystick::before,
    .mcol-joystick::after {
      content: '';
      position: absolute;
      background: rgba(255,255,255,0.12);
      pointer-events: none;
    }
    .mcol-joystick::before {
      top: 50%; left: 8%;
      width: 84%; height: 1px;
      transform: translateY(-50%);
    }
    .mcol-joystick::after {
      left: 50%; top: 8%;
      width: 1px; height: 84%;
      transform: translateX(-50%);
    }
    .mcol-joystick-nub {
      position: absolute;
      top: 50%; left: 50%;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(255,255,255,0.85);
      border: 1px solid #fff;
      transform: translate(-50%, -50%);
      pointer-events: none;
      transition: transform 60ms linear;
    }
    .mcol-cockpit-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .mcol-stop {
      appearance: none;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.45);
      color: #fff;
      border-radius: 8px;
      padding: 10px 18px;
      min-height: 44px;
      font-family: var(--hud-font);
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .mcol-stop:hover, .mcol-stop:active {
      background: rgba(255,255,255,0.16);
      border-color: #fff;
    }
    .mcol-cockpit-hint {
      font-size: 10px;
      color: rgba(255,255,255,0.55);
      letter-spacing: 0.04em;
      text-align: center;
      padding: 0 8px;
    }
    @media (prefers-reduced-motion: reduce) {
      .mcol-modal,
      .mcol-modal.visible {
        transition: opacity 120ms ease, visibility 0s linear 0s;
        transform: translate(-50%, -50%) scale(1);
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureModal(): void {
  if (_modal) return;
  injectStyles();
  const modal = document.createElement('div');
  modal.className = 'mcol-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'mcol-title');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mcol-close';
  closeBtn.setAttribute('aria-label', 'Fechar');
  closeBtn.textContent = '\u2715';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
    if (_selectedNave) _selectedNave.selecionado = false;
  });
  modal.appendChild(closeBtn);

  const head = document.createElement('div');
  head.className = 'mcol-head';

  const portraitWrap = document.createElement('div');
  portraitWrap.className = 'mcol-portrait';
  const portrait = document.createElement('canvas');
  _portraitCanvas = portrait;
  portraitWrap.appendChild(portrait);
  head.appendChild(portraitWrap);

  const text = document.createElement('div');
  text.className = 'mcol-text';
  const name = document.createElement('div');
  name.className = 'mcol-name';
  name.id = 'mcol-title';
  _nameEl = name;
  const stageBadge = document.createElement('div');
  stageBadge.className = 'mcol-stage';
  _stageBadgeEl = stageBadge;
  const subtitle = document.createElement('div');
  subtitle.className = 'mcol-subtitle';
  _subtitleEl = subtitle;
  text.append(name, stageBadge, subtitle);
  head.appendChild(text);
  modal.appendChild(head);

  const body = document.createElement('div');
  body.className = 'mcol-body';

  // Mission section (info + progress)
  const mission = document.createElement('div');
  mission.className = 'mcol-mission';
  const missionTitle = document.createElement('div');
  missionTitle.className = 'mcol-mission-title';
  missionTitle.textContent = t('colonizer_panel.missao');
  const missionValue = document.createElement('div');
  missionValue.className = 'mcol-mission-value';
  _missionValueEl = missionValue;
  const progress = document.createElement('div');
  progress.className = 'mcol-progress';
  const progressFill = document.createElement('div');
  progressFill.className = 'mcol-progress-fill';
  progress.appendChild(progressFill);
  _progressEl = progress;
  _progressFillEl = progressFill;
  const progressLabel = document.createElement('div');
  progressLabel.className = 'mcol-progress-label';
  _progressLabelEl = progressLabel;
  mission.append(missionTitle, missionValue, progress, progressLabel);
  body.appendChild(mission);

  // Decision section (only visible in stage='deciding')
  const decisionWrap = document.createElement('div');
  decisionWrap.className = 'mcol-decision';
  decisionWrap.style.display = 'none';
  const decisionLabel = document.createElement('div');
  decisionLabel.className = 'mcol-decision-label';
  decisionLabel.textContent = t('colonizer_panel.nome_colonia');
  const decisionInput = document.createElement('input');
  decisionInput.className = 'mcol-name-input';
  decisionInput.type = 'text';
  decisionInput.placeholder = t('colonizer_panel.nome_colonia');
  decisionInput.maxLength = 40;
  _decisionInput = decisionInput;
  const bonus = document.createElement('div');
  bonus.className = 'mcol-bonus';
  bonus.textContent = t('colonizer_panel.bonus');
  decisionWrap.append(decisionLabel, decisionInput, bonus);
  _decisionWrapEl = decisionWrap;
  body.appendChild(decisionWrap);

  // Cockpit (joystick + stop). Mounted empty; populated by renderCockpit().
  const cockpit = document.createElement('div');
  cockpit.className = 'mcol-cockpit';
  _cockpitEl = cockpit;
  body.appendChild(cockpit);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'mcol-actions';
  _actionsEl = actions;
  body.appendChild(actions);

  // Targeting hint — only shown while a target command is pending.
  const hint = document.createElement('div');
  hint.className = 'mcol-targeting-hint';
  const hintIcon = document.createElement('div');
  hintIcon.className = 'mcol-targeting-icon';
  hintIcon.textContent = '◎';
  const hintText = document.createElement('div');
  hintText.className = 'mcol-targeting-text';
  hintText.textContent = 'Toque num planeta pra alvejar';
  const hintCancel = document.createElement('button');
  hintCancel.type = 'button';
  hintCancel.className = 'mcol-targeting-cancel';
  hintCancel.textContent = 'Cancelar';
  hintCancel.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    cancelarComandoNave();
  });
  hint.append(hintIcon, hintText, hintCancel);
  modal.appendChild(hint);

  modal.appendChild(body);
  document.body.appendChild(modal);
  _modal = modal;

  _keydownHandler = (e: KeyboardEvent) => {
    if (!_selectedNave || !_modal?.classList.contains('visible')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      _selectedNave.selecionado = false;
    }
  };
  window.addEventListener('keydown', _keydownHandler);
}

function renderHead(nave: Nave, stage: Stage): void {
  if (_portraitCanvas) drawPortrait(_portraitCanvas);
  if (_nameEl) _nameEl.textContent = t('nave.colonizadora');
  if (_stageBadgeEl) _stageBadgeEl.textContent = stageLabel(stage);
  if (_subtitleEl) {
    const origem = nave.origem?.dados.nome;
    _subtitleEl.textContent = origem ? t('colonizer_panel.origem_subtitle', { nome: origem }) : '';
  }
}

function renderMission(nave: Nave, stage: Stage): void {
  if (!_missionValueEl || !_progressEl || !_progressFillEl || !_progressLabelEl) return;

  // Reset progress visibility
  _progressEl.style.display = 'none';
  _progressLabelEl.style.display = 'none';

  switch (stage) {
    case 'idle':
      _missionValueEl.textContent = nave.origem?.dados.nome
        ? t('colonizer_panel.orbitando', { nome: nave.origem.dados.nome })
        : t('colonizer_panel.aguardando_ordens');
      break;
    case 'outpost':
      _missionValueEl.textContent = t('colonizer_panel.posto_ativo');
      break;
    case 'traveling':
      _missionValueEl.textContent = t('colonizer_panel.rumo_a', { nome: targetName(nave) });
      _progressLabelEl.style.display = '';
      _progressLabelEl.textContent = etaLabel(nave);
      break;
    case 'piloting':
      _missionValueEl.textContent = t('colonizer_panel.thrusters_ativos');
      break;
    case 'surveying':
      _missionValueEl.textContent = t('colonizer_panel.escaneando', { nome: targetName(nave) });
      _progressEl.style.display = '';
      _progressLabelEl.style.display = '';
      _progressFillEl.style.width = `${Math.round(surveyProgress(nave) * 100)}%`;
      _progressLabelEl.textContent = surveyCountdownLabel(nave);
      break;
    case 'deciding':
      _missionValueEl.textContent = t('colonizer_panel.decision_titulo');
      break;
  }

  // Show decision input only in deciding stage.
  if (_decisionWrapEl) {
    _decisionWrapEl.style.display = stage === 'deciding' ? '' : 'none';
  }
  if (stage === 'deciding' && _decisionInput && document.activeElement !== _decisionInput) {
    _decisionInput.value = (nave.alvo as { dados?: { nome?: string } })?.dados?.nome ?? '';
    setTimeout(() => _decisionInput?.focus(), 20);
  }
}

function renderActions(nave: Nave, stage: Stage): void {
  if (!_actionsEl) return;
  _actionsEl.replaceChildren();
  for (const action of ACTIONS) {
    if (!action.visible(nave, stage)) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mcol-action ${action.variant === 'primary' ? 'primary' : action.variant === 'danger' ? 'danger' : ''}`;
    btn.textContent = t(action.labelKey);
    const enabled = action.enabled ? action.enabled(nave, stage) : true;
    if (!enabled) btn.classList.add('disabled');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      marcarInteracaoUi();
      if (!enabled || !_mundoRef) return;
      action.onClick(nave);
      pulseElement(btn);
    });
    _actionsEl.appendChild(btn);
  }
}

function renderCockpit(): void {
  if (!_cockpitEl) return;
  _cockpitEl.classList.toggle('open', _pilotingOpen);
  if (!_pilotingOpen) {
    // Tear down the joystick listeners by clearing the container — fresh
    // DOM next time it opens.
    _cockpitEl.replaceChildren();
    _joystickNubEl = null;
    _joystickMaxR = 0;
    return;
  }
  if (_cockpitEl.childElementCount !== 0) return;

  const hintTop = document.createElement('div');
  hintTop.className = 'mcol-cockpit-hint';
  hintTop.textContent = t('colonizer_panel.solte_joystick');
  _cockpitEl.appendChild(hintTop);

  const stick = document.createElement('div');
  stick.className = 'mcol-joystick';
  const nub = document.createElement('div');
  nub.className = 'mcol-joystick-nub';
  stick.appendChild(nub);
  _joystickNubEl = nub;

  const state = { active: false, pointerId: -1 };
  const applyFromPointer = (clientX: number, clientY: number) => {
    if (!_selectedNave) return;
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.38;
    _joystickMaxR = maxR;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) { dx = (dx / dist) * maxR; dy = (dy / dist) * maxR; }
    const tx = dx / maxR;
    const ty = dy / maxR;
    if (_selectedNave.estado !== 'pilotando') iniciarPilotagem(_selectedNave);
    setNaveThrust(_selectedNave, tx, ty);
    nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    state.active = true;
    state.pointerId = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch {}
    stick.classList.add('active');
    applyFromPointer(e.clientX, e.clientY);
    if (_selectedNave) setCameraFollow(_selectedNave);
  });
  stick.addEventListener('pointermove', (e) => {
    if (!state.active || e.pointerId !== state.pointerId) return;
    applyFromPointer(e.clientX, e.clientY);
  });
  const endDrag = (e: PointerEvent) => {
    if (!state.active || e.pointerId !== state.pointerId) return;
    state.active = false;
    try { stick.releasePointerCapture(e.pointerId); } catch {}
    stick.classList.remove('active');
    // Intentional: don't reset thrust — ship keeps cruising.
  };
  stick.addEventListener('pointerup', endDrag);
  stick.addEventListener('pointercancel', endDrag);

  const row = document.createElement('div');
  row.className = 'mcol-cockpit-row';
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'mcol-stop';
  stop.textContent = 'STOP';
  stop.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    if (_selectedNave) setNaveThrust(_selectedNave, 0, 0);
    nub.style.transform = 'translate(-50%, -50%)';
  });
  row.appendChild(stop);
  _cockpitEl.appendChild(stick);
  _cockpitEl.appendChild(row);
}

function updateJoystickNubFromThrust(nave: Nave): void {
  if (!_joystickNubEl || _joystickMaxR <= 0) return;
  const tx = nave.thrustX ?? 0;
  const ty = nave.thrustY ?? 0;
  const px = tx * _joystickMaxR;
  const py = ty * _joystickMaxR;
  _joystickNubEl.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
}

function isTargetingActive(): boolean {
  return getComandoNaveTipo() === 'target_colonizadora';
}

function computeRenderKey(nave: Nave, stage: Stage): string {
  return [
    nave.id,
    stage,
    targetName(nave),
    nave.estado,
    nave.alvo?._tipoAlvo ?? '',
    Math.floor(surveyProgress(nave) * 100),
    ehColonizadoraOutpost(nave) ? '1' : '0',
    isTargetingActive() ? '1' : '0',
  ].join('|');
}

export function criarMobileColonizerPanel(): void {
  ensureModal();
}

export function atualizarMobileColonizerPanel(mundo: Mundo): void {
  ensureModal();
  if (!_modal) return;
  _mundoRef = mundo;

  const nave = obterNaveSelecionada(mundo);
  if (!nave || nave.tipo !== 'colonizadora') {
    if (_modal.classList.contains('visible')) _modal.classList.remove('visible');
    _selectedNave = null;
    _renderKey = '';
    return;
  }

  const stage = stageForNave(nave);
  // Auto-open cockpit when actively piloting; auto-close when no longer
  // in a piloting-compatible stage.
  if (stage === 'piloting' && !_pilotingOpen) _pilotingOpen = true;
  if (stage !== 'piloting' && stage !== 'idle' && stage !== 'outpost') _pilotingOpen = false;
  // When the cockpit is open, collapse the modal to a bottom-bar so the
  // canvas behind is visible and the player can see the ship traveling.
  _modal.classList.toggle('piloting', _pilotingOpen && !isTargetingActive());
  // When the player pressed Target, collapse to just a hint bar so they
  // can actually see and tap the planet they want to aim at.
  _modal.classList.toggle('targeting', isTargetingActive());

  const key = computeRenderKey(nave, stage);
  if (nave !== _selectedNave || key !== _renderKey) {
    const wasSameShip = nave === _selectedNave;
    _selectedNave = nave;
    _renderKey = key;
    renderHead(nave, stage);
    renderMission(nave, stage);
    renderActions(nave, stage);
    if (!wasSameShip) renderCockpit();
    else _cockpitEl?.classList.toggle('open', _pilotingOpen);
  }

  // Keep the joystick nub in sync with actual thrust while open.
  if (_pilotingOpen) updateJoystickNubFromThrust(nave);

  if (!_modal.classList.contains('visible')) {
    void _modal.offsetHeight;
    _modal.classList.add('visible');
  }
}

export function destruirMobileColonizerPanel(): void {
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = null;
  }
  _modal?.remove();
  _modal = null;
  _portraitCanvas = null;
  _nameEl = null;
  _stageBadgeEl = null;
  _subtitleEl = null;
  _missionValueEl = null;
  _progressEl = null;
  _progressFillEl = null;
  _progressLabelEl = null;
  _decisionWrapEl = null;
  _decisionInput = null;
  _actionsEl = null;
  _cockpitEl = null;
  _joystickNubEl = null;
  _joystickMaxR = 0;
  _pilotingOpen = false;
  _selectedNave = null;
  _mundoRef = null;
  _renderKey = '';
  _styleInjected = false;
}
