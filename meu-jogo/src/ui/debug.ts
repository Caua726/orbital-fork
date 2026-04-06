// @ts-nocheck
import { getEstadoJogo, getPesquisaAtual, obterNaveSelecionada, profiling } from '../world/mundo';
import { getMemoria, fogProfiling } from '../world/nevoa';
import { getCamera } from '../core/player';

const THROTTLE_MS = 150;
const FPS_HISTORY = 120; // ~20s a 6 updates/s
const PROF_HISTORY = 60;

export const cheats = {
  construcaoInstantanea: false,
  recursosInfinitos: false,
  pesquisaInstantanea: false,
  visaoTotal: false,
  velocidadeNave: false,
};

/** Configuracoes ajustaveis em tempo real */
export const config = {
  raioVisaoBase: 900,
  raioVisaoNave: 600,
  raioVisaoBatedora: 1100,
  fogAlpha: 0.75,
  fogThrottle: 3,
};

export function getRendererPreference() {
  return localStorage.getItem('renderer') || 'webgl';
}
export function setRendererPreference(val) {
  localStorage.setItem('renderer', val);
}

// === Historico para graficos ===
const _fpsHist = [];
const _profHist = { logica: [], fundo: [], fog: [], planetas: [], render: [] };

function pushHist(arr, val, max) {
  arr.push(val);
  if (arr.length > max) arr.shift();
}

// === Utilidades DOM ===
function el(tag, css, text) {
  const d = document.createElement(tag);
  if (css) Object.assign(d.style, css);
  if (text) d.textContent = text;
  return d;
}

function secTitle(text) {
  return el('div', {
    color: '#4a90cc', fontSize: '10px', letterSpacing: '1.5px',
    borderBottom: '1px solid rgba(40,70,120,0.5)', paddingBottom: '4px',
    marginBottom: '6px', textTransform: 'uppercase',
  }, text);
}

function dataRow(parent, id, linhas) {
  const row = el('div', {
    display: 'flex', justifyContent: 'space-between', padding: '2px 0',
    fontSize: '11px', borderBottom: '1px solid rgba(20,40,60,0.3)',
  });
  const label = el('span', { color: '#667788' });
  const value = el('span', { color: '#a0d8b0', fontWeight: '500' });
  row.appendChild(label);
  row.appendChild(value);
  parent.appendChild(row);
  linhas[id] = { label, value, row };
}

function criarSlider(parent, label, min, max, step, valor, configKey) {
  const wrap = el('div', { marginBottom: '8px' });
  const header = el('div', {
    display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px',
  });
  header.appendChild(el('span', { color: '#889' }, label));
  const valSpan = el('span', { color: '#60ccff' }, String(valor));
  header.appendChild(valSpan);
  wrap.appendChild(header);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = valor;
  Object.assign(slider.style, {
    width: '100%', accentColor: '#4a90cc', height: '4px', cursor: 'pointer',
  });
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    config[configKey] = v;
    valSpan.textContent = step >= 1 ? String(v) : v.toFixed(2);
  });
  wrap.appendChild(slider);
  parent.appendChild(wrap);
}

function criarCheat(parent, elId, label, cheatKey, hotkey) {
  const lbl = el('label', {
    display: 'flex', alignItems: 'center', padding: '5px 8px',
    cursor: 'pointer', color: '#a0d8b0', fontSize: '11px', gap: '8px',
    borderRadius: '4px', transition: 'background 0.15s',
  });
  lbl.addEventListener('mouseenter', () => { lbl.style.background = 'rgba(40,70,120,0.3)'; });
  lbl.addEventListener('mouseleave', () => { lbl.style.background = 'none'; });

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = elId;
  Object.assign(cb.style, { accentColor: '#60ff90', width: '14px', height: '14px', cursor: 'pointer' });
  cb.addEventListener('change', () => { cheats[cheatKey] = cb.checked; });
  lbl.appendChild(cb);
  lbl.appendChild(el('span', { flex: '1' }, label));
  lbl.appendChild(el('span', { color: '#445', fontSize: '9px', background: '#0a1020', padding: '1px 5px', borderRadius: '3px' }, hotkey));
  parent.appendChild(lbl);
}

