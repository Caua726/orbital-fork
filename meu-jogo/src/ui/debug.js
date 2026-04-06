import { Container, Graphics, Text } from 'pixi.js';
import { getEstadoJogo, getPesquisaAtual, obterNaveSelecionada, profiling } from '../world/mundo.js';
import { getMemoria } from '../world/nevoa.js';
import { getCamera } from '../core/player.js';

const COR_FUNDO = 0x080e1a;
const COR_BORDA = 0x1a3060;
const COR_BORDA_ACCENT = 0x3a6090;
const COR_TITULO = 0x60ccff;
const COR_SECAO = 0x4a90cc;
const COR_VALOR = 0xa0d8b0;
const COR_CHEAT = 0xffcc40;
const COR_CHEAT_ON = 0x60ff90;
const COR_CHEAT_OFF = 0x885544;
const COR_SEPARADOR = 0x162840;
const COR_FPS_BOM = 0x60ff90;
const COR_FPS_MEDIO = 0xffcc40;
const COR_FPS_RUIM = 0xff5050;
const FONTE = 'monospace';
const TAMANHO_FONTE = 10;
const PADDING_X = 12;
const PADDING_Y = 8;
const LINHA_H = 15;
const LARGURA = 300;
const THROTTLE_MS = 200;
const MARGEM_DIREITA = 10;
const MARGEM_TOPO = 40; // abaixo da top bar

/** Estado global de cheats */
export const cheats = {
  construcaoInstantanea: false,
  recursosInfinitos: false,
  pesquisaInstantanea: false,
  visaoTotal: false,
  velocidadeNave: false,
};

function criarTexto(text, cor = COR_VALOR, tamanho = TAMANHO_FONTE) {
  return new Text({
    text,
    style: { fontSize: tamanho, fill: cor, fontFamily: FONTE },
  });
}

function formatarTempo(ms) {
  if (!ms || ms <= 0) return '0s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function adicionarSecao(container, linhas, y, titulo, ids) {
  // Título da seção
  const tituloTxt = criarTexto(titulo, COR_SECAO, 9);
  tituloTxt.x = PADDING_X;
  tituloTxt.y = y;
  container.addChild(tituloTxt);
  y += LINHA_H - 2;

  for (const id of ids) {
    const txt = criarTexto('', COR_VALOR);
    txt.x = PADDING_X + 4;
    txt.y = y;
    container.addChild(txt);
    linhas[id] = txt;
    y += LINHA_H;
  }

  return y;
}

function adicionarSeparador(container, y) {
  const sep = new Graphics();
  sep.rect(PADDING_X, y + 3, LARGURA - PADDING_X * 2, 1)
    .fill({ color: COR_SEPARADOR, alpha: 0.6 });
  container.addChild(sep);
  return y + 8;
}

