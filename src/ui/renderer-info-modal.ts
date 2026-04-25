import type { Application } from 'pixi.js';
import { getConfig } from '../core/config';
import { t } from '../core/i18n/t';
import { getWeydraRenderer } from '../weydra-loader';

interface RendererInfo {
  motor: string;
  versao: string;
  gpu: string;
  vendor: string;
  driver?: string;
  maxTextureSize?: number;
  maxVertexAttribs?: number;
  maxUniformVectors?: number;
  extensions?: string[];
  features?: string[];
  limits?: Record<string, unknown>;
  software: boolean;
  bloqueado: boolean;
}

let _container: HTMLDivElement | null = null;
let _styleInjected = false;

function injectStyles(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    @keyframes ri-backdrop-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes ri-card-in {
      from { opacity: 0; transform: translateY(calc(var(--hud-unit) * 0.5)) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .renderer-info-overlay {
      position: fixed; inset: 0; z-index: 700;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      font-family: var(--hud-font); color: var(--hud-text);
      animation: ri-backdrop-in 200ms ease-out forwards;
    }
    .renderer-info-overlay.closing {
      opacity: 0;
      transition: opacity 200ms ease-out;
    }
    .renderer-info-overlay.closing .renderer-info-card {
      transform: translateY(calc(var(--hud-unit) * 0.3)) scale(0.98);
      opacity: 0;
      transition: opacity 150ms ease-out, transform 200ms ease-out;
    }
    .renderer-info-card {
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: var(--hud-radius);
      box-shadow: 0 calc(var(--hud-unit) * 0.4) calc(var(--hud-unit) * 1.2) rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(3px);
      padding: calc(var(--hud-unit) * 1.4);
      min-width: calc(var(--hud-unit) * 28);
      max-width: calc(var(--hud-unit) * 36);
      max-height: 80vh;
      overflow-y: auto;
      animation: ri-card-in 240ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
    }
    .renderer-info-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: calc(var(--hud-unit) * 0.8);
    }
    .renderer-info-title {
      font-family: var(--hud-font-display);
      font-size: calc(var(--hud-unit) * 1.4);
      letter-spacing: 0.12em; text-transform: uppercase;
      margin: 0;
    }
    .renderer-info-close-x {
      background: transparent; border: none;
      color: var(--hud-text); font-size: calc(var(--hud-unit) * 1.2);
      cursor: pointer; padding: 0 calc(var(--hud-unit) * 0.4);
      transition: color 120ms ease;
    }
    .renderer-info-close-x:hover { color: #ff6b6b; }
    .renderer-info-row {
      display: flex; justify-content: space-between; gap: calc(var(--hud-unit) * 1);
      padding: calc(var(--hud-unit) * 0.25) 0;
      font-size: calc(var(--hud-unit) * 0.8);
    }
    .renderer-info-row .label { color: var(--hud-text-dim); letter-spacing: 0.05em; }
    .renderer-info-row .value { color: var(--hud-text); text-align: right; font-family: var(--hud-font); word-break: break-word; }
    .renderer-info-section {
      font-family: var(--hud-font-display); font-size: calc(var(--hud-unit) * 0.75);
      letter-spacing: 0.1em; text-transform: uppercase; color: var(--hud-text-dim);
      margin-top: calc(var(--hud-unit) * 1); padding-top: calc(var(--hud-unit) * 0.4);
      border-top: 1px solid var(--hud-border);
    }
    .renderer-info-banner {
      margin-top: calc(var(--hud-unit) * 1);
      padding: calc(var(--hud-unit) * 0.8);
      border: 1px solid; font-size: calc(var(--hud-unit) * 0.75);
      border-radius: calc(var(--hud-radius) * 0.6);
    }
    .renderer-info-banner.ok { border-color: #5fbd6f; color: #5fbd6f; }
    .renderer-info-banner.warn { border-color: #ff6b6b; color: #ff6b6b; }
    .renderer-info-banner.info { border-color: var(--hud-text-dim); color: var(--hud-text-dim); }
    .renderer-info-ext-toggle {
      background: transparent; border: 1px solid var(--hud-border);
      color: var(--hud-text-dim); cursor: pointer;
      padding: calc(var(--hud-unit) * 0.15) calc(var(--hud-unit) * 0.5);
      margin-left: calc(var(--hud-unit) * 0.4);
      font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.65);
      letter-spacing: 0.05em; transition: color 120ms ease, border-color 120ms ease;
    }
    .renderer-info-ext-toggle:hover { color: var(--hud-text); border-color: var(--hud-text); }
    .renderer-info-ext-list {
      margin-top: calc(var(--hud-unit) * 0.4);
      font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.65);
      max-height: 0; overflow: hidden;
      border: 1px solid var(--hud-border); padding: 0 calc(var(--hud-unit) * 0.4);
      border-radius: calc(var(--hud-radius) * 0.6);
      opacity: 0;
      transition: max-height 250ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 200ms ease, padding 250ms ease;
    }
    .renderer-info-ext-list.show {
      max-height: 200px; overflow-y: auto;
      opacity: 1;
      padding: calc(var(--hud-unit) * 0.4);
    }
    .renderer-info-close {
      display: block; width: 100%;
      margin: calc(var(--hud-unit) * 1.2) auto 0;
      padding: calc(var(--hud-unit) * 0.5) calc(var(--hud-unit) * 1.5);
      background: var(--hud-bg); border: 1px solid var(--hud-border); color: var(--hud-text);
      font-family: var(--hud-font); font-size: calc(var(--hud-unit) * 0.8);
      letter-spacing: 0.1em; text-transform: uppercase;
      cursor: pointer; transition: background 120ms ease, border-color 120ms ease;
    }
    .renderer-info-close:hover { background: rgba(255,255,255,0.08); border-color: var(--hud-text); }
    .renderer-info-close:active { transform: translateY(1px); }
  `;
  document.head.appendChild(s);
}

function extrairDriver(gpuString: string): string | undefined {
  const m = gpuString.match(/ANGLE \(([^)]+)\)/);
  return m?.[1];
}

function coletarInfoWebGL(renderer: any): RendererInfo {
  const gl: WebGLRenderingContext | WebGL2RenderingContext | null = renderer?.gl ?? null;
  if (!gl) {
    return { motor: 'WebGL', versao: 'desconhecido', gpu: 'desconhecido', vendor: 'desconhecido', software: false, bloqueado: true };
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext
    ? ((gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL) as string) || 'desconhecido')
    : 'bloqueado pelo navegador';
  const vendor = ext
    ? ((gl.getParameter((ext as any).UNMASKED_VENDOR_WEBGL) as string) || 'desconhecido')
    : 'bloqueado pelo navegador';
  const versao = (gl.getParameter(gl.VERSION) as string) ?? 'desconhecido';
  const software = ext ? /swiftshader|llvmpipe|software|basic render/i.test(gpu) : false;
  return {
    motor: versao.includes('2.0') ? 'WebGL 2' : 'WebGL 1',
    versao,
    gpu,
    vendor,
    driver: ext ? extrairDriver(gpu) : undefined,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number,
    maxUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number,
    extensions: gl.getSupportedExtensions() ?? [],
    software,
    bloqueado: !ext,
  };
}

function coletarInfoWebGPU(renderer: any): RendererInfo {
  const adapter = (renderer as any)?.adapter ?? null;
  const info = (adapter as any)?.info ?? {};
  const device = info.device || 'desconhecido';
  const vendor = info.vendor || 'desconhecido';
  const architecture = info.architecture || '';
  return {
    motor: 'WebGPU',
    versao: 'WebGPU 1.0',
    gpu: device,
    vendor,
    driver: architecture || undefined,
    features: adapter?.features ? Array.from(adapter.features as Iterable<string>) : [],
    limits: adapter?.limits ? Object.fromEntries(Object.entries(adapter.limits)) : {},
    software: /software|fallback/i.test(architecture),
    bloqueado: !adapter,
  };
}

function coletarInfo(app: Application): RendererInfo {
  const renderer = app.renderer as any;
  const nome = (renderer?.name ?? '').toLowerCase();
  if (nome.includes('webgpu')) {
    return coletarInfoWebGPU(renderer);
  }
  return coletarInfoWebGL(renderer);
}

function row(label: string, value: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'renderer-info-row';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'value';
  v.textContent = value;
  el.append(l, v);
  return el;
}

export function abrirRendererInfoModal(app: Application): void {
  injectStyles();
  if (_container) return;
  const info = coletarInfo(app);

  const overlay = document.createElement('div');
  overlay.className = 'renderer-info-overlay';
  overlay.setAttribute('data-ui', 'true');
  overlay.style.pointerEvents = 'auto';

  const card = document.createElement('div');
  card.className = 'renderer-info-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'renderer-info-title');
  overlay.appendChild(card);

  const header = document.createElement('div');
  header.className = 'renderer-info-header';
  const title = document.createElement('h2');
  title.className = 'renderer-info-title';
  title.id = 'renderer-info-title';
  title.textContent = t('renderer_info.titulo');
  const closeX = document.createElement('button');
  closeX.className = 'renderer-info-close-x';
  closeX.setAttribute('aria-label', 'Fechar');
  closeX.textContent = '✕';
  closeX.addEventListener('click', () => fecharRendererInfoModal());
  header.append(title, closeX);
  card.appendChild(header);

  // ── Engine: which TS-side renderer is the player using? ──────────
  // Skip the `backend` config key — it's a string ('auto'/'webgpu'/...),
  // not a subsystem boolean, but `Boolean('auto')` would still pass the
  // filter and overinflate the count to 6/5.
  const w = getConfig().weydra;
  const enabledSubs = w
    ? Object.entries(w)
        .filter(([k, v]) => k !== 'backend' && v === true)
        .map(([k]) => k)
    : [];
  card.append(
    row(
      t('renderer_info.engine'),
      enabledSubs.length > 0
        ? t('renderer_info.engine_weydra', { n: enabledSubs.length })
        : t('renderer_info.engine_pixi'),
    ),
  );
  if (enabledSubs.length > 0) {
    card.append(row(t('renderer_info.weydra_subs'), enabledSubs.join(', ')));
    const r = getWeydraRenderer();
    const wRow = row(
      t('renderer_info.weydra_adapter'),
      r ? t('renderer_info.weydra_ok') : t('renderer_info.weydra_fail'),
    );
    if (!r) {
      const v = wRow.querySelector('.value') as HTMLElement | null;
      if (v) v.style.color = '#ff6b6b';
    }
    card.appendChild(wRow);
  }

  // ── Config section: what the user selected for Pixi ──
  const cfg = getConfig().graphics;
  const rendererLabels: Record<string, string> = { webgl: 'WebGL', webgpu: 'WebGPU', software: t('renderer_info.renderer_software') };
  const gpuPrefLabels: Record<string, string> = { auto: t('renderer_info.automatico'), 'high-performance': t('renderer_info.gpu_alta'), 'low-power': t('renderer_info.gpu_economia') };
  card.append(row(t('renderer_info.backend_pixi'), rendererLabels[cfg.renderer] ?? cfg.renderer));
  if (cfg.renderer === 'webgl') {
    card.append(row(t('renderer_info.versao_webgl'), cfg.webglVersion === 'auto' ? t('renderer_info.automatico') : t('renderer_info.webgl_forcado', { v: cfg.webglVersion })));
  }
  card.append(row(t('renderer_info.preferencia_gpu'), gpuPrefLabels[cfg.gpuPreference] ?? cfg.gpuPreference));
  card.append(row(t('renderer_info.resolucao'), `${Math.round(window.innerWidth * (cfg.renderer === 'software' ? 1 : window.devicePixelRatio))} × ${Math.round(window.innerHeight * (cfg.renderer === 'software' ? 1 : window.devicePixelRatio))}`));
  card.append(row(t('renderer_info.qualidade'), cfg.qualidadeEfeitos.charAt(0).toUpperCase() + cfg.qualidadeEfeitos.slice(1)));

  // ── Hardware section: what the GPU reports ──
  const hwSec = document.createElement('div');
  hwSec.className = 'renderer-info-section';
  hwSec.textContent = t('renderer_info.hardware_detectado');
  card.appendChild(hwSec);

  card.append(row(t('renderer_info.motor_ativo'), info.motor));
  card.append(row(t('renderer_info.versao'), info.versao));
  card.append(row(t('renderer_info.gpu'), info.gpu));
  card.append(row(t('renderer_info.vendor'), info.vendor));
  if (info.driver) card.append(row(t('renderer_info.driver'), info.driver));

  if (info.maxTextureSize || info.maxVertexAttribs || info.extensions) {
    const sec = document.createElement('div');
    sec.className = 'renderer-info-section';
    sec.textContent = t('renderer_info.capacidades');
    card.appendChild(sec);
    if (info.maxTextureSize) card.append(row(t('renderer_info.tamanho_textura'), String(info.maxTextureSize)));
    if (info.maxVertexAttribs) card.append(row(t('renderer_info.vertex_attribs'), String(info.maxVertexAttribs)));
    if (info.maxUniformVectors) card.append(row(t('renderer_info.uniform_vectors'), String(info.maxUniformVectors)));
    if (info.extensions && info.extensions.length > 0) {
      const extRow = row(t('renderer_info.extensions'), t('renderer_info.extensions_ativas', { n: info.extensions.length }));
      const btn = document.createElement('button');
      btn.className = 'renderer-info-ext-toggle';
      btn.textContent = t('renderer_info.ver');
      extRow.querySelector('.value')?.appendChild(btn);
      card.appendChild(extRow);
      const list = document.createElement('div');
      list.className = 'renderer-info-ext-list';
      list.textContent = info.extensions.join('\n');
      card.appendChild(list);
      btn.addEventListener('click', () => {
        list.classList.toggle('show');
        btn.textContent = list.classList.contains('show') ? t('renderer_info.ocultar') : t('renderer_info.ver');
      });
    }
  }

  if (info.features && info.features.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'renderer-info-section';
    sec.textContent = t('renderer_info.features_webgpu');
    card.appendChild(sec);
    card.append(row(t('renderer_info.count'), String(info.features.length)));
  }

  if (cfg.renderer === 'software') {
    const b = document.createElement('div');
    b.className = 'renderer-info-banner info';
    b.textContent = t('renderer_info.banner_software');
    card.appendChild(b);
  } else if (info.software) {
    const b = document.createElement('div');
    b.className = 'renderer-info-banner warn';
    b.textContent = t('renderer_info.banner_swrender');
    card.appendChild(b);
  } else if (info.bloqueado) {
    const b = document.createElement('div');
    b.className = 'renderer-info-banner info';
    b.textContent = t('renderer_info.banner_bloqueado');
    card.appendChild(b);
  } else {
    const b = document.createElement('div');
    b.className = 'renderer-info-banner ok';
    b.textContent = t('renderer_info.banner_ok');
    card.appendChild(b);
  }

  const close = document.createElement('button');
  close.className = 'renderer-info-close';
  close.textContent = t('renderer_info.fechar');
  close.addEventListener('click', () => fecharRendererInfoModal());
  card.appendChild(close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharRendererInfoModal();
  });
  function onEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape') fecharRendererInfoModal();
  }
  window.addEventListener('keydown', onEsc);
  _escListener = onEsc;

  document.body.appendChild(overlay);
  _container = overlay;
}

let _escListener: ((e: KeyboardEvent) => void) | null = null;

export function fecharRendererInfoModal(): void {
  if (_escListener) {
    window.removeEventListener('keydown', _escListener);
    _escListener = null;
  }
  if (!_container) return;
  const ov = _container;
  _container = null;
  ov.classList.add('closing');
  setTimeout(() => ov.remove(), 250);
}
