/**
 * In-game modal dedicated to rendering procedural lore as proper HTML.
 *
 * Unlike the generic save-modal, this one understands the structured
 * shape of ImperioLore / PlanetaLore and renders each section with
 * real typographic hierarchy — headings, paragraphs, profile badges,
 * blockquotes — rather than ASCII-decorated plain text.
 *
 * Only one lore modal open at a time.
 */

import { marcarInteracaoUi } from './interacao-ui';
import type { ImperioLore, SecaoLore } from '../world/lore/imperio-lore';
import type { PlanetaLore } from '../world/lore/planeta-lore';

let _backdrop: HTMLDivElement | null = null;
let _modal: HTMLDivElement | null = null;
let _styleInjected = false;
let _closeResolver: (() => void) | null = null;
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .lore-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(3px);
      z-index: 970;
      display: none;
    }
    .lore-modal-backdrop.visible { display: block; }

    .lore-modal {
      position: fixed;
      top: 50%; left: 50%;
      width: clamp(340px, 50vmin, 640px);
      max-height: 86vh;
      box-sizing: border-box;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: var(--hud-shadow);
      backdrop-filter: blur(3px);
      color: var(--hud-text);
      font-family: var(--hud-font-body);
      z-index: 971;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      opacity: 0;
      transform: translate(-50%, calc(-50% + var(--hud-unit) * 0.8)) scale(0.97);
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 200ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 240ms;
    }
    .lore-modal.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
      visibility: visible;
      pointer-events: auto;
      transition:
        opacity 200ms ease-out,
        transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1),
        visibility 0s linear 0s;
    }

    .lore-modal-head {
      padding: calc(var(--hud-unit) * 1.1) calc(var(--hud-unit) * 1.3);
      border-bottom: 1px solid var(--hud-line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: calc(var(--hud-unit) * 0.8);
    }

    .lore-modal-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.15);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      line-height: 1.1;
      margin: 0;
    }

    .lore-modal-close {
      appearance: none;
      background: transparent;
      border: 1px solid var(--hud-border);
      color: var(--hud-text-dim);
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.9);
      width: calc(var(--hud-unit) * 1.8);
      height: calc(var(--hud-unit) * 1.8);
      cursor: pointer;
      border-radius: 50%;
      transition: background 120ms ease, color 120ms ease;
    }
    .lore-modal-close:hover {
      background: rgba(255,255,255,0.08);
      color: var(--hud-text);
    }

    .lore-modal-body {
      padding: calc(var(--hud-unit) * 1) calc(var(--hud-unit) * 1.3);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.9);
    }

    .lore-subtitle {
      margin: 0;
      color: var(--hud-text-dim);
      font-style: italic;
      font-size: calc(var(--hud-unit) * 0.9);
      line-height: 1.45;
    }

    .lore-perfil {
      display: flex;
      flex-wrap: wrap;
      gap: calc(var(--hud-unit) * 0.3);
      margin-top: calc(var(--hud-unit) * 0.4);
    }
    .lore-perfil-pill {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.68);
      letter-spacing: 0.07em;
      text-transform: uppercase;
      padding: calc(var(--hud-unit) * 0.25) calc(var(--hud-unit) * 0.55);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
      color: var(--hud-text-dim);
      background: rgba(255,255,255,0.02);
    }
    .lore-perfil-pill strong {
      color: var(--hud-text);
      font-weight: 500;
      margin-left: calc(var(--hud-unit) * 0.25);
    }
    .lore-perfil-pill[data-intensity="alto"] strong,
    .lore-perfil-pill[data-intensity="alta"] strong,
    .lore-perfil-pill[data-intensity="extrema"] strong,
    .lore-perfil-pill[data-intensity="agressiva"] strong,
    .lore-perfil-pill[data-intensity="erudita"] strong,
    .lore-perfil-pill[data-intensity="prospera"] strong,
    .lore-perfil-pill[data-intensity="inexpugnavel"] strong,
    .lore-perfil-pill[data-intensity="implacavel"] strong {
      color: #ffd27a;
    }
    .lore-perfil-pill[data-intensity="baixa"] strong,
    .lore-perfil-pill[data-intensity="contida"] strong,
    .lore-perfil-pill[data-intensity="austera"] strong,
    .lore-perfil-pill[data-intensity="exposta"] strong,
    .lore-perfil-pill[data-intensity="esquecida"] strong {
      color: #8ec6ff;
    }

    .lore-section { margin: 0; }
    .lore-section-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 0.82);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--hud-text);
      margin: 0 0 calc(var(--hud-unit) * 0.35);
      padding-bottom: calc(var(--hud-unit) * 0.25);
      border-bottom: 1px solid var(--hud-line);
    }
    .lore-section p {
      margin: 0 0 calc(var(--hud-unit) * 0.5);
      line-height: 1.55;
      font-size: calc(var(--hud-unit) * 0.85);
      color: var(--hud-text);
    }
    .lore-section p:last-child { margin-bottom: 0; }
    .lore-section blockquote {
      margin: calc(var(--hud-unit) * 0.4) 0 0;
      padding: calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 0.7);
      border-left: 2px solid var(--hud-line);
      color: var(--hud-text-dim);
      font-style: italic;
      line-height: 1.5;
    }

    .lore-proverbios {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.35);
      margin: 0;
      padding: calc(var(--hud-unit) * 0.6) calc(var(--hud-unit) * 0.8);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.6);
      background: rgba(255,255,255,0.02);
    }
    .lore-proverbios-title {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.7);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
      margin: 0 0 calc(var(--hud-unit) * 0.35);
    }
    .lore-proverbios li {
      list-style: none;
      font-style: italic;
      color: var(--hud-text);
      font-size: calc(var(--hud-unit) * 0.85);
      line-height: 1.45;
    }
    .lore-proverbios li::before { content: '— '; color: var(--hud-text-dim); }

    .lore-planeta-meta {
      display: flex;
      flex-direction: column;
      gap: calc(var(--hud-unit) * 0.35);
      padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 0.8);
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--hud-line);
      border-radius: calc(var(--hud-radius) * 0.5);
    }
    .lore-planeta-meta dt {
      font-family: var(--hud-font);
      font-size: calc(var(--hud-unit) * 0.7);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--hud-text-dim);
    }
    .lore-planeta-meta dd {
      margin: 0 0 calc(var(--hud-unit) * 0.3);
      font-size: calc(var(--hud-unit) * 0.85);
      color: var(--hud-text);
      line-height: 1.45;
    }
  `;
  document.head.appendChild(style);
}

function normalizeIntensity(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function ensureModal(): void {
  if (_modal) return;
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.className = 'lore-modal-backdrop';
  // Only dismiss if the click actually landed on the backdrop itself —
  // bubbled clicks from inside the modal must not close it.
  backdrop.addEventListener('click', (e) => {
    if (e.target !== backdrop) return;
    close();
  });
  _backdrop = backdrop;
  document.body.appendChild(backdrop);

  const modal = document.createElement('div');
  modal.className = 'lore-modal';
  modal.setAttribute('data-ui', 'true');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'lore-modal-title');
  modal.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    marcarInteracaoUi();
  });
  _modal = modal;
  document.body.appendChild(modal);

  _keydownHandler = (e: KeyboardEvent) => {
    if (_closeResolver && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', _keydownHandler);
}

function removeAllChildren(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function buildHeader(titulo: string): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'lore-modal-head';

  const h = document.createElement('h2');
  h.className = 'lore-modal-title';
  h.id = 'lore-modal-title';
  h.textContent = titulo;
  head.appendChild(h);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lore-modal-close';
  btn.setAttribute('aria-label', 'Fechar');
  btn.textContent = '×';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    marcarInteracaoUi();
    close();
  });
  head.appendChild(btn);
  return head;
}

function buildSubtitle(subtitulo: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'lore-subtitle';
  p.textContent = subtitulo;
  return p;
}

function buildPerfilRow(perfil: ImperioLore['perfil']): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'lore-perfil';
  const entries: Array<[string, string]> = [
    ['Agressão', perfil.agressao],
    ['Expansão', perfil.expansao],
    ['Economia', perfil.economia],
    ['Ciência', perfil.ciencia],
    ['Defesa', perfil.defesa],
    ['Vingança', perfil.vinganca],
  ];
  for (const [label, valor] of entries) {
    const pill = document.createElement('span');
    pill.className = 'lore-perfil-pill';
    pill.dataset.intensity = normalizeIntensity(valor);
    const lab = document.createElement('span');
    lab.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = valor;
    pill.appendChild(lab);
    pill.appendChild(strong);
    row.appendChild(pill);
  }
  return row;
}

function buildSection(sec: SecaoLore): HTMLElement {
  const s = document.createElement('section');
  s.className = 'lore-section';
  const h = document.createElement('h3');
  h.className = 'lore-section-title';
  h.textContent = sec.titulo;
  s.appendChild(h);
  for (const para of sec.paragrafos) {
    const p = document.createElement('p');
    p.textContent = para;
    s.appendChild(p);
  }
  if (sec.citacao) {
    const bq = document.createElement('blockquote');
    bq.textContent = `"${sec.citacao}"`;
    s.appendChild(bq);
  }
  return s;
}

function buildProverbios(proverbios: readonly string[]): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'lore-proverbios';
  const t = document.createElement('h4');
  t.className = 'lore-proverbios-title';
  t.textContent = 'Provérbios';
  wrap.appendChild(t);
  const ul = document.createElement('ul');
  ul.style.margin = '0';
  ul.style.padding = '0';
  ul.style.listStyle = 'none';
  for (const c of proverbios) {
    const li = document.createElement('li');
    li.textContent = c.startsWith('"') ? c.slice(1, -1) : c;
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

// ─── Public API ─────────────────────────────────────────────────────

export function abrirImperioLore(lore: ImperioLore): Promise<void> {
  ensureModal();
  if (!_modal || !_backdrop) return Promise.resolve();
  if (_closeResolver) return Promise.resolve();

  removeAllChildren(_modal);

  _modal.appendChild(buildHeader(lore.titulo));

  const body = document.createElement('div');
  body.className = 'lore-modal-body';

  body.appendChild(buildSubtitle(lore.subtitulo));
  body.appendChild(buildPerfilRow(lore.perfil));
  for (const sec of lore.secoes) body.appendChild(buildSection(sec));
  body.appendChild(buildProverbios(lore.proverbios));

  _modal.appendChild(body);

  _backdrop.classList.add('visible');
  _modal.classList.add('visible');

  return new Promise<void>((resolve) => { _closeResolver = resolve; });
}

export function abrirPlanetaLore(lore: PlanetaLore, nome: string, sistemaNome?: string): Promise<void> {
  ensureModal();
  if (!_modal || !_backdrop) return Promise.resolve();
  if (_closeResolver) return Promise.resolve();

  removeAllChildren(_modal);

  _modal.appendChild(buildHeader(nome));

  const body = document.createElement('div');
  body.className = 'lore-modal-body';

  // Subtitle uses the slogan
  body.appendChild(buildSubtitle(lore.slogan));

  // Meta dl: geologia, biomas, sistema
  const meta = document.createElement('dl');
  meta.className = 'lore-planeta-meta';
  if (sistemaNome) {
    const dt = document.createElement('dt');
    dt.textContent = 'Sistema';
    const dd = document.createElement('dd');
    dd.textContent = sistemaNome;
    meta.appendChild(dt); meta.appendChild(dd);
  }
  const dtG = document.createElement('dt'); dtG.textContent = 'Geologia';
  const ddG = document.createElement('dd'); ddG.textContent = lore.geologia;
  meta.appendChild(dtG); meta.appendChild(ddG);
  const dtB = document.createElement('dt'); dtB.textContent = 'Paisagens';
  const ddB = document.createElement('dd'); ddB.textContent = lore.biomas;
  meta.appendChild(dtB); meta.appendChild(ddB);
  body.appendChild(meta);

  // Civilização original
  if (lore.civOriginal) {
    const sec = document.createElement('section');
    sec.className = 'lore-section';
    const h = document.createElement('h3');
    h.className = 'lore-section-title';
    h.textContent = 'Civilização original';
    sec.appendChild(h);
    const p1 = document.createElement('p');
    p1.textContent = `${lore.civOriginal.descricao.charAt(0).toUpperCase()}${lore.civOriginal.descricao.slice(1)}. Há cerca de ${lore.civOriginal.idadeEstimada.toLocaleString('pt-BR')} ciclos, ${lore.civOriginal.destino}.`;
    sec.appendChild(p1);
    body.appendChild(sec);
  }

  // Colonização
  if (lore.colonizacao) {
    const sec = document.createElement('section');
    sec.className = 'lore-section';
    const h = document.createElement('h3');
    h.className = 'lore-section-title';
    h.textContent = 'Colonização';
    sec.appendChild(h);
    const anos = Math.abs(lore.colonizacao.ano);
    const p1 = document.createElement('p');
    p1.textContent = `Há ${anos.toLocaleString('pt-BR')} ciclos, por ${lore.colonizacao.fundador}, ${lore.colonizacao.motivo}.`;
    sec.appendChild(p1);
    body.appendChild(sec);
  }

  // Cultura
  const secCult = document.createElement('section');
  secCult.className = 'lore-section';
  const hC = document.createElement('h3');
  hC.className = 'lore-section-title';
  hC.textContent = 'Cultura e economia';
  secCult.appendChild(hC);
  const pCost = document.createElement('p');
  pCost.textContent = lore.costumes;
  secCult.appendChild(pCost);
  const pRel = document.createElement('p');
  pRel.textContent = lore.religiao;
  secCult.appendChild(pRel);
  const pEco = document.createElement('p');
  pEco.textContent = lore.economia;
  secCult.appendChild(pEco);
  if (lore.profissoesDominantes.length > 0) {
    const pProf = document.createElement('p');
    pProf.textContent = `Profissões dominantes: ${lore.profissoesDominantes.join(', ')}.`;
    secCult.appendChild(pProf);
  }
  body.appendChild(secCult);

  // Tensões
  if (lore.tensao) {
    const sec = document.createElement('section');
    sec.className = 'lore-section';
    const h = document.createElement('h3');
    h.className = 'lore-section-title';
    h.textContent = 'Tensões';
    sec.appendChild(h);
    const p = document.createElement('p');
    p.textContent = lore.tensao;
    sec.appendChild(p);
    body.appendChild(sec);
  }

  _modal.appendChild(body);

  _backdrop.classList.add('visible');
  _modal.classList.add('visible');

  return new Promise<void>((resolve) => { _closeResolver = resolve; });
}

function close(): void {
  _backdrop?.classList.remove('visible');
  _modal?.classList.remove('visible');
  const r = _closeResolver;
  _closeResolver = null;
  if (r) r();
}

export function destruirLoreModal(): void {
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = null;
  }
  _modal?.remove();
  _backdrop?.remove();
  _modal = null;
  _backdrop = null;
  _styleInjected = false;
  if (_closeResolver) {
    const r = _closeResolver;
    _closeResolver = null;
    r();
  }
}
