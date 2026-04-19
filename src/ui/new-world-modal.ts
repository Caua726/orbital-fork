import { marcarInteracaoUi } from './interacao-ui';
import type { TipoJogador } from '../types';
import { getBackendAtivo } from '../world/save';
import { t } from '../core/i18n/t';
import type { Dificuldade } from '../world/personalidade-ia';
import {
  type ImperioJogador,
  type ObjetivoImperio,
  type EixosPersonalidade,
  imperioJogadorDefault,
  derivarBonus,
  gerarLoreDoJogador,
  COR_JOGADOR_DEFAULT,
  pesosDeEixos,
  eixosDePesos,
  EIXOS_PRESETS,
} from '../world/imperio-jogador';
import {
  gerarSigilo, gerarSigiloManual, seedVariacoes, novaSeed,
  FRAMES, MOTIFS, ORNAMENTS,
  FRAME_LABEL, MOTIF_LABEL, ORNAMENT_LABEL,
  renderFramePreview, renderMotifPreview, renderOrnamentPreview,
  type Frame, type MotifKind, type Ornament,
} from './empire-builder/sigilos';
import type { ImperioLore } from '../world/lore/imperio-lore';

interface NovoMundoResultado {
  nome: string;
  tipoJogador: TipoJogador;
  dificuldade: Dificuldade;
  imperio: ImperioJogador;
}

interface OpenOpts {
  onConfirm: (r: NovoMundoResultado) => void;
  onCancel: () => void;
}

type StepId = 'mundo' | 'imperio' | 'personalidade' | 'objetivo' | 'lore';

const STEP_ORDER: readonly StepId[] = ['mundo', 'imperio', 'personalidade', 'objetivo', 'lore'];

const STEP_LABEL: Record<StepId, string> = {
  mundo: 'Mundo',
  imperio: 'Império',
  personalidade: 'Personalidade',
  objetivo: 'Objetivo',
  lore: 'Lore',
};