// === Canvas para grafico de FPS ===
function criarGraficoCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  Object.assign(canvas.style, { width: '100%', height: `${h}px`, borderRadius: '4px', border: '1px solid #1a3060' });
  return canvas;
}

function desenharGraficoFps(canvas, hist) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#060c18';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = 'rgba(40,70,120,0.3)';
  ctx.lineWidth = 1;
  for (const fps of [15, 30, 60]) {
    const y = h - (fps / 70) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = '#334';
    ctx.font = '9px monospace';
    ctx.fillText(`${fps}`, 2, y - 2);
  }

  if (hist.length < 2) return;

  // FPS line
  ctx.beginPath();
  const step = w / (FPS_HISTORY - 1);
  for (let i = 0; i < hist.length; i++) {
    const x = i * step;
    const y = h - (Math.min(hist[i], 70) / 70) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#60ccff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Fill under line
  ctx.lineTo((hist.length - 1) * step, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(96,204,255,0.08)';
  ctx.fill();
}

function desenharGraficoProf(canvas, hist) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#060c18';
  ctx.fillRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(40,70,120,0.3)';
  ctx.lineWidth = 1;
  for (const ms of [5, 16, 33]) {
    const y = h - (ms / 40) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillStyle = '#334';
    ctx.font = '9px monospace';
    ctx.fillText(`${ms}ms`, 2, y - 2);
  }

  const cores = { logica: '#4488cc', fundo: '#44aa88', fog: '#ff6060', planetas: '#ffcc40', render: '#aa66ff' };
  const step = w / (PROF_HISTORY - 1);

  // Stacked area
  const keys = Object.keys(cores);
  if (hist.logica.length < 2) return;

  for (let k = keys.length - 1; k >= 0; k--) {
    ctx.beginPath();
    for (let i = 0; i < hist[keys[0]].length; i++) {
      let sum = 0;
      for (let j = 0; j <= k; j++) sum += (hist[keys[j]][i] || 0);
      const x = i * step;
      const y = h - (Math.min(sum, 40) / 40) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const lastI = hist[keys[0]].length - 1;
    ctx.lineTo(lastI * step, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = cores[keys[k]] + '40';
    ctx.fill();
  }
}

// === Popup principal ===
const BAR_CORES = { logica: '#4488cc', fundo: '#44aa88', fog: '#ff6060', planetas: '#ffcc40', render: '#aa66ff' };

function criarPopupHTML() {
  const overlay = el('div', {
    display: 'none', position: 'fixed', inset: '0',
    background: 'rgba(2, 4, 10, 0.95)', zIndex: '9999',
    fontFamily: 'monospace', color: '#a0d8b0',
    overflowY: 'auto', backdropFilter: 'blur(4px)',
  });
  overlay.id = 'debug-popup';

  const container = el('div', { maxWidth: '1100px', margin: '0 auto', padding: '20px 30px' });
  overlay.appendChild(container);

  // Header
  const header = el('div', {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '20px', paddingBottom: '12px',
    borderBottom: '2px solid rgba(40,70,120,0.5)',
  });
  const titleWrap = el('div', { display: 'flex', alignItems: 'baseline', gap: '12px' });
  titleWrap.appendChild(el('span', { color: '#60ccff', fontSize: '20px', fontWeight: 'bold', letterSpacing: '2px' }, 'DEBUG CONSOLE'));
  titleWrap.appendChild(el('span', { color: '#334', fontSize: '11px' }, 'v1.0'));
  header.appendChild(titleWrap);

  const closeBtn = el('div', {
    color: '#556', fontSize: '11px', padding: '4px 12px',
    border: '1px solid #1a3060', borderRadius: '4px', cursor: 'pointer',
  }, 'ESC / F3');
  closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Tabs
  const tabBar = el('div', {
    display: 'flex', gap: '2px', marginBottom: '16px',
    borderBottom: '1px solid rgba(40,70,120,0.3)', paddingBottom: '0',
  });
  container.appendChild(tabBar);

  const panels = {};
  const tabs = [
    ['status', 'Status'],
    ['profiling', 'Profiling'],
    ['controls', 'Controles'],
  ];

  let activeTab = 'status';

  for (const [id, label] of tabs) {
    const tab = el('div', {
      padding: '8px 20px', cursor: 'pointer', fontSize: '11px',
      color: '#556', borderBottom: '2px solid transparent',
      transition: 'all 0.15s', letterSpacing: '1px',
    }, label);
    tab.addEventListener('click', () => {
      activeTab = id;
      for (const [tid, tl] of tabs) {
        const te = tabBar.children[tabs.indexOf([tid, tl])];
        if (!te) continue;
        te.style.color = tid === id ? '#60ccff' : '#556';
        te.style.borderBottomColor = tid === id ? '#60ccff' : 'transparent';
      }
      // simpler approach
      for (const t of tabBar.children) {
        t.style.color = '#556';
        t.style.borderBottomColor = 'transparent';
      }
      tab.style.color = '#60ccff';
      tab.style.borderBottomColor = '#60ccff';
      for (const [pid, panel] of Object.entries(panels)) {
        panel.style.display = pid === id ? 'block' : 'none';
      }
    });
    if (id === activeTab) {
      tab.style.color = '#60ccff';
      tab.style.borderBottomColor = '#60ccff';
    }
    tabBar.appendChild(tab);
  }

  const linhas = {};

  // ==================== TAB: STATUS ====================
  const statusPanel = el('div');
  container.appendChild(statusPanel);
  panels.status = statusPanel;

  const statusGrid = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' });
  statusPanel.appendChild(statusGrid);

  // FPS big number
  const fpsCard = el('div', {
    gridColumn: 'span 3', display: 'flex', alignItems: 'center', gap: '20px',
    background: 'rgba(10,20,40,0.5)', borderRadius: '8px', padding: '12px 20px',
    border: '1px solid rgba(40,70,120,0.3)',
  });
  const fpsBig = el('div', { fontSize: '36px', fontWeight: 'bold', color: '#60ff90', minWidth: '80px' }, '60');
  fpsBig.id = 'dbg-fps-big';
  fpsCard.appendChild(fpsBig);
  const fpsRight = el('div', { flex: '1' });
  const fpsSub = el('div', { fontSize: '11px', color: '#667', marginBottom: '4px' });
  fpsSub.id = 'dbg-fps-sub';
  fpsRight.appendChild(fpsSub);
  const fpsCanvas = criarGraficoCanvas(400, 60);
  fpsCanvas.id = 'dbg-fps-graph';
  fpsRight.appendChild(fpsCanvas);
  fpsCard.appendChild(fpsRight);
  statusGrid.appendChild(fpsCard);

  // Col left
  const sCol1 = el('div');
  statusGrid.appendChild(sCol1);
  sCol1.appendChild(secTitle('PERFORMANCE'));
  dataRow(sCol1, 'dbg-camera', linhas);
  dataRow(sCol1, 'dbg-mundo', linhas);
  dataRow(sCol1, 'dbg-renderer', linhas);

  sCol1.appendChild(el('div', { height: '8px' }));
  sCol1.appendChild(secTitle('ENTIDADES'));
  dataRow(sCol1, 'dbg-planetas', linhas);
  dataRow(sCol1, 'dbg-naves', linhas);
  dataRow(sCol1, 'dbg-sistemas', linhas);
  dataRow(sCol1, 'dbg-fontes', linhas);

  // Col mid
  const sCol2 = el('div');
  statusGrid.appendChild(sCol2);
  sCol2.appendChild(secTitle('ECONOMIA'));
  dataRow(sCol2, 'dbg-recursos', linhas);
  dataRow(sCol2, 'dbg-pesquisa', linhas);
  dataRow(sCol2, 'dbg-estado', linhas);

  sCol2.appendChild(el('div', { height: '8px' }));
  sCol2.appendChild(secTitle('SELECAO'));
  dataRow(sCol2, 'dbg-selecao', linhas);
  dataRow(sCol2, 'dbg-construcao', linhas);

  // Col right
  const sCol3 = el('div');
  statusGrid.appendChild(sCol3);
  sCol3.appendChild(secTitle('RENDER'));
  dataRow(sCol3, 'dbg-neblina', linhas);
  dataRow(sCol3, 'dbg-children', linhas);
  dataRow(sCol3, 'dbg-draw-calls', linhas);
  dataRow(sCol3, 'dbg-textures', linhas);

  // ==================== TAB: PROFILING ====================
  const profPanel = el('div', { display: 'none' });
  container.appendChild(profPanel);
  panels.profiling = profPanel;

  const profGrid = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' });
  profPanel.appendChild(profGrid);

  // Left: numbers + bar
  const pLeft = el('div');
  profGrid.appendChild(pLeft);
  pLeft.appendChild(secTitle('TEMPOS (ms/frame)'));

  const profIds = [
    ['dbg-prof-logica', 'Logica', false],
    ['dbg-prof-fundo', 'Fundo', false],
    ['dbg-prof-fog', 'Fog', false],
    ['dbg-prof-fog-draw', '  Canvas draw', true],
    ['dbg-prof-fog-upload', '  Texture upload', true],
    ['dbg-prof-planetas', 'Planetas', false],
    ['dbg-prof-render', 'Render', false],
    ['dbg-prof-total', 'TOTAL', false],
  ];
  for (const [id, label, indent] of profIds) {
    const isBold = id.includes('total');
    const row = el('div', {
      display: 'flex', justifyContent: 'space-between', padding: '3px 0',
      paddingLeft: indent ? '16px' : '0',
      fontWeight: isBold ? 'bold' : 'normal',
      fontSize: isBold ? '12px' : '11px',
      borderTop: isBold ? '1px solid rgba(40,70,120,0.4)' : 'none',
      marginTop: isBold ? '6px' : '0', paddingTop: isBold ? '6px' : '3px',
    });
    const lbl = el('span', { color: indent ? '#556' : '#889' }, label);
    const val = el('span', { color: '#60ff90' });
    row.appendChild(lbl);
    row.appendChild(val);
    pLeft.appendChild(row);
    linhas[id] = { label: lbl, value: val, row };
  }

  pLeft.appendChild(el('div', { height: '12px' }));
  pLeft.appendChild(secTitle('FRAME BREAKDOWN'));

  const barContainer = el('div', {
    display: 'flex', height: '28px', borderRadius: '4px',
    overflow: 'hidden', border: '1px solid #1a3060', marginBottom: '6px',
  });
  pLeft.appendChild(barContainer);
  linhas['dbg-bar'] = barContainer;

  const barLegend = el('div', { display: 'flex', gap: '10px', fontSize: '9px', flexWrap: 'wrap' });
  pLeft.appendChild(barLegend);
  linhas['dbg-bar-legend'] = barLegend;

  // Right: stacked graph
  const pRight = el('div');
  profGrid.appendChild(pRight);
  pRight.appendChild(secTitle('PROFILING TIMELINE'));
  const profCanvas = criarGraficoCanvas(400, 160);
  profCanvas.id = 'dbg-prof-graph';
  pRight.appendChild(profCanvas);

  const profLegend = el('div', { display: 'flex', gap: '10px', marginTop: '6px', fontSize: '9px', flexWrap: 'wrap' });
  for (const [key, cor] of Object.entries(BAR_CORES)) {
    const item = el('div', { display: 'flex', alignItems: 'center', gap: '4px' });
    item.appendChild(el('div', { width: '10px', height: '10px', background: cor, borderRadius: '2px' }));
    item.appendChild(el('span', { color: '#889' }, key));
    profLegend.appendChild(item);
  }
  pRight.appendChild(profLegend);

  // ==================== TAB: CONTROLS ====================
  const ctrlPanel = el('div', { display: 'none' });
  container.appendChild(ctrlPanel);
  panels.controls = ctrlPanel;

  const ctrlGrid = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' });
  ctrlPanel.appendChild(ctrlGrid);

  // Left: renderer + sliders
  const cLeft = el('div');
  ctrlGrid.appendChild(cLeft);

  cLeft.appendChild(secTitle('RENDERER'));
  const rendAtual = el('div', { fontSize: '11px', marginBottom: '8px', color: '#667' });
  rendAtual.id = 'dbg-renderer-atual';
  cLeft.appendChild(rendAtual);

  const rendSelect = document.createElement('select');
  rendSelect.id = 'dbg-renderer-select';
  Object.assign(rendSelect.style, {
    background: '#0a1020', color: '#60ccff', border: '1px solid #2a4070',
    borderRadius: '4px', padding: '6px 10px', fontFamily: 'monospace',
    fontSize: '11px', width: '100%', marginBottom: '8px',
  });
  for (const [val, label] of [['webgl', 'WebGL (GPU)'], ['webgpu', 'WebGPU (GPU)']]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    rendSelect.appendChild(opt);
  }
  rendSelect.value = getRendererPreference();
  cLeft.appendChild(rendSelect);

  const rendBtn = el('button', {
    background: 'linear-gradient(180deg, #1a3060, #102040)', color: '#60ccff',
    border: '1px solid #2a4070', borderRadius: '4px', padding: '8px 16px',
    fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer', width: '100%',
    transition: 'all 0.15s',
  }, 'Aplicar e Recarregar');
  rendBtn.addEventListener('click', () => { setRendererPreference(rendSelect.value); window.location.reload(); });
  rendBtn.addEventListener('mouseenter', () => { rendBtn.style.borderColor = '#4a90cc'; });
  rendBtn.addEventListener('mouseleave', () => { rendBtn.style.borderColor = '#2a4070'; });
  cLeft.appendChild(rendBtn);

  cLeft.appendChild(el('div', { height: '16px' }));
  cLeft.appendChild(secTitle('AJUSTES DE VISAO'));
  criarSlider(cLeft, 'Raio visao planeta', 200, 2000, 50, config.raioVisaoBase, 'raioVisaoBase');
  criarSlider(cLeft, 'Raio visao nave', 100, 1500, 50, config.raioVisaoNave, 'raioVisaoNave');
  criarSlider(cLeft, 'Raio visao batedora', 200, 2500, 50, config.raioVisaoBatedora, 'raioVisaoBatedora');

  cLeft.appendChild(el('div', { height: '8px' }));
  cLeft.appendChild(secTitle('AJUSTES DE FOG'));
  criarSlider(cLeft, 'Fog alpha', 0, 1, 0.05, config.fogAlpha, 'fogAlpha');
  criarSlider(cLeft, 'Fog throttle (frames)', 1, 10, 1, config.fogThrottle, 'fogThrottle');

  // Right: cheats
  const cRight = el('div');
  ctrlGrid.appendChild(cRight);

  cRight.appendChild(secTitle('CHEATS'));
  const cheatBox = el('div', {
    background: 'rgba(10,20,40,0.5)', borderRadius: '6px',
    border: '1px solid rgba(40,70,120,0.3)', padding: '4px 0',
  });
  criarCheat(cheatBox, 'cheat-construcao', 'Construcao instantanea', 'construcaoInstantanea', '1');
  criarCheat(cheatBox, 'cheat-recursos', 'Recursos infinitos', 'recursosInfinitos', '2');
  criarCheat(cheatBox, 'cheat-pesquisa', 'Pesquisa instantanea', 'pesquisaInstantanea', '3');
  criarCheat(cheatBox, 'cheat-visao', 'Visao total (sem fog)', 'visaoTotal', '4');
  criarCheat(cheatBox, 'cheat-velocidade', 'Nave 10x velocidade', 'velocidadeNave', '5');
  cRight.appendChild(cheatBox);

  // Block game events
  for (const evt of ['mousedown', 'mouseup', 'click', 'wheel']) {
    overlay.addEventListener(evt, ev => ev.stopPropagation());
  }

  document.body.appendChild(overlay);
  overlay._linhas = linhas;
  overlay._panels = panels;
  overlay._fpsCanvas = fpsCanvas;
  overlay._profCanvas = profCanvas;
  return overlay;
}

let _popup = null;
let _ultimaAtualizacao = 0;

export function criarDebug() {
  _popup = criarPopupHTML();
  return _popup;
}

export function toggleDebug() {
  if (!_popup) return;
  _popup.style.display = _popup.style.display === 'none' ? 'block' : 'none';
}

export function processarTeclaDebug(ev) {
  if (ev.code === 'F3' || (ev.code === 'Escape' && _popup?.style.display !== 'none')) {
    ev.preventDefault();
    toggleDebug();
    return;
  }
  if (!_popup || _popup.style.display === 'none') return;

  const cheatKeys = {
    'Digit1': ['construcaoInstantanea', 'cheat-construcao'],
    'Digit2': ['recursosInfinitos', 'cheat-recursos'],
    'Digit3': ['pesquisaInstantanea', 'cheat-pesquisa'],
    'Digit4': ['visaoTotal', 'cheat-visao'],
    'Digit5': ['velocidadeNave', 'cheat-velocidade'],
  };
  const ck = cheatKeys[ev.code];
  if (ck) {
    cheats[ck[0]] = !cheats[ck[0]];
    const cb = _popup.querySelector(`#${ck[1]}`);
    if (cb) cb.checked = cheats[ck[0]];
  }
}

function setData(id, label, value, color) {
  const entry = _popup._linhas[id];
  if (!entry) return;
  if (entry.label) entry.label.textContent = label;
  if (entry.value) {
    entry.value.textContent = value;
    if (color) entry.value.style.color = color;
  }
}

function setProf(id, value) {
  const entry = _popup._linhas[id];
  if (!entry) return;
  entry.value.textContent = value.toFixed(2);
  entry.value.style.color = corProf(value);
}

function corProf(v) {
  if (v > 5) return '#ff5050';
  if (v > 2) return '#ffcc40';
  return '#60ff90';
}

function corFps(fps) {
  if (fps >= 50) return '#60ff90';
  if (fps >= 30) return '#ffcc40';
  return '#ff5050';
}

function formatarTempo(ms) {
  if (!ms || ms <= 0) return '0s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function atualizarBarra() {
  const bar = _popup._linhas['dbg-bar'];
  const legend = _popup._linhas['dbg-bar-legend'];
  if (!bar) return;

  const total = Math.max(profiling.total, 0.01);
  while (bar.firstChild) bar.removeChild(bar.firstChild);
  while (legend.firstChild) legend.removeChild(legend.firstChild);

  for (const [key, cor] of Object.entries(BAR_CORES)) {
    const val = profiling[key] || 0;
    const pct = Math.max((val / total) * 100, 0.5);
    const seg = el('div', {
      width: `${pct}%`, background: cor, height: '100%',
      minWidth: '2px', transition: 'width 0.3s',
    });
    seg.title = `${key}: ${val.toFixed(2)}ms`;
    bar.appendChild(seg);

    const item = el('div', { display: 'flex', alignItems: 'center', gap: '3px' });
    item.appendChild(el('div', { width: '8px', height: '8px', background: cor, borderRadius: '2px' }));
    item.appendChild(el('span', { color: '#889' }, `${key} ${val.toFixed(1)}ms`));
    legend.appendChild(item);
  }
}

export function atualizarDebug(debug, mundo, app) {
  if (!_popup || _popup.style.display === 'none') return;

  const agora = performance.now();
  if (agora - _ultimaAtualizacao < THROTTLE_MS) return;
  _ultimaAtualizacao = agora;

  const cam = getCamera();
  const fps = Math.round(app.ticker.FPS);
  const delta = app.ticker.deltaMS.toFixed(1);

  // History
  pushHist(_fpsHist, fps, FPS_HISTORY);
  for (const k of Object.keys(_profHist)) {
    pushHist(_profHist[k], profiling[k] || 0, PROF_HISTORY);
  }

  const rendererType = app.renderer?.name || app.renderer?.constructor?.name || '?';

  // FPS big card
  const fpsBig = _popup.querySelector('#dbg-fps-big');
  if (fpsBig) {
    fpsBig.textContent = fps;
    fpsBig.style.color = corFps(fps);
  }
  const fpsSub = _popup.querySelector('#dbg-fps-sub');
  if (fpsSub) fpsSub.textContent = `delta ${delta}ms  |  ${rendererType}  |  ${mundo.tamanho}px`;

  // FPS graph
  desenharGraficoFps(_popup._fpsCanvas, _fpsHist);

  // Status data
  setData('dbg-camera', 'Camera', `${Math.round(cam.x)}, ${Math.round(cam.y)}  zoom ${cam.zoom.toFixed(2)}x`);
  setData('dbg-mundo', 'Mundo', `${mundo.tamanho}px`);
  setData('dbg-renderer', 'Renderer', rendererType);

  const planetasVis = mundo.planetas.filter(p => p._visivelAoJogador).length;
  const navesVis = mundo.naves.filter(n => n.gfx.visible).length;
  setData('dbg-planetas', 'Planetas', `${planetasVis} / ${mundo.planetas.length}`);
  setData('dbg-naves', 'Naves', `${navesVis} / ${mundo.naves.length}`);
  setData('dbg-sistemas', 'Sistemas', `${mundo.sistemas.length} sistemas, ${mundo.sois.length} sois`);
  setData('dbg-fontes', 'Fontes visao', `${mundo.fontesVisao.length}`);

  const r = mundo.recursosJogador;
  setData('dbg-recursos', 'Recursos', `C:${Math.floor(r.comum)}  R:${Math.floor(r.raro)}  F:${Math.floor(r.combustivel)}`);
  const pesq = getPesquisaAtual(mundo);
  setData('dbg-pesquisa', 'Pesquisa', pesq ? `${pesq.categoria} T${pesq.tier} (${formatarTempo(pesq.tempoRestanteMs)})` : '--');
  setData('dbg-estado', 'Estado', getEstadoJogo());

  const naveSel = obterNaveSelecionada(mundo);
  const planetaSel = mundo.planetas.find(p => p.dados.selecionado);
  if (naveSel) {
    setData('dbg-selecao', 'Selecionado', `nave ${naveSel.tipo} T${naveSel.tier} [${naveSel.estado}]`);
  } else if (planetaSel) {
    const d = planetaSel.dados;
    setData('dbg-selecao', 'Selecionado', `planeta ${d.dono} fab:${d.fabricas} inf:${d.infraestrutura}`);
  } else {
    setData('dbg-selecao', 'Selecionado', '--');
  }

  if (planetaSel?.dados.construcaoAtual) {
    const c = planetaSel.dados.construcaoAtual;
    setData('dbg-construcao', 'Construcao', `${c.tipo} T${c.tierDestino} (${formatarTempo(c.tempoRestanteMs)})`);
  } else if (planetaSel?.dados.producaoNave) {
    const p = planetaSel.dados.producaoNave;
    setData('dbg-construcao', 'Producao', `${p.tipoNave} T${p.tier} (${formatarTempo(p.tempoRestanteMs)})`);
  } else {
    setData('dbg-construcao', 'Construcao', '--');
  }

  let memoriasConhecidas = 0;
  for (const planeta of mundo.planetas) {
    const mem = getMemoria(planeta);
    if (mem?.conhecida) memoriasConhecidas++;
  }
  setData('dbg-neblina', 'Memorias', `${memoriasConhecidas} / ${mundo.planetas.length}`);
  setData('dbg-children', 'Children', `mundo:${mundo.container.children.length}  naves:${mundo.navesContainer.children.length}`);
  setData('dbg-draw-calls', 'Fontes fog', `${mundo.fontesVisao.length} circulos`);
  setData('dbg-textures', 'Fog canvas', '960x540');

  // Profiling
  setProf('dbg-prof-logica', profiling.logica);
  setProf('dbg-prof-fundo', profiling.fundo);
  setProf('dbg-prof-fog', profiling.fog);
  setProf('dbg-prof-fog-draw', fogProfiling.canvas);
  setProf('dbg-prof-fog-upload', fogProfiling.upload);
  setProf('dbg-prof-planetas', profiling.planetas);
  setProf('dbg-prof-render', profiling.render);
  setProf('dbg-prof-total', profiling.total);

  atualizarBarra();
  desenharGraficoProf(_popup._profCanvas, _profHist);

  // Renderer atual
  const rendAtualEl = _popup.querySelector('#dbg-renderer-atual');
  if (rendAtualEl) rendAtualEl.textContent = `Atual: ${rendererType}`;

  // Cheats recursos
  if (cheats.recursosInfinitos) {
    mundo.recursosJogador.comum = Math.max(mundo.recursosJogador.comum, 9999);
    mundo.recursosJogador.raro = Math.max(mundo.recursosJogador.raro, 9999);
    mundo.recursosJogador.combustivel = Math.max(mundo.recursosJogador.combustivel, 9999);
  }
}
