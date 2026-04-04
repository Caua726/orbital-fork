import { Container, Graphics } from 'pixi.js';
import { criarFundo, atualizarFundo } from './fundo.js';
import { criarPlaneta, criarPlanetaSprite } from './planeta.js';

const DONOS = {
  neutro: 0x888888,
  jogador: 0x44aaff,
};

let estadoJogo = 'jogando';

const CICLO_RECURSO_MS = 10 * 1000;
const TIER_MAX = 5;
const CUSTO_BASE_TIER = 20;
const MULTIPLICADOR_TIER = 3;
const RAIO_VISAO_BASE = 1400;
const RAIO_VISAO_NAVE = 900;
const DIST_MIN_SISTEMA = 2800;
const TEMPO_BASE_CONSTRUCAO_MS = 60 * 1000;
const TEMPO_BASE_COLONIZADORA_MS = 60 * 1000;
const CUSTO_COLONIZADORA = 20;
const VELOCIDADE_NAVE = 0.28;
const VELOCIDADE_ORBITA_NAVE = 0.0018;

export function getEstadoJogo() {
  return estadoJogo;
}

export function getTierMax() {
  return TIER_MAX;
}

export function calcularCustoTier(tierAtual) {
  if (tierAtual >= TIER_MAX) return null;
  return CUSTO_BASE_TIER * (MULTIPLICADOR_TIER ** tierAtual);
}

export function calcularTempoConstrucaoMs(tierAtual) {
  if (tierAtual >= TIER_MAX) return null;
  return TEMPO_BASE_CONSTRUCAO_MS * (MULTIPLICADOR_TIER ** tierAtual);
}

export function calcularTempoColonizadoraMs(planeta) {
  if (!planeta || planeta.dados.fabricas < 1) return null;
  return Math.max(10 * 1000, TEMPO_BASE_COLONIZADORA_MS / planeta.dados.fabricas);
}

export function calcularTempoCicloPlaneta(planeta) {
  return CICLO_RECURSO_MS;
}

export function calcularTempoRestantePlaneta(planeta) {
  const cicloAtualMs = calcularTempoCicloPlaneta(planeta);
  return Math.max(0, cicloAtualMs - planeta.dados.acumuladorRecursosMs);
}

function calcularRecursosPorCiclo(planeta) {
  return 1 + planeta.dados.infraestrutura;
}

function calcularRaioVisaoPlaneta(planeta) {
  return RAIO_VISAO_BASE + planeta.dados.tamanho * 0.2;
}

function pontoDentroDaVisao(x, y, fontesVisao) {
  for (const fonte of fontesVisao) {
    const dx = fonte.x - x;
    const dy = fonte.y - y;
    if (dx * dx + dy * dy <= fonte.raio * fonte.raio) {
      return true;
    }
  }
  return false;
}

function formatarId(prefixo) {
  return `${prefixo}_${Math.random().toString(36).slice(2, 10)}`;
}

function desenharConstrucoesPlaneta(planeta) {
  const g = planeta._construcoes;
  if (!g) return;

  g.clear();

  const total = planeta.dados.fabricas + planeta.dados.infraestrutura;
  if (total <= 0) return;

  const baseY = planeta.dados.tamanho * 0.22;
  const espacamento = Math.max(6, planeta.dados.tamanho * 0.05);
  const largura = Math.max(5, planeta.dados.tamanho * 0.03);
  const inicioX = -((total - 1) * espacamento) / 2;
  let indice = 0;

  for (let i = 0; i < planeta.dados.fabricas; i++) {
    const x = inicioX + indice * espacamento;
    const altura = Math.max(8, planeta.dados.tamanho * (0.06 + i * 0.008));
    g.roundRect(x, baseY - altura, largura, altura, 2).fill({ color: 0xffb347, alpha: 0.95 });
    g.rect(x + largura * 0.35, baseY - altura - 4, Math.max(2, largura * 0.25), 4).fill({ color: 0x6b4b1f, alpha: 0.9 });
    indice++;
  }

  for (let i = 0; i < planeta.dados.infraestrutura; i++) {
    const x = inicioX + indice * espacamento;
    const altura = Math.max(7, planeta.dados.tamanho * (0.05 + i * 0.007));
    g.roundRect(x, baseY - altura, largura, altura, 2).fill({ color: 0x6ec1ff, alpha: 0.95 });
    g.rect(x + largura * 0.2, baseY - altura - 2, largura * 0.6, 2).fill({ color: 0xd7f0ff, alpha: 0.9 });
    indice++;
  }
}

