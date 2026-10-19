/**
 * Render lab — live side-by-side engines + matrix screenshot viewer.
 *
 * "Ao vivo": two iframes run the real game (`../?lab=1&engine&backend&seed`),
 * driven through the same scene functions as the headless matrix
 * (cenas.mjs). They are evaluated inside each iframe's realm, so `window`
 * there is the game page. "Capturar e comparar" grabs one frame from each
 * (`__render.capturar`) and diffs them with the matrix thresholds.
 *
 * "Matriz": loads report.json written by tests/render-matrix.mjs and shows
 * any two variants of a scene side by side, swiped, blinking or diffed.
 */
import { SCENES, iniciarPartida, prepararFixtures, posicionar } from './cenas.mjs';

const $ = (id) => document.getElementById(id);
/** report.json content goes into innerHTML templates — escape it. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VARIANTES = [
  ['pixi', 'webgl', 'Pixi · WebGL'],
  ['pixi', 'webgpu', 'Pixi · WebGPU'],
  ['pixi', 'canvas', 'Pixi · Canvas (CPU)'],
  ['weydra', 'webgl2', 'Weydra · WebGL2'],
  ['weydra', 'webgpu', 'Weydra · WebGPU'],
  ['weydra', 'software', 'Weydra · Software (CPU)'],
];
const CAMADAS = ['STARFIELD', 'STARFIELD_BRIGHT', 'PLANETS', 'ORBITS', 'ROUTES', 'SHIP_TRAILS', 'SHIPS', 'BEAMS', 'FOG', 'FOG_MEMORY', 'UI'];

// ─── Tabs ──────────────────────────────────────────────────────────────
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('.tabs button')) o.classList.toggle('on', o === b);
    $('tab-vivo').hidden = b.dataset.tab !== 'vivo';
    $('tab-matriz').hidden = b.dataset.tab !== 'matriz';
  });
}

// ─── Pixel diff (same thresholds as tests/render-matrix.mjs) ──────────
function diffImagens(da, db, w, h, alvo) {
  alvo.width = w;
  alvo.height = h;
  const ctx = alvo.getContext('2d');
  const out = ctx.createImageData(w, h);
  let d3 = 0, d16 = 0, soma = 0, conteudo = 0, d16c = 0;
  for (let i = 0; i < da.length; i += 4) {
    const m = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    soma += m;
    if (m >= 3) d3++;
    if (m >= 16) d16++;
    if (Math.max(da[i], da[i + 1], da[i + 2], db[i], db[i + 1], db[i + 2]) >= 24) {
      conteudo++;
      if (m >= 16) d16c++;
    }
    const g = (db[i] + db[i + 1] + db[i + 2]) / 12;
    out.data[i] = m >= 16 ? 255 : g;
    out.data[i + 1] = m >= 16 ? 0 : (m >= 3 ? 200 : g);
    out.data[i + 2] = m >= 16 ? 64 : g;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const n = w * h;
  const r = { d3: d3 / n, d16: d16 / n, media: soma / n, rel: conteudo ? d16c / conteudo : 0 };
  r.veredito = r.d16 >= 0.03 || r.rel >= 0.25 ? 'diverge' : r.d16 >= 0.005 || r.rel >= 0.08 ? 'próximo' : 'igual';
  return r;
}

async function pixels(src, w, h) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w ?? img.naturalWidth;
  c.height = h ?? img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;

// ─── Ao vivo ───────────────────────────────────────────────────────────
for (const sel of [$('a'), $('b')]) {
  for (const [e, b, nome] of VARIANTES) sel.add(new Option(nome, `${e}:${b}`));
}
$('a').value = 'pixi:webgl';
$('b').value = 'weydra:webgl2';
for (const s of SCENES) $('cena').add(new Option(s.title, s.id));
for (const nome of CAMADAS) {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox" data-camada="${esc(nome)}" checked disabled> ${esc(nome.toLowerCase())}`;
  $('camadas').appendChild(l);
}

/** One side of the comparison: an iframe running the game. */
class Lado {
  constructor(id, frame, titulo, info) {
    this.id = id;
    this.frame = frame;
    this.titulo = titulo;
    this.info = info;
    this.iframe = null;
    this.ctx = null;
  }
  get w() { return this.iframe.contentWindow; }
  /** Runs a cenas.mjs function inside the game page's realm. */
  rodar(fn, arg) {
    return this.w.eval(`(${fn.toString()})`)(arg);
  }
  async carregar(engine, backend, seed, [w, h]) {
    this.frame.replaceChildren();
    const f = document.createElement('iframe');
    f.width = w;
    f.height = h;
    f.style.width = `${w}px`;
    f.style.height = `${h}px`;
    f.src = `../?lab=1&engine=${engine}&backend=${backend}&seed=${seed}`;
    this.frame.appendChild(f);
    const escala = () => { f.style.transform = `scale(${this.frame.clientWidth / w})`; };
    escala();
    new ResizeObserver(escala).observe(this.frame);
    this.iframe = f;
    await new Promise((r) => f.addEventListener('load', r, { once: true }));
    this.titulo.textContent = VARIANTES.find(([e, b]) => e === engine && b === backend)?.[2] ?? `${engine}/${backend}`;
    await this.rodar(iniciarPartida, 'Render Lab');
    const info = this.w.__render.info();
    this.info.textContent = `efetivo: ${info.engine} ${info.effective}${info.effective !== backend ? ' (caiu de backend!)' : ''}`;
    this.ctx = this.rodar(prepararFixtures);
    this.hud($('hud').checked);
  }
  hud(esconder) {
    const d = this.iframe?.contentDocument;
    if (!d) return;
    let st = d.getElementById('lab-hud');
    if (esconder && !st) {
      // Only the game canvas stays visible (like the matrix screenshots).
      this.w.__render && this.w._app?.canvas?.setAttribute('data-lab-keep', '');
      st = d.createElement('style');
      st.id = 'lab-hud';
      st.textContent = 'body *{visibility:hidden !important} [data-lab-keep]{visibility:visible !important}';
      d.head.appendChild(st);
    } else if (!esconder && st) st.remove();
  }
}