export function criarDebug(app) {
  const container = new Container();
  container.visible = false;
  container.eventMode = 'none';
  container.y = MARGEM_TOPO;

  const bg = new Graphics();
  container.addChild(bg);

  const linhas = {};

  // Título
  const titulo = criarTexto('', COR_TITULO, 11);
  titulo.x = PADDING_X;
  titulo.y = PADDING_Y;
  container.addChild(titulo);
  linhas.titulo = titulo;

  let y = PADDING_Y + LINHA_H + 2;

  // Seções
  y = adicionarSecao(container, linhas, y, 'PERFORMANCE', ['fps', 'camera', 'mundo']);
  y = adicionarSeparador(container, y);
  y = adicionarSecao(container, linhas, y, 'ENTIDADES', ['planetas', 'naves', 'sistemas', 'fontesVisao']);
  y = adicionarSeparador(container, y);
  y = adicionarSecao(container, linhas, y, 'ECONOMIA', ['recursos', 'pesquisa', 'estado']);
  y = adicionarSeparador(container, y);
  y = adicionarSecao(container, linhas, y, 'SELECAO', ['selecao', 'construcao']);
  y = adicionarSeparador(container, y);
  y = adicionarSecao(container, linhas, y, 'RENDER', ['neblina', 'containers']);
  y = adicionarSeparador(container, y);
  y = adicionarSecao(container, linhas, y, 'PROFILING (ms/frame)', ['profLogica', 'profFundo', 'profFog', 'profPlanetas', 'profRender', 'profTotal']);
  y = adicionarSeparador(container, y);

  // Cheats - título especial
  const cheatTitulo = criarTexto('', COR_CHEAT, 9);
  cheatTitulo.x = PADDING_X;
  cheatTitulo.y = y;
  container.addChild(cheatTitulo);
  linhas.cheatsTitulo = cheatTitulo;
  y += LINHA_H - 2;

  const cheatIds = ['cheatConstrucao', 'cheatRecursos', 'cheatPesquisa', 'cheatVisao', 'cheatVelocidade'];
  for (const id of cheatIds) {
    const txt = criarTexto('', COR_CHEAT_OFF);
    txt.x = PADDING_X + 4;
    txt.y = y;
    container.addChild(txt);
    linhas[id] = txt;
    y += LINHA_H;
  }

  const altura = y + PADDING_Y;

  // Fundo com dupla borda
  bg.roundRect(0, 0, LARGURA, altura, 6).fill({ color: COR_FUNDO, alpha: 0.92 });
  bg.roundRect(0, 0, LARGURA, altura, 6).stroke({ color: COR_BORDA, width: 1.5, alpha: 0.8 });
  bg.roundRect(1, 1, LARGURA - 2, altura - 2, 5).stroke({ color: COR_BORDA_ACCENT, width: 0.5, alpha: 0.3 });

  // Linha de destaque no topo
  bg.rect(8, 0, LARGURA - 16, 2).fill({ color: COR_TITULO, alpha: 0.4 });

  container.x = app.screen.width - LARGURA - MARGEM_DIREITA;
  container._linhas = linhas;
  container._ultimaAtualizacao = 0;
  container._largura = LARGURA;

  return container;
}

export function toggleDebug(debug) {
  debug.visible = !debug.visible;
}

function toggleCheat(nome) {
  cheats[nome] = !cheats[nome];
}

export function processarTeclaDebug(e, debug) {
  if (e.code === 'F3') {
    e.preventDefault();
    toggleDebug(debug);
    return;
  }

  if (!debug.visible) return;

  switch (e.code) {
    case 'Digit1': toggleCheat('construcaoInstantanea'); break;
    case 'Digit2': toggleCheat('recursosInfinitos'); break;
    case 'Digit3': toggleCheat('pesquisaInstantanea'); break;
    case 'Digit4': toggleCheat('visaoTotal'); break;
    case 'Digit5': toggleCheat('velocidadeNave'); break;
  }
}

function corFps(fps) {
  if (fps >= 50) return COR_FPS_BOM;
  if (fps >= 30) return COR_FPS_MEDIO;
  return COR_FPS_RUIM;
}