function criarSol(x, y, raio, cor) {
  const sol = new Graphics();
  sol.x = x;
  sol.y = y;
  sol._raio = raio;
  sol._cor = cor;
  sol._tipoAlvo = 'sol';
  sol.circle(0, 0, raio * 1.45).fill({ color: cor, alpha: 0.08 });
  sol.circle(0, 0, raio).fill({ color: cor, alpha: 0.95 });
  sol.circle(0, 0, raio * 0.55).fill({ color: 0xfff7dd, alpha: 0.9 });
  return sol;
}

function criarGfxNave() {
  const gfx = new Graphics();
  gfx.poly([0, -10, 8, 8, 0, 4, -8, 8]).fill({ color: 0xffffff, alpha: 0.95 });
  gfx.circle(0, 0, 14).stroke({ color: 0x44aaff, width: 1.2, alpha: 0 });
  return gfx;
}

function atualizarSelecaoNave(nave) {
  const g = nave.gfx;
  g.clear();
  g.poly([0, -10, 8, 8, 0, 4, -8, 8]).fill({ color: 0xffffff, alpha: 0.95 });
  g.circle(0, 0, 14).stroke({ color: 0x44aaff, width: 1.2, alpha: nave.selecionado ? 0.95 : 0 });
}

function obterRaioAlvo(alvo) {
  if (!alvo) return 0;
  if (alvo._tipoAlvo === 'sol') return alvo._raio + 45;
  return alvo.dados.tamanho / 2 + 28;
}

function entrarEmOrbita(nave, alvo) {
  const raio = obterRaioAlvo(alvo) + 18 + Math.random() * 28;
  nave.estado = 'orbitando';
  nave.alvo = alvo;
  nave.orbita = {
    raio,
    angulo: Math.random() * Math.PI * 2,
    velocidade: VELOCIDADE_ORBITA_NAVE,
  };
}

function criarNaveColonizadora(mundo, planetaOrigem) {
  const nave = {
    id: formatarId('nave'),
    tipo: 'colonizadora',
    dono: 'jogador',
    x: planetaOrigem.x,
    y: planetaOrigem.y,
    estado: 'orbitando',
    alvo: planetaOrigem,
    selecionado: false,
    origem: planetaOrigem,
    gfx: criarGfxNave(),
    _tipoAlvo: 'nave',
  };
  atualizarSelecaoNave(nave);
  mundo.navesContainer.addChild(nave.gfx);
  mundo.naves.push(nave);
  entrarEmOrbita(nave, planetaOrigem);
  return nave;
}

function atualizarOrbitaPlaneta(planeta, deltaMs) {
  planeta._orbita.angulo += planeta._orbita.velocidade * deltaMs;
  planeta.x = planeta._orbita.centroX + Math.cos(planeta._orbita.angulo) * planeta._orbita.raio;
  planeta.y = planeta._orbita.centroY + Math.sin(planeta._orbita.angulo) * planeta._orbita.raio;
}