const A = new Lado('a', $('fa'), $('ta'), $('ia'));
const B = new Lado('b', $('fb'), $('tb'), $('ib'));
let camAtual = null;

function controles(on) {
  for (const id of ['cena', 'mostrar', 'zoom', 'passos', 'avancar', 'comparar']) $(id).disabled = !on;
  for (const c of document.querySelectorAll('[data-camada]')) c.disabled = !on;
}

function status(txt) { $('st').textContent = txt; }

$('iniciar').addEventListener('click', async () => {
  controles(false);
  $('iniciar').disabled = true;
  $('resultado').hidden = true;
  status('carregando as duas engines e gerando o mesmo mundo…');
  const [ea, ba] = $('a').value.split(':');
  const [eb, bb] = $('b').value.split(':');
  const tam = $('tam').value.split('x').map(Number);
  const seed = Number($('seed').value) >>> 0;
  try {
    await Promise.all([A.carregar(ea, ba, seed, tam), B.carregar(eb, bb, seed, tam)]);
    const ida = JSON.stringify(A.ctx.home), idb = JSON.stringify(B.ctx.home);
    status(ida === idb ? 'pronto — mesmo mundo nas duas engines' : `atenção: mundos diferentes (planeta natal A ${ida} · B ${idb})`);
    controles(true);
  } catch (err) {
    status(`falhou: ${err.message ?? err}`);
  } finally {
    $('iniciar').disabled = false;
  }
});

function mascaraDosChecks(L) {
  let m = 0;
  for (const c of document.querySelectorAll('[data-camada]')) if (c.checked) m |= L[c.dataset.camada];
  return m >>> 0;
}

function checksDaMascara(L, mask) {
  for (const c of document.querySelectorAll('[data-camada]')) c.checked = (mask & L[c.dataset.camada]) !== 0;
}

async function aplicar(cam) {
  camAtual = cam;
  $('zoom').value = String(cam.zoom);
  await Promise.all([A.rodar(posicionar, cam), B.rodar(posicionar, cam)]);
}