export function atualizarDebug(debug, mundo, app) {
  if (!debug.visible) return;

  debug.x = app.screen.width - debug._largura - MARGEM_DIREITA;

  const agora = performance.now();
  if (agora - debug._ultimaAtualizacao < THROTTLE_MS) return;
  debug._ultimaAtualizacao = agora;

  const l = debug._linhas;
  const cam = getCamera();
  const fps = Math.round(app.ticker.FPS);
  const delta = app.ticker.deltaMS.toFixed(1);

  l.titulo.text = 'DEBUG  [F3 fechar]';

  // Performance
  l.fps.text = `FPS ${fps}  delta ${delta}ms`;
  l.fps.style.fill = corFps(fps);
  l.camera.text = `cam ${Math.round(cam.x)},${Math.round(cam.y)}  zoom ${cam.zoom.toFixed(2)}x`;
  l.mundo.text = `mundo ${mundo.tamanho}px`;

  // Entidades
  const planetasVis = mundo.planetas.filter(p => p._visivelAoJogador).length;
  const navesVis = mundo.naves.filter(n => n.gfx.visible).length;
  l.planetas.text = `planetas ${planetasVis}/${mundo.planetas.length}`;
  l.naves.text = `naves ${navesVis}/${mundo.naves.length}`;
  l.sistemas.text = `sistemas ${mundo.sistemas.length}  sois ${mundo.sois.length}`;
  l.fontesVisao.text = `fontes visao ${mundo.fontesVisao.length}`;

  // Economia
  const r = mundo.recursosJogador;
  l.recursos.text = `C:${Math.floor(r.comum)} R:${Math.floor(r.raro)} F:${Math.floor(r.combustivel)}`;
  const pesq = getPesquisaAtual(mundo);
  l.pesquisa.text = pesq
    ? `pesq ${pesq.categoria} T${pesq.tier} (${formatarTempo(pesq.tempoRestanteMs)})`
    : 'pesq --';
  l.estado.text = `estado: ${getEstadoJogo()}`;

  // Seleção
  const naveSel = obterNaveSelecionada(mundo);
  const planetaSel = mundo.planetas.find(p => p.dados.selecionado);
  if (naveSel) {
    l.selecao.text = `nave ${naveSel.tipo} T${naveSel.tier} [${naveSel.estado}]`;
  } else if (planetaSel) {
    const d = planetaSel.dados;
    l.selecao.text = `planeta ${d.dono} fab:${d.fabricas} inf:${d.infraestrutura}`;
  } else {
    l.selecao.text = '--';
  }

  if (planetaSel?.dados.construcaoAtual) {
    const c = planetaSel.dados.construcaoAtual;
    l.construcao.text = `${c.tipo} T${c.tierDestino} (${formatarTempo(c.tempoRestanteMs)})`;
  } else if (planetaSel?.dados.producaoNave) {
    const p = planetaSel.dados.producaoNave;
    l.construcao.text = `${p.tipoNave} T${p.tier} (${formatarTempo(p.tempoRestanteMs)})`;
  } else {
    l.construcao.text = '--';
  }

  // Render
  let memoriasConhecidas = 0;
  for (const planeta of mundo.planetas) {
    const mem = getMemoria(planeta);
    if (mem?.conhecida) memoriasConhecidas++;
  }
  l.neblina.text = `memorias ${memoriasConhecidas}/${mundo.planetas.length}`;
  l.containers.text = `children mundo:${mundo.container.children.length} naves:${mundo.navesContainer.children.length}`;

  // Profiling
  const fmt = (v) => v.toFixed(2);
  const corProf = (v) => v > 5 ? COR_FPS_RUIM : v > 2 ? COR_FPS_MEDIO : COR_FPS_BOM;
  l.profLogica.text = `logica: ${fmt(profiling.logica)}`;
  l.profLogica.style.fill = corProf(profiling.logica);
  l.profFundo.text = `fundo:  ${fmt(profiling.fundo)}`;
  l.profFundo.style.fill = corProf(profiling.fundo);
  l.profFog.text = `fog:    ${fmt(profiling.fog)}`;
  l.profFog.style.fill = corProf(profiling.fog);
  l.profPlanetas.text = `planet: ${fmt(profiling.planetas)}`;
  l.profPlanetas.style.fill = corProf(profiling.planetas);
  l.profRender.text = `render: ${fmt(profiling.render)}`;
  l.profRender.style.fill = corProf(profiling.render);
  l.profTotal.text = `TOTAL:  ${fmt(profiling.total)}`;
  l.profTotal.style.fill = corProf(profiling.total);

  // Cheats
  l.cheatsTitulo.text = 'CHEATS [1-5]';
  const cheatList = [
    ['cheatConstrucao', '1 construcao inst.', cheats.construcaoInstantanea],
    ['cheatRecursos', '2 recursos inf.', cheats.recursosInfinitos],
    ['cheatPesquisa', '3 pesquisa inst.', cheats.pesquisaInstantanea],
    ['cheatVisao', '4 visao total', cheats.visaoTotal],
    ['cheatVelocidade', '5 nave 10x vel.', cheats.velocidadeNave],
  ];
  for (const [id, label, ativo] of cheatList) {
    l[id].text = `${label}  ${ativo ? '[ON]' : '[OFF]'}`;
    l[id].style.fill = ativo ? COR_CHEAT_ON : COR_CHEAT_OFF;
  }

  if (cheats.recursosInfinitos) {
    mundo.recursosJogador.comum = Math.max(mundo.recursosJogador.comum, 9999);
    mundo.recursosJogador.raro = Math.max(mundo.recursosJogador.raro, 9999);
    mundo.recursosJogador.combustivel = Math.max(mundo.recursosJogador.combustivel, 9999);
  }
}