function criarSistemaSolar(container, planetaSheet, centroX, centroY, indiceSistema) {
  const corSol = [0xffd166, 0xffb703, 0xfff1a8, 0xf4a261][indiceSistema % 4];
  const raioSol = 90 + Math.random() * 70;
  const sol = criarSol(centroX, centroY, raioSol, corSol);
  sol.visible = false;
  container.addChild(sol);

  const quantidadePlanetas = 1 + Math.floor(Math.random() * 5);
  const planetas = [];

  for (let i = 0; i < quantidadePlanetas; i++) {
    const tamanho = 140 + Math.random() * 170;
    const raioOrbita = raioSol + 300 + i * (220 + Math.random() * 80);
    const anguloInicial = Math.random() * Math.PI * 2;
    const velocidade = 0.00003 + Math.random() * 0.000025;
    const p = criarPlanetaSprite(
      planetaSheet,
      centroX + Math.cos(anguloInicial) * raioOrbita,
      centroY + Math.sin(anguloInicial) * raioOrbita,
      tamanho
    );

    p.dados = {
      dono: 'neutro',
      producao: 1,
      tamanho,
      selecionado: false,
      fabricas: 0,
      infraestrutura: 0,
      naves: 0,
      acumuladorRecursosMs: 0,
      sistemaId: indiceSistema,
      construcaoAtual: null,
      producaoNave: null,
    };
    p._tipoAlvo = 'planeta';
    p._orbita = {
      centroX,
      centroY,
      raio: raioOrbita,
      angulo: anguloInicial,
      velocidade,
    };

    const anel = new Graphics();
    p.addChild(anel);
    p._anel = anel;

    const construcoes = new Graphics();
    p.addChild(construcoes);
    p._construcoes = construcoes;

    p.visible = false;
    container.addChild(p);
    planetas.push(p);
  }

  return {
    x: centroX,
    y: centroY,
    sol,
    planetas,
  };
}

export async function criarMundo(app, tipoJogador) {
  const tamanho = Math.max(window.innerWidth, window.innerHeight) * 30;
  const container = new Container();

  const fundo = criarFundo(tamanho);
  container.addChild(fundo);

  const planetaSheet = await criarPlaneta(app);
  const planetas = [];
  const sistemas = [];
  const sois = [];
  const frotas = [];
  const frotasContainer = new Container();
  const navesContainer = new Container();
  const visaoContainer = new Graphics();

  container.addChild(frotasContainer);
  container.addChild(navesContainer);
  container.addChild(visaoContainer);

  const totalSistemas = 18;
  let tentativasSistema = 0;
  while (sistemas.length < totalSistemas && tentativasSistema < totalSistemas * 20) {
    tentativasSistema++;
    const x = 1600 + Math.random() * (tamanho - 3200);
    const y = 1600 + Math.random() * (tamanho - 3200);

    let muitoPerto = false;
    for (const sistema of sistemas) {
      const dx = sistema.x - x;
      const dy = sistema.y - y;
      if (dx * dx + dy * dy < DIST_MIN_SISTEMA * DIST_MIN_SISTEMA) {
        muitoPerto = true;
        break;
      }
    }
    if (muitoPerto) continue;

    const sistema = criarSistemaSolar(container, planetaSheet, x, y, sistemas.length);
    sistemas.push(sistema);
    sois.push(sistema.sol);
    planetas.push(...sistema.planetas);
  }

  const mundo = {
    container,
    tamanho,
    planetas,
    sistemas,
    sois,
    naves: [],
    fundo,
    frotas,
    frotasContainer,
    navesContainer,
    planetaSheet,
    tipoJogador,
    recursosJogador: 0,
    ultimoTickMs: performance.now(),
    visaoContainer,
    fontesVisao: [],
  };

  const planetaInicial = planetas[Math.floor(Math.random() * planetas.length)];
  planetaInicial.dados.dono = 'jogador';
  planetaInicial.dados.producao *= tipoJogador?.bonus?.producao || 1;
  planetaInicial.dados.fabricas += tipoJogador?.bonus?.fabricasIniciais || 0;
  planetaInicial.dados.infraestrutura += tipoJogador?.bonus?.infraestruturaInicial || 0;
  desenharConstrucoesPlaneta(planetaInicial);

  estadoJogo = 'jogando';
  return mundo;
}