$('mostrar').addEventListener('click', async () => {
  const cena = SCENES.find((s) => s.id === $('cena').value);
  controles(false);
  status(`preparando "${cena.title}"…`);
  try {
    const L = { ...A.w.__render.LAYER, ALL_BITS: A.w.__render.ALL };
    const cams = [];
    for (const lado of [A, B]) {
      if (cena.prepare) {
        const { patch, aviso } = await lado.rodar(cena.prepare, { ctx: lado.ctx });
        Object.assign(lado.ctx, patch);
        if (aviso) status(aviso);
      }
      cams.push(lado.rodar(cena.setup, { L, ctx: lado.ctx }));
    }
    if (!cams[0]) throw new Error('pré-condição da cena não satisfeita');
    checksDaMascara(L, cams[0].mask);
    await Promise.all([A.rodar(posicionar, cams[0]), B.rodar(posicionar, cams[1] ?? cams[0])]);
    camAtual = cams[0];
    $('zoom').value = String(cams[0].zoom);
    status(`cena "${cena.title}" nas duas engines`);
  } catch (err) {
    status(`falhou: ${err.message ?? err}`);
  } finally {
    controles(true);
  }
});

for (const c of document.querySelectorAll('[data-camada]')) {
  c.addEventListener('change', () => {
    if (!camAtual) return;
    const L = A.w.__render.LAYER;
    const mask = mascaraDosChecks(L);
    camAtual = { ...camAtual, mask };
    A.w.__render.setLayers(mask);
    B.w.__render.setLayers(mask);
  });
}

$('zoom').addEventListener('change', async () => {
  if (!camAtual) return;
  controles(false);
  await aplicar({ ...camAtual, zoom: Number($('zoom').value) });
  controles(true);
});

$('avancar').addEventListener('click', async () => {
  const n = Math.max(1, Math.min(600, Number($('passos').value) | 0));
  controles(false);
  status(`avançando ${n} passos fixos nas duas engines…`);
  await Promise.all([A.w.__render.step(n), B.w.__render.step(n)]);
  status(`avançou ${n} passos`);
  controles(true);
});

$('hud').addEventListener('change', () => { A.hud($('hud').checked); B.hud($('hud').checked); });

$('comparar').addEventListener('click', async () => {
  const sa = A.w.__render.capturar();
  const sb = B.w.__render.capturar();
  if (!sa || !sb) return status('captura indisponível');
  const pa = await pixels(sa);
  const pb = await pixels(sb, pa.w, pa.h);
  const r = diffImagens(pa.data, pb.data, pa.w, pa.h, $('cd'));
  $('ca').src = sa;
  $('cb').src = sb;
  $('veredito').innerHTML = `<span class="pill ${r.veredito}">${r.veredito}</span>`;
  $('metricas').textContent = `Δ≥16: ${pct(r.d16)} do quadro · ${pct(r.rel)} do conteúdo · Δ≥3: ${pct(r.d3)} · média ${r.media.toFixed(2)}`;
  $('resultado').hidden = false;
});

// ─── Matriz ────────────────────────────────────────────────────────────
let rel = null;
let base = '';
let piscar = null;