interface WizardState {
  /** Current step index into STEP_ORDER. */
  stepIdx: number;
  // Step 1
  nomeMundo: string;
  dificuldade: Dificuldade;
  // Steps 2-5
  imperio: ImperioJogador;
  // Step 2 — base seed for the sigil gallery (seed, seed+1, ..., seed+7)
  sigiloGalleryBase: number;
  // Step 5
  loreSeed: number;
  loreCache: ImperioLore | null;
  // Errors
  erroMundo: string;
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
    @keyframes nwm-backdrop-in { from { opacity: 0; } to { opacity: 1; } }
    .new-world-modal.closing { opacity: 0; transition: opacity 200ms ease-out; }
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
      padding: calc(var(--hud-unit) * 1.6) calc(var(--hud-unit) * 2);
      width: clamp(calc(var(--hud-unit) * 24), 60vw, calc(var(--hud-unit) * 38));
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.9);
      box-shadow: 0 calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1.2) rgba(0, 0, 0, 0.6);
      animation: nwm-card-in 240ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
    }
    @keyframes nwm-card-in {
      from { opacity: 0; transform: translateY(calc(var(--hud-unit) * 0.5)) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .nwm-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.4);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      text-align: center;
      margin: 0;
    }

    /* ─ Stepper ─ */
    .nwm-stepper {
      display: flex;
      gap: calc(var(--hud-unit) * 0.3);
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      padding-bottom: calc(var(--hud-unit) * 0.6);
      border-bottom: 1px solid var(--hud-line);
    }
    .nwm-step-pill {
      display: inline-flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.3);
      padding: calc(var(--hud-unit) * 0.3) calc(var(--hud-unit) * 0.7);
      border: 1px solid var(--hud-line);
      border-radius: 999px;
      font-size: calc(var(--hud-unit) * 0.72);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
    }
    .nwm-step-pill .nwm-step-n {
      font-variant-numeric: tabular-nums;
      opacity: 0.7;
    }
    .nwm-step-pill.current {
      color: var(--hud-text);
      border-color: #8ce0ff;
      background: rgba(140, 224, 255, 0.1);
    }
    .nwm-step-pill.done {
      color: var(--hud-text);
      border-color: rgba(140, 224, 255, 0.4);
    }

    /* ─ Body slot ─ */
    .nwm-body {
      flex: 1;
      min-height: calc(var(--hud-unit) * 14);
      overflow-y: auto;
      padding-right: calc(var(--hud-unit) * 0.2);
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.7);
    }
    .nwm-body::-webkit-scrollbar { width: 8px; }
    .nwm-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }

    .nwm-label {
      font-size: calc(var(--hud-unit) * 0.78);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin-bottom: calc(var(--hud-unit) * 0.2);
    }
    .nwm-input, .nwm-input select, select.nwm-input {
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
      box-sizing: border-box;
    }
    .nwm-input:focus, select.nwm-input:focus { border-color: #8ce0ff; }
    .nwm-error {
      color: #ff6b6b;
      font-size: calc(var(--hud-unit) * 0.75);
      min-height: calc(var(--hud-unit) * 0.9);
    }
    .nwm-hint {
      font-size: calc(var(--hud-unit) * 0.72);
      color: var(--hud-text-dim);
    }

    /* ─ Sigil grid ─ */
    .nwm-sigil-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: calc(var(--hud-unit) * 0.35);
    }
    @media (max-width: 520px) { .nwm-sigil-grid { grid-template-columns: repeat(4, 1fr); } }
    .nwm-sigil {
      aspect-ratio: 1;
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.6);
      background: rgba(0,0,0,0.3);
      color: #cfe7ff;
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: calc(var(--hud-unit) * 0.25);
      transition: background 140ms ease, border-color 140ms ease, transform 120ms ease;
    }
    .nwm-sigil:hover { background: rgba(255,255,255,0.06); border-color: var(--hud-border); }
    .nwm-sigil.selected {
      background: rgba(140, 224, 255, 0.14);
      border-color: #8ce0ff;
    }
    .nwm-sigil svg { width: 80%; height: 80%; display: block; }

    /* ─ Manual composer: tabs + thumb grid ─ */
    .nwm-manual-tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: calc(var(--hud-unit) * 0.35) calc(var(--hud-unit) * 0.5);
      background: transparent;
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
      color: var(--hud-text-dim);
      cursor: pointer;
      text-align: left;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    .nwm-manual-tab:hover { background: rgba(255,255,255,0.05); color: var(--hud-text); }
    .nwm-manual-tab.active {
      background: rgba(140, 224, 255, 0.12);
      border-color: #8ce0ff;
      color: var(--hud-text);
    }
    .nwm-manual-tab-label {
      font-size: calc(var(--hud-unit) * 0.72);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .nwm-manual-tab.active .nwm-manual-tab-label { color: #8ce0ff; }
    .nwm-manual-tab-current {
      font-size: calc(var(--hud-unit) * 0.85);
      color: var(--hud-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nwm-manual-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(calc(var(--hud-unit) * 5), 1fr));
      gap: calc(var(--hud-unit) * 0.35);
      max-height: calc(var(--hud-unit) * 18);
      overflow-y: auto;
      padding: calc(var(--hud-unit) * 0.1);
    }
    .nwm-manual-grid::-webkit-scrollbar { width: 6px; }
    .nwm-manual-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }

    .nwm-manual-thumb {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.2);
      padding: calc(var(--hud-unit) * 0.25);
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
      color: #cfe7ff;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
    }
    .nwm-manual-thumb:hover { background: rgba(255,255,255,0.06); border-color: var(--hud-border); }
    .nwm-manual-thumb.selected {
      background: rgba(140, 224, 255, 0.14);
      border-color: #8ce0ff;
    }
    .nwm-manual-thumb svg {
      width: 100%;
      aspect-ratio: 1;
      height: auto;
      display: block;
    }
    .nwm-manual-thumb-cap {
      font-size: calc(var(--hud-unit) * 0.6);
      letter-spacing: 0.05em;
      color: var(--hud-text-dim);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      width: 100%;
    }
    .nwm-manual-thumb.selected .nwm-manual-thumb-cap { color: var(--hud-text); }

    /* ─ Empire preview disc ─ */
    .nwm-empire-preview {
      display: flex;
      align-items: center;
      gap: calc(var(--hud-unit) * 0.7);
      padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 0.7);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.7);
      background: rgba(0,0,0,0.2);
    }
    .nwm-empire-disc {
      width: calc(var(--hud-unit) * 3);
      height: calc(var(--hud-unit) * 3);
      border-radius: 50%;
      border: 1px solid var(--hud-line);
      display: grid;
      place-items: center;
      flex-shrink: 0;
      color: #fff;
      background: radial-gradient(circle at 35% 35%, rgba(255,255,255,0.12), rgba(0,0,0,0.45));
    }
    .nwm-empire-disc svg { width: 70%; height: 70%; display: block; }
    .nwm-empire-preview-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nwm-empire-preview-name {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.05);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text);
    }
    .nwm-empire-preview-sub {
      font-size: calc(var(--hud-unit) * 0.75);
      color: var(--hud-text-dim);
      letter-spacing: 0.05em;
    }

    /* ─ Sliders (personalidade) ─ */
    .nwm-sliders {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.55);
    }
    .nwm-slider-row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: calc(var(--hud-unit) * 0.5);
      align-items: center;
    }
    .nwm-slider-label {
      min-width: calc(var(--hud-unit) * 5);
      font-size: calc(var(--hud-unit) * 0.8);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .nwm-slider-value {
      font-variant-numeric: tabular-nums;
      font-size: calc(var(--hud-unit) * 0.85);
      color: var(--hud-text);
      min-width: calc(var(--hud-unit) * 1.8);
      text-align: right;
    }
    .nwm-slider {
      appearance: none;
      -webkit-appearance: none;
      width: 100%;
      height: calc(var(--hud-unit) * 0.35);
      background: rgba(255,255,255,0.08);
      border-radius: 4px;
      outline: none;
    }
    .nwm-slider::-webkit-slider-thumb {
      appearance: none;
      width: calc(var(--hud-unit) * 0.9);
      height: calc(var(--hud-unit) * 0.9);
      border-radius: 50%;
      background: #8ce0ff;
      cursor: pointer;
      border: none;
    }
    .nwm-slider::-moz-range-thumb {
      width: calc(var(--hud-unit) * 0.9);
      height: calc(var(--hud-unit) * 0.9);
      border-radius: 50%;
      background: #8ce0ff;
      cursor: pointer;
      border: none;
    }
    .nwm-slider-hint {
      font-size: calc(var(--hud-unit) * 0.7);
      color: var(--hud-text-dim);
      margin-left: calc(var(--hud-unit) * 5.5);
      margin-top: calc(var(--hud-unit) * -0.4);
    }

    /* ─ Personality quick-start presets ─
       Card grid with per-preset color accent bars that color-code the
       strategic flavour at a glance (peaceful builders are cool/green,
       conquerors hot, balanced neutral). Selected state raises the
       card a pixel, thickens the accent and brightens text. */
    .nwm-preset-grid {
      display: grid;
      /* Force exactly 5 columns so FORTALEZA doesn't get orphaned on a
         second row when the modal is narrower than auto-fit expected.
         minmax(0, 1fr) lets each column shrink below its content size
         (combined with overflow-hidden + word-break on the card
         itself) instead of flipping back to a wrapped layout. On very
         narrow viewports the text wraps inside each cell. */
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: calc(var(--hud-unit) * 0.5);
      width: 100%;
    }
    /* Below ~460px the five columns get too squished to read — drop
       to 3 then 2. Using a grid-breakpoint @media is cleaner than
       auto-fit because it stays deterministic. */
    @media (max-width: 560px) {
      .nwm-preset-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 380px) {
      .nwm-preset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    /* Accent colour routed by data-attribute so the JS side doesn't
       have to re-set an inline custom property on every render —
       lets a purely-CSS state survive HMR / bundle staleness bugs. */
    .nwm-preset[data-preset="balanceado"]   { --preset-accent: #cfe3ff; }
    .nwm-preset[data-preset="conquistador"] { --preset-accent: #ff5566; }
    .nwm-preset[data-preset="mercador"]     { --preset-accent: #8ee0b0; }
    .nwm-preset[data-preset="erudito"]      { --preset-accent: #8ce0ff; }
    .nwm-preset[data-preset="fortaleza"]    { --preset-accent: #ffcc66; }
    .nwm-preset {
      position: relative;
      box-sizing: border-box;
      min-width: 0;
      text-align: left;
      padding: calc(var(--hud-unit) * 0.75) calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 0.6);
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--hud-border);
      border-radius: calc(var(--hud-radius) * 0.6);
      color: var(--hud-text);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.25);
      transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
      font-family: inherit;
      overflow: hidden;
    }
    .nwm-preset::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: var(--preset-accent, var(--hud-text-dim));
      border-top-left-radius: calc(var(--hud-radius) * 0.6);
      border-top-right-radius: calc(var(--hud-radius) * 0.6);
      opacity: 0.55;
      transition: opacity 140ms ease, height 140ms ease;
    }
    .nwm-preset:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.3);
    }
    .nwm-preset:hover::before { opacity: 1; height: 3px; }
    .nwm-preset:active { transform: translateY(1px); }
    .nwm-preset.selected {
      background: rgba(255, 255, 255, 0.10);
      border-color: #fff;
      transform: translateY(-1px);
    }
    .nwm-preset.selected::before { opacity: 1; height: 3px; }
    .nwm-preset-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 0.72);
      letter-spacing: 0.02em;
      text-transform: uppercase;
      line-height: 1.15;
      /* overflow-wrap: anywhere is the modern (CSS Text 3) way to say
         "break this word if the line doesn't fit, at any character".
         Combined with min-width: 0 on the flex card and hyphens: auto
         for locale-appropriate hyphenation, long labels like
         CONQUISTADOR fit even narrow cards without overflowing. */
      overflow-wrap: anywhere;
      word-break: break-word;
      hyphens: auto;
      max-width: 100%;
    }
    .nwm-preset-desc {
      font-size: calc(var(--hud-unit) * 0.68);
      color: var(--hud-text-dim);
      line-height: 1.35;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .nwm-preset.selected .nwm-preset-desc { color: var(--hud-text); }

    /* ─ Axis sliders (spectrum ends labeled) ─ */
    .nwm-axis-list {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.6);
    }
    .nwm-axis-row {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.2);
    }
    .nwm-axis-label-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--hud-unit) * 0.5);
    }
    .nwm-axis-name {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.82);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text);
    }
    .nwm-axis-ends {
      display: flex;
      gap: calc(var(--hud-unit) * 0.3);
      align-items: baseline;
      font-size: calc(var(--hud-unit) * 0.72);
      color: var(--hud-text-dim);
    }
    .nwm-axis-end-sep { opacity: 0.5; }
    .nwm-axis-hint {
      font-size: calc(var(--hud-unit) * 0.7);
      color: var(--hud-text-dim);
    }

    /* ─ Objetivo cards ─ */
    .nwm-objetivo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(calc(var(--hud-unit) * 10), 1fr));
      gap: calc(var(--hud-unit) * 0.45);
    }
    .nwm-objetivo {
      text-align: left;
      padding: calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 0.7);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.6);
      background: rgba(0,0,0,0.25);
      color: var(--hud-text);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.2);
      transition: background 120ms ease, border-color 120ms ease;
      font-family: inherit;
    }
    .nwm-objetivo:hover { background: rgba(255,255,255,0.06); }
    .nwm-objetivo.selected {
      background: rgba(140, 224, 255, 0.12);
      border-color: #8ce0ff;
    }
    .nwm-objetivo-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 0.95);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .nwm-objetivo-desc {
      font-size: calc(var(--hud-unit) * 0.8);
      color: var(--hud-text-dim);
      line-height: 1.4;
    }

    /* ─ Lore preview ─ */
    .nwm-lore {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.5);
    }
    .nwm-lore-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: calc(var(--hud-unit) * 0.5);
    }
    .nwm-lore-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.2);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin: 0;
    }
    .nwm-lore-sub {
      font-size: calc(var(--hud-unit) * 0.85);
      color: var(--hud-text-dim);
      font-style: italic;
    }
    .nwm-lore-secao {
      padding: calc(var(--hud-unit) * 0.5) 0;
      border-top: 1px solid var(--hud-line);
    }
    .nwm-lore-secao h4 {
      margin: 0 0 calc(var(--hud-unit) * 0.25);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.8);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .nwm-lore-secao p {
      margin: 0 0 calc(var(--hud-unit) * 0.3);
      font-size: calc(var(--hud-unit) * 0.88);
      line-height: 1.5;
    }
    .nwm-lore-citacao {
      font-style: italic;
      color: var(--hud-text-dim);
      border-left: 2px solid var(--hud-line);
      padding-left: calc(var(--hud-unit) * 0.5);
      margin-top: calc(var(--hud-unit) * 0.3);
      font-size: calc(var(--hud-unit) * 0.82);
    }
    .nwm-lore-perfil {
      display: flex;
      flex-wrap: wrap;
      gap: calc(var(--hud-unit) * 0.3);
    }
    .nwm-lore-badge {
      padding: calc(var(--hud-unit) * 0.2) calc(var(--hud-unit) * 0.55);
      font-size: calc(var(--hud-unit) * 0.7);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--hud-line);
      border-radius: 999px;
      color: var(--hud-text-dim);
    }
    .nwm-loading {
      color: var(--hud-text-dim);
      font-style: italic;
      text-align: center;
      padding: calc(var(--hud-unit) * 1);
    }

    /* ─ Footer ─ */
    .nwm-footer {
      display: flex;
      gap: calc(var(--hud-unit) * 0.5);
      padding-top: calc(var(--hud-unit) * 0.6);
      border-top: 1px solid var(--hud-line);
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
    .nwm-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); letter-spacing: 0.18em; }
    .nwm-btn:active:not(:disabled) { transform: translateY(1px); }
    .nwm-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .nwm-btn.primary { background: rgba(255,255,255,0.12); border-color: #fff; }
    .nwm-btn.ghost { background: transparent; }
    .nwm-btn.inline-sm {
      flex: 0 0 auto;
      height: calc(var(--hud-unit) * 1.6);
      font-size: calc(var(--hud-unit) * 0.75);
      padding: 0 calc(var(--hud-unit) * 0.8);
    }
  `;
  document.head.appendChild(style);
}

// ─── Steps ───────────────────────────────────────────────────────────

const DIFICULDADES: ReadonlyArray<[Dificuldade, string]> = [
  ['pacifico', 'pacifico'],
  ['facil',    'facil'],
  ['normal',   'normal'],
  ['dificil',  'dificil'],
  ['brutal',   'brutal'],
  ['infernal', 'infernal'],
];

const OBJETIVOS: ReadonlyArray<{ id: ObjetivoImperio; titulo: string; desc: string }> = [
  { id: 'conquista',     titulo: 'Conquista Total',   desc: 'Eliminar todos os outros impérios.' },
  { id: 'economia',      titulo: 'Domínio Econômico', desc: 'Acumular recursos e dominar o comércio.' },
  { id: 'ciencia',       titulo: 'Supremacia Científica', desc: 'Completar todas as linhas de pesquisa.' },
  { id: 'sobrevivencia', titulo: 'Sobrevivência',     desc: 'Resistir aos inimigos pelo maior tempo possível.' },
  { id: 'exploracao',    titulo: 'Exploração',        desc: 'Descobrir todos os sistemas da galáxia.' },
  { id: 'livre',         titulo: 'Livre',             desc: 'Sem condição de vitória; jogue como quiser.' },
];

function mountStepMundo(body: HTMLDivElement, state: WizardState, onChange: () => void): void {
  const labelNome = document.createElement('div');
  labelNome.className = 'nwm-label';
  labelNome.textContent = t('novo_mundo.nome_label');
  body.appendChild(labelNome);

  const input = document.createElement('input');
  input.className = 'nwm-input';
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = t('novo_mundo.placeholder');
  input.value = state.nomeMundo;
  input.addEventListener('input', () => {
    state.nomeMundo = input.value;
    state.erroMundo = '';
    erro.textContent = '';
    onChange();
  });
  body.appendChild(input);

  const erro = document.createElement('div');
  erro.className = 'nwm-error';
  erro.textContent = state.erroMundo;
  body.appendChild(erro);

  const labelDif = document.createElement('div');
  labelDif.className = 'nwm-label';
  labelDif.textContent = t('novo_mundo.dificuldade_label');
  body.appendChild(labelDif);

  const selectDif = document.createElement('select');
  selectDif.className = 'nwm-input';
  for (const [val, key] of DIFICULDADES) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = t(`dificuldade.${key}`);
    if (val === state.dificuldade) opt.selected = true;
    selectDif.appendChild(opt);
  }
  selectDif.addEventListener('change', () => {
    state.dificuldade = selectDif.value as Dificuldade;
    hint.textContent = t(`dificuldade.hint_${state.dificuldade}`);
    onChange();
  });
  body.appendChild(selectDif);

  const hint = document.createElement('div');
  hint.className = 'nwm-hint';
  hint.textContent = t(`dificuldade.hint_${state.dificuldade}`);
  body.appendChild(hint);

  setTimeout(() => input.focus(), 0);
}

function mountStepImperio(body: HTMLDivElement, state: WizardState, onChange: () => void): void {
  const preview = buildEmpirePreview(state);
  body.appendChild(preview);

  const labelNome = document.createElement('div');
  labelNome.className = 'nwm-label';
  labelNome.textContent = 'Nome do império';
  body.appendChild(labelNome);

  const input = document.createElement('input');
  input.className = 'nwm-input';
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = 'Ex: Ordem Solar';
  input.value = state.imperio.nome;
  input.addEventListener('input', () => {
    state.imperio.nome = input.value;
    onChange();
  });
  body.appendChild(input);

  // Logo section header with mode toggle
  const labelRow = document.createElement('div');
  labelRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: calc(var(--hud-unit) * 0.4); margin-top: calc(var(--hud-unit) * 0.3); flex-wrap: wrap;';
  const labelLogo = document.createElement('div');
  labelLogo.className = 'nwm-label';
  labelLogo.style.margin = '0';
  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display: flex; gap: calc(var(--hud-unit) * 0.3);';
  const regenBtn = document.createElement('button');
  regenBtn.type = 'button';
  regenBtn.className = 'nwm-btn ghost inline-sm';
  regenBtn.textContent = 'Regerar';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'nwm-btn ghost inline-sm';
  actionsRow.append(regenBtn, toggleBtn);
  labelRow.append(labelLogo, actionsRow);
  body.appendChild(labelRow);

  // One container each; only the active mode's is visible.
  const procContainer = document.createElement('div');
  procContainer.className = 'nwm-sigil-grid';
  body.appendChild(procContainer);

  const manualContainer = document.createElement('div');
  manualContainer.style.cssText = 'display: flex; flex-direction: column; gap: calc(var(--hud-unit) * 0.4);';
  body.appendChild(manualContainer);

  if (state.sigiloGalleryBase === 0) state.sigiloGalleryBase = novaSeed();

  // ── Procedural gallery ─────────────────────────────────────────────
  function refreshGallery(): void {
    procContainer.replaceChildren();
    const seeds = seedVariacoes(state.sigiloGalleryBase, 8);
    for (const seed of seeds) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const selected = !state.imperio.logo.manual && state.imperio.logo.seed === seed;
      btn.className = `nwm-sigil${selected ? ' selected' : ''}`;
      btn.appendChild(gerarSigilo(seed));
      btn.addEventListener('click', () => {
        state.imperio.logo.seed = seed;
        // Choosing a gallery slot auto-exits manual mode.
        delete state.imperio.logo.manual;
        refreshGallery();
        refreshEmpirePreview(preview, state);
        onChange();
      });
      procContainer.appendChild(btn);
    }
  }

  // If the current seed isn't in the first variation page, start there
  const inCurrentPage = seedVariacoes(state.sigiloGalleryBase, 8).includes(state.imperio.logo.seed);
  if (!inCurrentPage) state.sigiloGalleryBase = state.imperio.logo.seed;

  regenBtn.addEventListener('click', () => {
    state.sigiloGalleryBase = novaSeed();
    state.imperio.logo.seed = state.sigiloGalleryBase;
    delete state.imperio.logo.manual;
    refreshGallery();
    refreshEmpirePreview(preview, state);
    onChange();
  });

  // ── Manual composer (visual, tabbed) ──────────────────────────────
  type ManualTab = 'frame' | 'motif' | 'ornament';
  let currentTab: ManualTab = 'frame';

  function refreshManual(): void {
    manualContainer.replaceChildren();
    if (!state.imperio.logo.manual) return;
    const manual = state.imperio.logo.manual;

    // Tab strip
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display: flex; gap: calc(var(--hud-unit) * 0.25); border-bottom: 1px solid var(--hud-line); padding-bottom: calc(var(--hud-unit) * 0.3);';
    const tabDefs: Array<[ManualTab, string, string]> = [
      ['frame', 'Moldura', FRAME_LABEL[manual.frame]],
      ['motif', 'Símbolo', MOTIF_LABEL[manual.motif]],
      ['ornament', 'Ornamento', ORNAMENT_LABEL[manual.ornament]],
    ];
    for (const [id, label, current] of tabDefs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `nwm-manual-tab${currentTab === id ? ' active' : ''}`;
      const l = document.createElement('div');
      l.className = 'nwm-manual-tab-label';
      l.textContent = label;
      const c = document.createElement('div');
      c.className = 'nwm-manual-tab-current';
      c.textContent = current;
      btn.append(l, c);
      btn.addEventListener('click', () => {
        currentTab = id;
        refreshManual();
      });
      tabs.appendChild(btn);
    }
    manualContainer.appendChild(tabs);

    // Grid of thumbnails for the active tab
    const grid = document.createElement('div');
    grid.className = 'nwm-manual-grid';
    manualContainer.appendChild(grid);

    function mountGrid<T extends string>(
      options: readonly T[],
      labels: Record<T, string>,
      currentValue: T,
      renderPreview: (v: T) => SVGSVGElement,
      onPick: (v: T) => void,
    ): void {
      for (const opt of options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `nwm-manual-thumb${opt === currentValue ? ' selected' : ''}`;
        btn.title = labels[opt];
        btn.appendChild(renderPreview(opt));
        const cap = document.createElement('div');
        cap.className = 'nwm-manual-thumb-cap';
        cap.textContent = labels[opt];
        btn.appendChild(cap);
        btn.addEventListener('click', () => {
          onPick(opt);
          syncManual();
        });
        grid.appendChild(btn);
      }
    }

    if (currentTab === 'frame') {
      mountGrid<Frame>(FRAMES, FRAME_LABEL, manual.frame, renderFramePreview, (v) => { manual.frame = v; });
    } else if (currentTab === 'motif') {
      mountGrid<MotifKind>(MOTIFS, MOTIF_LABEL, manual.motif, renderMotifPreview, (v) => { manual.motif = v; });
    } else {
      mountGrid<Ornament>(ORNAMENTS, ORNAMENT_LABEL, manual.ornament, renderOrnamentPreview, (v) => { manual.ornament = v; });
    }
  }

  function syncManual(): void {
    refreshEmpirePreview(preview, state);
    refreshGallery();
    refreshManual();
    onChange();
  }

  // ── Mode toggle ────────────────────────────────────────────────────
  function refreshMode(): void {
    const manual = !!state.imperio.logo.manual;
    labelLogo.textContent = manual ? 'Sigilo (manual)' : 'Sigilo (procedural)';
    procContainer.style.display = manual ? 'none' : '';
    manualContainer.style.display = manual ? 'flex' : 'none';
    regenBtn.style.display = manual ? 'none' : '';
    toggleBtn.textContent = manual ? 'Voltar pra galeria' : 'Faça sua logo';
  }

  toggleBtn.addEventListener('click', () => {
    if (state.imperio.logo.manual) {
      delete state.imperio.logo.manual;
    } else {
      // Seed a manual composition with sensible defaults.
      state.imperio.logo.manual = {
        frame: 'circulo',
        motif: 'estrela-6',
        ornament: 'nenhum',
        strokeWidth: 2.0,
      };
    }
    refreshMode();
    refreshManual();
    refreshGallery();
    refreshEmpirePreview(preview, state);
    onChange();
  });

  refreshGallery();
  refreshManual();
  refreshMode();

  setTimeout(() => input.focus(), 0);
}

const AXIS_METADATA: ReadonlyArray<{
  key: keyof EixosPersonalidade;
  label: string;
  low: string;
  high: string;
  hint: string;
}> = [
  { key: 'postura', label: 'Postura', low: 'Defensivo',  high: 'Agressivo',   hint: 'Quão cedo o império ataca — e quanto resiste.' },
  { key: 'foco',    label: 'Foco',    low: 'Econômico',  high: 'Científico',  hint: 'Prioriza produção de recursos ou avanços de pesquisa.' },
  { key: 'ritmo',   label: 'Ritmo',   low: 'Contido',    high: 'Expansivo',   hint: 'Velocidade com que coloniza novos mundos.' },
];

function applyEixos(state: WizardState, eixos: EixosPersonalidade): void {
  state.imperio.pesos = pesosDeEixos(eixos);
  state.imperio.bonus = derivarBonus(state.imperio.pesos);
  state.loreCache = null;
}

function mountStepPersonalidade(body: HTMLDivElement, state: WizardState, onChange: () => void): void {
  const preview = buildEmpirePreview(state);
  body.appendChild(preview);

  const intro = document.createElement('div');
  intro.className = 'nwm-hint';
  intro.textContent = 'Escolha um preset rápido ou ajuste os 3 eixos abaixo. Nada aqui é irreversível.';
  body.appendChild(intro);

  const presetsLabel = document.createElement('div');
  presetsLabel.className = 'nwm-label';
  presetsLabel.textContent = 'Preset rápido';
  body.appendChild(presetsLabel);

  const presets = document.createElement('div');
  presets.className = 'nwm-preset-grid';
  body.appendChild(presets);

  const axisLabel = document.createElement('div');
  axisLabel.className = 'nwm-label';
  axisLabel.style.marginTop = 'calc(var(--hud-unit) * 0.3)';
  axisLabel.textContent = 'Ajuste por eixo';
  body.appendChild(axisLabel);

  const axisWrap = document.createElement('div');
  axisWrap.className = 'nwm-axis-list';
  body.appendChild(axisWrap);

  const currentEixos: EixosPersonalidade = eixosDePesos(state.imperio.pesos);
  const axisSliders = new Map<keyof EixosPersonalidade, HTMLInputElement>();

  // Per-preset accent colors. Map known preset ids to a semantic
  // ramp — cool for builders, warm for conquerors, white for neutral.
  // Unknown ids fall back to a dim default so new presets still render.
  const PRESET_ACCENTS: Record<string, string> = {
    balanceado:   '#cfe3ff',
    conquistador: '#ff5566',
    mercador:     '#8ee0b0',
    erudito:      '#8ce0ff',
    fortaleza:    '#ffcc66',
  };

  function rebuildPresets(): void {
    presets.replaceChildren();
    for (const p of EIXOS_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const match =
        Math.abs(currentEixos.postura - p.eixos.postura) < 0.08 &&
        Math.abs(currentEixos.foco    - p.eixos.foco)    < 0.08 &&
        Math.abs(currentEixos.ritmo   - p.eixos.ritmo)   < 0.08;
      btn.className = `nwm-preset${match ? ' selected' : ''}`;
      btn.dataset.preset = p.id;
      // Kept as a fallback for any preset id not covered by the
      // attribute-selector table above.
      btn.style.setProperty('--preset-accent', PRESET_ACCENTS[p.id] ?? '#cfe3ff');
      const title = document.createElement('div');
      title.className = 'nwm-preset-title';
      title.textContent = p.nome;
      const desc = document.createElement('div');
      desc.className = 'nwm-preset-desc';
      desc.textContent = p.desc;
      btn.append(title, desc);
      btn.addEventListener('click', () => {
        Object.assign(currentEixos, p.eixos);
        applyEixos(state, currentEixos);
        syncAll();
      });
      presets.appendChild(btn);
    }
  }

  function syncAll(): void {
    rebuildPresets();
    for (const meta of AXIS_METADATA) {
      const sl = axisSliders.get(meta.key);
      if (sl) sl.value = String(currentEixos[meta.key]);
    }
    onChange();
  }

  for (const meta of AXIS_METADATA) {
    const row = document.createElement('div');
    row.className = 'nwm-axis-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'nwm-axis-label-row';
    const nameEl = document.createElement('div');
    nameEl.className = 'nwm-axis-name';
    nameEl.textContent = meta.label;
    const endsEl = document.createElement('div');
    endsEl.className = 'nwm-axis-ends';
    const low = document.createElement('span');
    low.className = 'nwm-axis-end';
    low.textContent = meta.low;
    const mid = document.createElement('span');
    mid.className = 'nwm-axis-end-sep';
    mid.textContent = '↔';
    const high = document.createElement('span');
    high.className = 'nwm-axis-end';
    high.textContent = meta.high;
    endsEl.append(low, mid, high);
    labelRow.append(nameEl, endsEl);
    row.appendChild(labelRow);

    const slider = document.createElement('input');
    slider.className = 'nwm-slider';
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = String(currentEixos[meta.key]);
    slider.addEventListener('input', () => {
      currentEixos[meta.key] = parseFloat(slider.value);
      applyEixos(state, currentEixos);
      rebuildPresets();
      onChange();
    });
    row.appendChild(slider);
    axisSliders.set(meta.key, slider);

    const hint = document.createElement('div');
    hint.className = 'nwm-axis-hint';
    hint.textContent = meta.hint;
    row.appendChild(hint);

    axisWrap.appendChild(row);
  }

  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'nwm-btn ghost inline-sm';
  randomBtn.style.alignSelf = 'flex-end';
  randomBtn.textContent = 'Aleatorizar';
  randomBtn.addEventListener('click', () => {
    currentEixos.postura = Math.random();
    currentEixos.foco = Math.random();
    currentEixos.ritmo = Math.random();
    applyEixos(state, currentEixos);
    syncAll();
  });
  body.appendChild(randomBtn);

  rebuildPresets();
}

function mountStepObjetivo(body: HTMLDivElement, state: WizardState, onChange: () => void): void {
  const intro = document.createElement('div');
  intro.className = 'nwm-hint';
  intro.textContent = 'Escolha o rumo do seu império. Por enquanto só entra na lore — condições de vitória vêm depois.';
  body.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'nwm-objetivo-grid';
  for (const obj of OBJETIVOS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `nwm-objetivo${state.imperio.objetivo === obj.id ? ' selected' : ''}`;
    const title = document.createElement('div');
    title.className = 'nwm-objetivo-title';
    title.textContent = obj.titulo;
    const desc = document.createElement('div');
    desc.className = 'nwm-objetivo-desc';
    desc.textContent = obj.desc;
    card.append(title, desc);
    card.addEventListener('click', () => {
      state.imperio.objetivo = obj.id;
      for (const c of Array.from(grid.children)) c.classList.remove('selected');
      card.classList.add('selected');
      onChange();
    });
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function mountStepLore(body: HTMLDivElement, state: WizardState, onChange: () => void): void {
  const preview = buildEmpirePreview(state);
  body.appendChild(preview);

  const head = document.createElement('div');
  head.className = 'nwm-lore-head';
  const title = document.createElement('h3');
  title.className = 'nwm-lore-title';
  const sub = document.createElement('div');
  sub.className = 'nwm-lore-sub';
  const regenBtn = document.createElement('button');
  regenBtn.type = 'button';
  regenBtn.className = 'nwm-btn ghost inline-sm';
  regenBtn.textContent = 'Regerar';
  regenBtn.addEventListener('click', () => {
    state.loreSeed = Math.floor(Math.random() * 2147483647);
    state.loreCache = null;
    body.replaceChildren();
    mountStepLore(body, state, onChange);
    onChange();
  });
  head.append(title, regenBtn);
  body.appendChild(head);
  body.appendChild(sub);

  const perfil = document.createElement('div');
  perfil.className = 'nwm-lore-perfil';
  body.appendChild(perfil);

  const secoesWrap = document.createElement('div');
  body.appendChild(secoesWrap);

  const proverbios = document.createElement('div');
  body.appendChild(proverbios);

  // Generate (cached across re-entries unless personality or seed changed).
  if (!state.loreCache) {
    state.loreCache = gerarLoreDoJogador(state.imperio, state.loreSeed);
    state.imperio.lore = state.loreCache;
  }
  const lore = state.loreCache;

  title.textContent = lore.titulo;
  sub.textContent = lore.subtitulo;

  for (const [k, v] of Object.entries(lore.perfil)) {
    const b = document.createElement('span');
    b.className = 'nwm-lore-badge';
    b.textContent = `${k}: ${v}`;
    perfil.appendChild(b);
  }

  for (const secao of lore.secoes) {
    const sec = document.createElement('div');
    sec.className = 'nwm-lore-secao';
    const h = document.createElement('h4');
    h.textContent = secao.titulo;
    sec.appendChild(h);
    for (const par of secao.paragrafos) {
      const p = document.createElement('p');
      p.textContent = par;
      sec.appendChild(p);
    }
    if (secao.citacao) {
      const c = document.createElement('div');
      c.className = 'nwm-lore-citacao';
      c.textContent = `"${secao.citacao}"`;
      sec.appendChild(c);
    }
    secoesWrap.appendChild(sec);
  }

  if (lore.proverbios.length) {
    const sec = document.createElement('div');
    sec.className = 'nwm-lore-secao';
    const h = document.createElement('h4');
    h.textContent = 'Provérbios';
    sec.appendChild(h);
    for (const pv of lore.proverbios) {
      const c = document.createElement('div');
      c.className = 'nwm-lore-citacao';
      c.textContent = `"${pv}"`;
      sec.appendChild(c);
    }
    proverbios.appendChild(sec);
  }
}

// ─── Empire preview ─────────────────────────────────────────────────

function buildEmpirePreview(state: WizardState): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'nwm-empire-preview';

  const disc = document.createElement('div');
  disc.className = 'nwm-empire-disc';
  disc.appendChild(renderSigilCurrent(state));
  box.appendChild(disc);

  const text = document.createElement('div');
  text.className = 'nwm-empire-preview-text';
  const name = document.createElement('div');
  name.className = 'nwm-empire-preview-name';
  name.textContent = state.imperio.nome || 'Império sem nome';
  const sub = document.createElement('div');
  sub.className = 'nwm-empire-preview-sub';
  sub.textContent = `Mundo: ${state.nomeMundo || '—'} · Dif.: ${t(`dificuldade.${state.dificuldade}`)}`;
  text.append(name, sub);
  box.appendChild(text);

  box.dataset.preview = 'empire';
  return box;
}

function refreshEmpirePreview(el: HTMLDivElement, state: WizardState): void {
  const disc = el.querySelector<HTMLDivElement>('.nwm-empire-disc');
  if (disc) {
    disc.replaceChildren(renderSigilCurrent(state));
  }
  const name = el.querySelector<HTMLDivElement>('.nwm-empire-preview-name');
  if (name) name.textContent = state.imperio.nome || 'Império sem nome';
  const sub = el.querySelector<HTMLDivElement>('.nwm-empire-preview-sub');
  if (sub) sub.textContent = `Mundo: ${state.nomeMundo || '—'} · Dif.: ${t(`dificuldade.${state.dificuldade}`)}`;
}

/** Render the currently-selected sigil (manual takes priority). */
function renderSigilCurrent(state: WizardState): SVGSVGElement {
  return state.imperio.logo.manual
    ? gerarSigiloManual(state.imperio.logo.manual)
    : gerarSigilo(state.imperio.logo.seed);
}


// ─── Validation & step dispatch ─────────────────────────────────────

function validarStep(state: WizardState): string | null {
  const stepId = STEP_ORDER[state.stepIdx];
  if (stepId === 'mundo') {
    const trimmed = state.nomeMundo.trim();
    if (trimmed.length < 1) return t('novo_mundo.erro_vazio');
    if (trimmed.length > 40) return t('novo_mundo.erro_longo');
    const backend = getBackendAtivo();
    const existe = backend.existe(trimmed);
    if (!(existe instanceof Promise) && existe) return t('novo_mundo.erro_duplicado');
  }
  if (stepId === 'imperio') {
    const trimmed = state.imperio.nome.trim();
    if (trimmed.length < 1) return 'Nome do império é obrigatório';
    if (trimmed.length > 40) return 'Máximo 40 caracteres';
  }
  return null;
}

function mountStep(body: HTMLDivElement, state: WizardState, onChange: () => void): void {
  body.replaceChildren();
  const id = STEP_ORDER[state.stepIdx];
  switch (id) {
    case 'mundo':         return mountStepMundo(body, state, onChange);
    case 'imperio':       return mountStepImperio(body, state, onChange);
    case 'personalidade': return mountStepPersonalidade(body, state, onChange);
    case 'objetivo':      return mountStepObjetivo(body, state, onChange);
    case 'lore':          return mountStepLore(body, state, onChange);
  }
}

// ─── Public entry ───────────────────────────────────────────────────

export function abrirNewWorldModal(opts: OpenOpts): void {
  injectStyles();
  fechar();

  const state: WizardState = {
    stepIdx: 0,
    nomeMundo: '',
    dificuldade: 'normal',
    imperio: imperioJogadorDefault(),
    sigiloGalleryBase: 0,
    loreSeed: Math.floor(Math.random() * 2147483647),
    loreCache: null,
    erroMundo: '',
  };

  const container = document.createElement('div');
  container.className = 'new-world-modal';
  container.setAttribute('data-ui', 'true');
  container.style.pointerEvents = 'auto';

  const card = document.createElement('div');
  card.className = 'nwm-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'new-world-title');
  container.appendChild(card);

  const title = document.createElement('h2');
  title.className = 'nwm-title';
  title.id = 'new-world-title';
  title.textContent = t('novo_mundo.titulo');
  card.appendChild(title);

  // Stepper
  const stepper = document.createElement('div');
  stepper.className = 'nwm-stepper';
  card.appendChild(stepper);

  // Body slot
  const body = document.createElement('div');
  body.className = 'nwm-body';
  card.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'nwm-footer';
  const btnCancel = document.createElement('button');
  btnCancel.type = 'button';
  btnCancel.className = 'nwm-btn ghost';
  btnCancel.textContent = t('novo_mundo.cancelar');
  const btnBack = document.createElement('button');
  btnBack.type = 'button';
  btnBack.className = 'nwm-btn';
  btnBack.textContent = 'Voltar';
  const btnNext = document.createElement('button');
  btnNext.type = 'button';
  btnNext.className = 'nwm-btn primary';
  btnNext.textContent = 'Próximo';
  footer.append(btnCancel, btnBack, btnNext);
  card.appendChild(footer);

  const erroGeral = document.createElement('div');
  erroGeral.className = 'nwm-error';
  erroGeral.style.textAlign = 'center';
  card.appendChild(erroGeral);

  function refreshStepper(): void {
    stepper.replaceChildren();
    STEP_ORDER.forEach((id, i) => {
      const pill = document.createElement('div');
      let cls = 'nwm-step-pill';
      if (i === state.stepIdx) cls += ' current';
      else if (i < state.stepIdx) cls += ' done';
      pill.className = cls;
      const n = document.createElement('span');
      n.className = 'nwm-step-n';
      n.textContent = String(i + 1);
      const lab = document.createElement('span');
      lab.textContent = STEP_LABEL[id];
      pill.append(n, lab);
      stepper.appendChild(pill);
    });
  }

  function refreshFooter(): void {
    btnBack.disabled = state.stepIdx === 0;
    const last = state.stepIdx === STEP_ORDER.length - 1;
    btnNext.textContent = last ? 'Começar' : 'Próximo';
  }

  function refreshAll(): void {
    refreshStepper();
    refreshFooter();
  }

  // Wired onChange callback — used by every step's inputs to push
  // state mutations into the live preview without remounting the
  // step. refreshEmpirePreview is a no-op when the current step
  // doesn't render a preview card, so every step can share this.
  function handleStateChange(): void {
    const p = body.querySelector<HTMLDivElement>('[data-preview="empire"]');
    if (p) refreshEmpirePreview(p, state);
  }

  function goToStep(idx: number): void {
    state.stepIdx = Math.max(0, Math.min(STEP_ORDER.length - 1, idx));
    mountStep(body, state, handleStateChange);
    refreshAll();
    body.scrollTop = 0;
  }

  function avancar(): void {
    const err = validarStep(state);
    if (err) {
      erroGeral.textContent = err;
      return;
    }
    erroGeral.textContent = '';
    if (state.stepIdx < STEP_ORDER.length - 1) {
      goToStep(state.stepIdx + 1);
    } else {
      confirmar();
    }
  }

  function voltar(): void {
    erroGeral.textContent = '';
    if (state.stepIdx > 0) goToStep(state.stepIdx - 1);
  }

  function confirmar(): void {
    // Ensure lore is materialized even if the user skipped the preview.
    if (!state.imperio.lore) {
      state.imperio.lore = gerarLoreDoJogador(state.imperio, state.loreSeed);
    }
    state.imperio.bonus = derivarBonus(state.imperio.pesos);
    marcarInteracaoUi();
    fechar();
    // Legacy TipoJogador carrier — keep the shape existing code (save,
    // mundo.ts bonuses) reads. Values come from the empire state.
    const tipoJogador: TipoJogador = {
      nome: state.imperio.nome,
      desc: '',
      cor: COR_JOGADOR_DEFAULT,
      bonus: { ...state.imperio.bonus },
    };
    opts.onConfirm({
      nome: state.nomeMundo.trim(),
      tipoJogador,
      dificuldade: state.dificuldade,
      imperio: state.imperio,
    });
  }

  btnCancel.addEventListener('click', (e) => {
    e.preventDefault();
    marcarInteracaoUi();
    fechar();
    opts.onCancel();
  });
  btnBack.addEventListener('click', (e) => { e.preventDefault(); voltar(); });
  btnNext.addEventListener('click', (e) => { e.preventDefault(); avancar(); });

  // Enter advances (but don't trigger while typing in multiline or select).
  card.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      avancar();
    }
  });

  const onWindowKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.removeEventListener('keydown', onWindowKey, true);
      fechar();
      opts.onCancel();
    }
  };
  window.addEventListener('keydown', onWindowKey, true);

  document.body.appendChild(container);
  _container = container;

  goToStep(0);
}

function fechar(): void {
  if (!_container) return;
  const c = _container;
  _container = null;
  c.classList.add('closing');
  setTimeout(() => c.remove(), 200);
}