export function encontrarPlanetaNoPonto(mundoX, mundoY, mundo, apenasVisiveis = true) {
  for (const p of mundo.planetas) {
    if (apenasVisiveis && !p._visivelAoJogador) continue;
    const dx = p.x - mundoX;
    const dy = p.y - mundoY;
    const raio = p.dados.tamanho / 2;
    if (dx * dx + dy * dy < raio * raio) return p;
  }
  return null;
}

export function encontrarSolNoPonto(mundoX, mundoY, mundo, apenasVisiveis = true) {
  for (const sol of mundo.sois) {
    if (apenasVisiveis && !sol._visivelAoJogador) continue;
    const dx = sol.x - mundoX;
    const dy = sol.y - mundoY;
    if (dx * dx + dy * dy < sol._raio * sol._raio) return sol;
  }
  return null;
}

export function encontrarNaveNoPonto(mundoX, mundoY, mundo) {
  for (let i = mundo.naves.length - 1; i >= 0; i--) {
    const nave = mundo.naves[i];
    const dx = nave.x - mundoX;
    const dy = nave.y - mundoY;
    if (dx * dx + dy * dy < 18 * 18) return nave;
  }
  return null;
}

export function obterNaveSelecionada(mundo) {
  return mundo.naves.find((n) => n.selecionado) || null;
}

export function limparSelecoes(mundo) {
  for (const p of mundo.planetas) p.dados.selecionado = false;
  for (const nave of mundo.naves) {
    nave.selecionado = false;
    atualizarSelecaoNave(nave);
  }
}

export function selecionarPlaneta(mundo, planeta) {
  limparSelecoes(mundo);
  if (planeta) planeta.dados.selecionado = true;
}

export function selecionarNave(mundo, nave) {
  limparSelecoes(mundo);
  if (nave) {
    nave.selecionado = true;
    atualizarSelecaoNave(nave);
  }
}

export function enviarNaveParaAlvo(mundo, nave, alvo) {
  if (!nave || !alvo) return false;
  nave.estado = 'viajando';
  nave.alvo = alvo;
  nave.orbita = null;
  return true;
}

function finalizarColonizacao(mundo, nave, planeta) {
  planeta.dados.dono = 'jogador';
  planeta.dados.selecionado = false;
  removerNave(mundo, nave);
}

function removerNave(mundo, nave) {
  if (nave.origem?.dados) {
    nave.origem.dados.naves = Math.max(0, nave.origem.dados.naves - 1);
  }
  const idx = mundo.naves.indexOf(nave);
  if (idx >= 0) mundo.naves.splice(idx, 1);
  if (nave.gfx) mundo.navesContainer.removeChild(nave.gfx);
}

function atualizarFilasPlaneta(mundo, planeta, deltaMs) {
  if (planeta.dados.dono !== 'jogador') return;

  planeta.dados.acumuladorRecursosMs += deltaMs;
  while (planeta.dados.acumuladorRecursosMs >= CICLO_RECURSO_MS) {
    planeta.dados.acumuladorRecursosMs -= CICLO_RECURSO_MS;
    mundo.recursosJogador += calcularRecursosPorCiclo(planeta);
  }

  const construcao = planeta.dados.construcaoAtual;
  if (construcao) {
    construcao.tempoRestanteMs = Math.max(0, construcao.tempoRestanteMs - deltaMs);
    if (construcao.tempoRestanteMs <= 0) {
      if (construcao.tipo === 'fabrica') planeta.dados.fabricas = construcao.tierDestino;
      if (construcao.tipo === 'infraestrutura') planeta.dados.infraestrutura = construcao.tierDestino;
      planeta.dados.construcaoAtual = null;
      desenharConstrucoesPlaneta(planeta);
    }
  }

  const producao = planeta.dados.producaoNave;
  if (producao) {
    producao.tempoRestanteMs = Math.max(0, producao.tempoRestanteMs - deltaMs);
    if (producao.tempoRestanteMs <= 0) {
      planeta.dados.producaoNave = null;
      planeta.dados.naves += 1;
      criarNaveColonizadora(mundo, planeta);
    }
  }
}