$('carregar').addEventListener('click', async () => {
  $('mst').textContent = 'carregando…';
  try {
    const url = new URL($('url').value, location.href);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} — rode bun run test:render-matrix e abra pelo bun run dev`);
    rel = await res.json();
    base = url.href.replace(/[^/]*$/, '');
    montarMatriz();
    $('mst').textContent = `${rel.results.length} variantes · referência ${rel.reference}`;
    $('mconteudo').hidden = false;
  } catch (err) {
    $('mst').textContent = `não carregou: ${err.message ?? err}`;
  }
});

function montarMatriz() {
  const cenas = [...new Set(rel.results.flatMap((r) => Object.keys(r.scenes)))];
  for (const sel of [$('mcena'), $('ma'), $('mb')]) sel.replaceChildren();
  for (const c of cenas) $('mcena').add(new Option(c, c));
  for (const r of rel.results) {
    const marca = r.crash ? ' [crash]' : r.valid ? '' : ' [inválida]';
    $('ma').add(new Option(r.id + marca, r.id));
    $('mb').add(new Option(r.id + marca, r.id));
  }
  $('ma').value = rel.reference;
  $('mb').value = rel.results.find((r) => r.id.startsWith('weydra'))?.id ?? rel.results[1]?.id ?? rel.reference;
  $('mref').textContent = rel.reference;
  // Summary table: Δ≥16 of every variant against the reference.
  const t = $('mtab');
  t.replaceChildren();
  const cab = t.insertRow();
  cab.innerHTML = `<th>cena</th>${rel.results.map((r) => `<th>${esc(r.id)}</th>`).join('')}`;
  for (const c of cenas) {
    const tr = t.insertRow();
    tr.innerHTML = `<th style="text-align:left">${esc(c)}</th>`;
    for (const r of rel.results) {
      const e = r.scenes[c];
      const td = tr.insertCell();
      const v = e?.vsRef;
      if (r.id === rel.reference) { td.textContent = 'ref'; td.className = 'na'; }
      else if (v) { td.innerHTML = `<span class="pill ${v.verdict}">${pct(v.d16)}</span>`; }
      else td.textContent = e?.error ? 'erro' : '—';
      td.classList.add('clk');
      td.addEventListener('click', () => {
        $('mcena').value = c;
        $('mb').value = r.id;
        mostrarMatriz();
        for (const o of t.querySelectorAll('td.sel')) o.classList.remove('sel');
        td.classList.add('sel');
      });
    }
  }
  mostrarMatriz();
}

function arquivo(id, cena) {
  const f = rel.results.find((r) => r.id === id)?.scenes?.[cena]?.file;
  return f ? base + f : null;
}

async function mostrarMatriz() {
  if (piscar) { clearInterval(piscar); piscar = null; }
  const cena = $('mcena').value;
  const fa = arquivo($('ma').value, cena);
  const fb = arquivo($('mb').value, cena);
  const modo = $('modo').value;
  $('swipel').hidden = modo !== 'swipe';
  const v = $('mview');
  v.replaceChildren();
  $('mmet').textContent = '';
  if (!fa || !fb) { v.textContent = 'sem print para essa combinação'; return; }
  if (modo === 'lado') {
    v.innerHTML = `<div class="grid2"><div><div class="muted">A · ${esc($('ma').value)}</div><div class="frame"><img src="${esc(fa)}"></div></div>
      <div><div class="muted">B · ${esc($('mb').value)}</div><div class="frame"><img src="${esc(fb)}"></div></div></div>`;
  } else if (modo === 'swipe') {
    v.innerHTML = `<div class="frame"><img src="${esc(fb)}"><div class="swipe" id="sw"><img src="${esc(fa)}"></div></div>
      <div class="muted">esquerda: A · ${esc($('ma').value)} — direita: B · ${esc($('mb').value)}</div>`;
    const ajustar = () => { $('sw').style.clipPath = `inset(0 ${100 - Number($('swipe').value)}% 0 0)`; };
    ajustar();
    $('swipe').oninput = ajustar;
  } else if (modo === 'piscar') {
    v.innerHTML = `<div class="frame"><img id="pi" src="${esc(fa)}"></div><div class="muted" id="pil">A · ${esc($('ma').value)}</div>`;
    let a = true;
    piscar = setInterval(() => {
      a = !a;
      $('pi').src = a ? fa : fb;
      $('pil').textContent = a ? `A · ${$('ma').value}` : `B · ${$('mb').value}`;
    }, 600);
  } else {
    v.innerHTML = '<div class="frame"><canvas id="mdiff"></canvas></div><div class="muted">vermelho Δ≥16, verde Δ≥3</div>';
  }
  const pa = await pixels(fa);
  const pb = await pixels(fb, pa.w, pa.h);
  const r = diffImagens(pa.data, pb.data, pa.w, pa.h, modo === 'diff' ? $('mdiff') : document.createElement('canvas'));
  $('mmet').innerHTML = `<span class="pill ${r.veredito}">${r.veredito}</span> Δ≥16 ${pct(r.d16)} do quadro · ${pct(r.rel)} do conteúdo · média ${r.media.toFixed(2)}`;
}

for (const id of ['mcena', 'ma', 'mb', 'modo']) $(id).addEventListener('change', mostrarMatriz);