function atualizarCampoDeVisao(mundo) {
  const fontesVisao = [];

  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono !== 'jogador') continue;
    fontesVisao.push({
      x: planeta.x,
      y: planeta.y,
      raio: calcularRaioVisaoPlaneta(planeta),
    });
  }

  for (const nave of mundo.naves) {
    fontesVisao.push({
      x: nave.x,
      y: nave.y,
      raio: RAIO_VISAO_NAVE,
    });
  }

  mundo.fontesVisao = fontesVisao;

  mundo.visaoContainer.clear();
  for (const fonte of fontesVisao) {
    mundo.visaoContainer.circle(fonte.x, fonte.y, fonte.raio).stroke({
      color: 0xffffff,
      width: 1.2,
      alpha: 0.6,
    });
  }

  for (const sol of mundo.sois) {
    sol._visivelAoJogador = pontoDentroDaVisao(sol.x, sol.y, fontesVisao);
  }

  for (const planeta of mundo.planetas) {
    planeta._visivelAoJogador =
      planeta.dados.dono === 'jogador' ||
      pontoDentroDaVisao(planeta.x, planeta.y, fontesVisao);
    if (!planeta._visivelAoJogador && planeta.dados.selecionado) {
      planeta.dados.selecionado = false;
    }
  }
}

function atualizarNaves(mundo, deltaMs) {
  for (let i = mundo.naves.length - 1; i >= 0; i--) {
    const nave = mundo.naves[i];
    const alvo = nave.alvo;
    if (!alvo) continue;

    if (nave.estado === 'viajando') {
      const dx = alvo.x - nave.x;
      const dy = alvo.y - nave.y;
      const dist = Math.hypot(dx, dy);
      const stopDist = obterRaioAlvo(alvo);

      if (dist <= stopDist + VELOCIDADE_NAVE * deltaMs) {
        if (nave.tipo === 'colonizadora' && alvo._tipoAlvo === 'planeta' && alvo.dados.dono === 'neutro') {
          finalizarColonizacao(mundo, nave, alvo);
          continue;
        }

        entrarEmOrbita(nave, alvo);
      } else if (dist > 0) {
        nave.x += (dx / dist) * VELOCIDADE_NAVE * deltaMs;
        nave.y += (dy / dist) * VELOCIDADE_NAVE * deltaMs;
      }
    }

    if (nave.estado === 'orbitando' && nave.orbita && nave.alvo) {
      nave.orbita.angulo += nave.orbita.velocidade * deltaMs;
      nave.x = nave.alvo.x + Math.cos(nave.orbita.angulo) * nave.orbita.raio;
      nave.y = nave.alvo.y + Math.sin(nave.orbita.angulo) * nave.orbita.raio;
    }

    nave.gfx.x = nave.x;
    nave.gfx.y = nave.y;
  }
}

export function atualizarMundo(mundo, app, camera) {
  const agora = performance.now();
  const deltaMs = agora - (mundo.ultimoTickMs || agora);
  mundo.ultimoTickMs = agora;

  for (const planeta of mundo.planetas) {
    atualizarOrbitaPlaneta(planeta, deltaMs);
    atualizarFilasPlaneta(mundo, planeta, deltaMs);
  }

  atualizarNaves(mundo, deltaMs);
  atualizarCampoDeVisao(mundo);

  const zoom = camera.zoom || 1;
  const camX = camera.x + app.screen.width / 2;
  const camY = camera.y + app.screen.height / 2;

  atualizarFundo(mundo.fundo, camX, camY, app.screen.width, app.screen.height);

  const margem = 600 / zoom;
  const esq = camera.x - margem;
  const dir = camera.x + app.screen.width / zoom + margem;
  const cima = camera.y - margem;
  const baixo = camera.y + app.screen.height / zoom + margem;

  for (const planeta of mundo.planetas) {
    const visNaTela = planeta.x > esq && planeta.x < dir && planeta.y > cima && planeta.y < baixo;
    const vis = visNaTela && planeta._visivelAoJogador;
    if (vis && !planeta.visible) planeta.play();
    else if (!vis && planeta.visible) planeta.stop();
    planeta.visible = vis;

    if (vis) {
      const anel = planeta._anel;
      anel.clear();
      const cor = DONOS[planeta.dados.dono] || 0x888888;
      const raio = planeta.dados.tamanho / 2 + 5;
      const largura = planeta.dados.selecionado ? 4 : 2;
      anel.circle(0, 0, raio).stroke({ color: cor, width: largura, alpha: 0.8 });
      desenharConstrucoesPlaneta(planeta);
    }
  }

  for (const sol of mundo.sois) {
    const visNaTela = sol.x > esq && sol.x < dir && sol.y > cima && sol.y < baixo;
    sol.visible = visNaTela && sol._visivelAoJogador;
  }

  for (const nave of mundo.naves) {
    const visNaTela = nave.x > esq && nave.x < dir && nave.y > cima && nave.y < baixo;
    nave.gfx.visible = visNaTela;
    atualizarSelecaoNave(nave);
  }

  verificarEstadoJogo(mundo);
}

export function construirNoPlaneta(mundo, planeta, tipo) {
  if (!planeta || planeta.dados.dono !== 'jogador') return false;

  if (tipo === 'fabrica') {
    if (planeta.dados.construcaoAtual) return false;
    const custo = calcularCustoTier(planeta.dados.fabricas);
    const tempo = calcularTempoConstrucaoMs(planeta.dados.fabricas);
    if (!custo || !tempo || mundo.recursosJogador < custo) return false;
    mundo.recursosJogador -= custo;
    planeta.dados.construcaoAtual = {
      tipo: 'fabrica',
      tierDestino: planeta.dados.fabricas + 1,
      tempoRestanteMs: tempo,
      tempoTotalMs: tempo,
    };
    return true;
  }

  if (tipo === 'infraestrutura') {
    if (planeta.dados.construcaoAtual) return false;
    const custo = calcularCustoTier(planeta.dados.infraestrutura);
    const tempo = calcularTempoConstrucaoMs(planeta.dados.infraestrutura);
    if (!custo || !tempo || mundo.recursosJogador < custo) return false;
    mundo.recursosJogador -= custo;
    planeta.dados.construcaoAtual = {
      tipo: 'infraestrutura',
      tierDestino: planeta.dados.infraestrutura + 1,
      tempoRestanteMs: tempo,
      tempoTotalMs: tempo,
    };
    return true;
  }

  if (tipo === 'colonizadora') {
    if (planeta.dados.fabricas < 1 || planeta.dados.producaoNave) return false;
    const tempo = calcularTempoColonizadoraMs(planeta);
    if (!tempo || mundo.recursosJogador < CUSTO_COLONIZADORA) return false;
    mundo.recursosJogador -= CUSTO_COLONIZADORA;
    planeta.dados.producaoNave = {
      tipo: 'colonizadora',
      tempoRestanteMs: tempo,
      tempoTotalMs: tempo,
    };
    return true;
  }

  return false;
}

function verificarEstadoJogo(mundo) {
  if (estadoJogo !== 'jogando') return;

  let jogadorTemPlaneta = false;
  let todosSaoJogador = true;

  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono === 'jogador') jogadorTemPlaneta = true;
    if (planeta.dados.dono !== 'jogador') todosSaoJogador = false;
  }

  if (!jogadorTemPlaneta) {
    estadoJogo = 'derrota';
  } else if (todosSaoJogador) {
    estadoJogo = 'vitoria';
  }
}
