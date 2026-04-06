import { Container, Graphics, Text } from 'pixi.js';
import {
  aplicarAparenciaTipoPlaneta,
  criarPlanetaSprite,
  nomeTipoPlaneta,
} from './planeta.js';

const ALPHA_FANTASMA = 0.32;
const ALPHA_FANTASMA_ANEL = 0.3;
const COR_ANEL_FANTASMA_FALLBACK = 0x556680;
const DISTANCIA_LABEL_MEMORIA = 18;
const FADE_VELOCIDADE = 0.04;

const DONOS_FANTASMA = {
  neutro: 0x556680,
  jogador: 0x2a6699,
};

function nomeDonoCurto(dono) {
  if (dono === 'jogador') return 'Seu';
  if (dono === 'neutro') return 'Neutro';
  return dono || '?';
}

function capturarMemoriaPlaneta(planeta) {
  return {
    x: planeta.x,
    y: planeta.y,
    frame: planeta.currentFrame ?? 0,
    timestamp: performance.now(),
    orbita: planeta._orbita ? {
      centroX: planeta._orbita.centroX,
      centroY: planeta._orbita.centroY,
      raio: planeta._orbita.raio,
      angulo: planeta._orbita.angulo,
      velocidade: planeta._orbita.velocidade,
    } : null,
    dados: {
      dono: planeta.dados.dono,
      tipoPlaneta: planeta.dados.tipoPlaneta,
      tamanho: planeta.dados.tamanho,
      fabricas: planeta.dados.fabricas,
      infraestrutura: planeta.dados.infraestrutura,
      naves: planeta.dados.naves,
      producao: planeta.dados.producao,
    },
  };
}

function dadosMudaram(anterior, atual) {
  if (!anterior) return true;
  const a = anterior.dados;
  const b = atual.dados;
  return (
    a.dono !== b.dono ||
    a.tipoPlaneta !== b.tipoPlaneta ||
    a.tamanho !== b.tamanho ||
    a.fabricas !== b.fabricas ||
    a.infraestrutura !== b.infraestrutura ||
    a.naves !== b.naves ||
    a.producao !== b.producao
  );
}

/** Mapa global de memórias: planeta -> memória. Desacoplado do sprite. */
const memorias = new WeakMap();

export function getMemoria(planeta) {
  return memorias.get(planeta) || null;
}

export function criarCamadaMemoria() {
  const container = new Container();
  container.eventMode = 'none';
  return container;
}

export function criarMemoriaVisualPlaneta(mundo, planeta) {
  const container = new Container();
  container.visible = false;
  container.eventMode = 'none';
  container.alpha = 0;

  const fantasma = criarPlanetaSprite(
    mundo.planetaSheet,
    0,
    0,
    planeta.dados.tamanho,
    planeta.dados.tipoPlaneta
  );
  fantasma.alpha = ALPHA_FANTASMA;
  fantasma.animationSpeed = 0;
  fantasma.gotoAndStop(planeta.currentFrame ?? 0);
  fantasma.anchor.set(0.5);
  container.addChild(fantasma);

  const anel = new Graphics();
  container.addChild(anel);

  const infoBg = new Graphics();
  container.addChild(infoBg);

  const info = new Text({
    text: '',
    style: {
      fontSize: 11,
      fill: 0xcfe3ff,
      fontFamily: 'monospace',
      align: 'center',
    },
  });
  info.anchor.set(0.5, 0);
  container.addChild(info);

  const tempoLabel = new Text({
    text: '',
    style: {
      fontSize: 9,
      fill: 0x8899aa,
      fontFamily: 'monospace',
      align: 'center',
    },
  });
  tempoLabel.anchor.set(0.5, 0);
  container.addChild(tempoLabel);

  mundo.memoriaPlanetasContainer.addChild(container);

  const memoria = {
    conhecida: false,
    visual: container,
    fantasma,
    anel,
    infoBg,
    info,
    tempoLabel,
    dados: null,
    _textoAnterior: '',
    _alphaAlvo: 0,
  };

  memorias.set(planeta, memoria);
}

function redesenharVisualMemoria(memoria) {
  const { dados } = memoria;
  if (!dados) return;

  const tamanho = dados.dados.tamanho;

  memoria.fantasma.width = tamanho;
  memoria.fantasma.height = tamanho;
  memoria.fantasma.gotoAndStop(dados.frame ?? 0);
  memoria.fantasma.alpha = ALPHA_FANTASMA;
  aplicarAparenciaTipoPlaneta(memoria.fantasma, dados.dados.tipoPlaneta);

  const corAnel = DONOS_FANTASMA[dados.dados.dono] || COR_ANEL_FANTASMA_FALLBACK;
  memoria.anel.clear();
  memoria.anel.circle(0, 0, tamanho / 2 + 5).stroke({
    color: corAnel,
    width: 1.5,
    alpha: ALPHA_FANTASMA_ANEL,
  });

  const novoTexto =
    `${nomeDonoCurto(dados.dados.dono)} | ${nomeTipoPlaneta(dados.dados.tipoPlaneta)}\n` +
    `Fab ${dados.dados.fabricas}  Inf ${dados.dados.infraestrutura}  Nv ${dados.dados.naves}`;

  if (novoTexto !== memoria._textoAnterior) {
    memoria.info.text = novoTexto;
    memoria._textoAnterior = novoTexto;
  }

  memoria.info.y = tamanho / 2 + DISTANCIA_LABEL_MEMORIA;

  const largura = memoria.info.width + 12;
  const altura = memoria.info.height + 8;
  memoria.infoBg.clear();
  memoria.infoBg.roundRect(-largura / 2, memoria.info.y - 4, largura, altura, 4).fill({
    color: 0x08111f,
    alpha: 0.62,
  });

  memoria.tempoLabel.y = memoria.info.y + altura + 2;
}

export function registrarMemoriaPlaneta(planeta) {
  const memoria = memorias.get(planeta);
  if (!memoria) return;

  const novoSnapshot = capturarMemoriaPlaneta(planeta);
  const mudou = dadosMudaram(memoria.dados, novoSnapshot);

  memoria.conhecida = true;
  memoria.dados = novoSnapshot;

  if (mudou) {
    redesenharVisualMemoria(memoria);
  }
}

export function atualizarPosicaoMemoriaOrbital(planeta, deltaMs) {
  const memoria = memorias.get(planeta);
  if (!memoria?.dados?.orbita) return;

  const orb = memoria.dados.orbita;
  orb.angulo += orb.velocidade * deltaMs;
  memoria.dados.x = orb.centroX + Math.cos(orb.angulo) * orb.raio;
  memoria.dados.y = orb.centroY + Math.sin(orb.angulo) * orb.raio;
}

function formatarTempoPassado(ms) {
  const seg = Math.floor(ms / 1000);
  if (seg < 60) return `~${seg}s atrás`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `~${min}m atrás`;
  return `~${Math.floor(min / 60)}h atrás`;
}

export function atualizarVisibilidadeMemoria(planeta, visivelAoJogador, esq, dir, cima, baixo) {
  const memoria = memorias.get(planeta);
  if (!memoria) return;

  const deveMostrar = memoria.conhecida && !visivelAoJogador;
  memoria._alphaAlvo = deveMostrar ? 1 : 0;

  const memoriaDados = memoria.dados;
  const memoriaNaTela =
    !!memoriaDados &&
    memoriaDados.x > esq && memoriaDados.x < dir &&
    memoriaDados.y > cima && memoriaDados.y < baixo;

  if (deveMostrar && memoriaNaTela) {
    memoria.visual.visible = true;
    memoria.visual.x = memoriaDados.x;
    memoria.visual.y = memoriaDados.y;

    const agora = performance.now();
    const tempoTexto = formatarTempoPassado(agora - memoriaDados.timestamp);
    if (memoria.tempoLabel.text !== tempoTexto) {
      memoria.tempoLabel.text = tempoTexto;
    }
  } else {
    if (memoria.visual.alpha <= 0.01) {
      memoria.visual.visible = false;
    }
  }

  // Fade in/out
  if (memoria.visual.visible) {
    const diff = memoria._alphaAlvo - memoria.visual.alpha;
    if (Math.abs(diff) > 0.01) {
      memoria.visual.alpha += diff * FADE_VELOCIDADE > 0
        ? Math.min(diff, FADE_VELOCIDADE)
        : Math.max(diff, -FADE_VELOCIDADE);
    } else {
      memoria.visual.alpha = memoria._alphaAlvo;
    }
  }
}

export function atualizarEscalaLabelMemoria(planeta, zoom) {
  const memoria = memorias.get(planeta);
  if (!memoria?.visual.visible) return;

  const escalaInversa = 1 / Math.max(zoom, 0.1);
  const escala = Math.min(Math.max(escalaInversa, 0.5), 2.5);
  memoria.info.scale.set(escala);
  memoria.infoBg.scale.set(escala);
  memoria.tempoLabel.scale.set(escala);
}

export function removerMemoriaPlaneta(mundo, planeta) {
  const memoria = memorias.get(planeta);
  if (!memoria) return;
  mundo.memoriaPlanetasContainer.removeChild(memoria.visual);
  memoria.visual.destroy({ children: true });
  memorias.delete(planeta);
}

let _neblinaSuja = true;
let _fontesAnteriores = [];

const THRESHOLD_MUDANCA = 400; // px² — só redesenha se fonte moveu >20px

function fontesVisaoMudaram(novas) {
  if (novas.length !== _fontesAnteriores.length) return true;
  for (let i = 0; i < novas.length; i++) {
    const a = _fontesAnteriores[i];
    const b = novas[i];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy > THRESHOLD_MUDANCA || a.raio !== b.raio) return true;
  }
  return false;
}

export function marcarNeblinaSuja() {
  _neblinaSuja = true;
}

// Camadas de neblina — da borda da visão para fora
// Cada anel: [offset do raio (mult), largura do stroke, alpha, cor]
const CAMADAS_NEBLINA = [
  // Névoa densa exterior — escura e larga
  [1.30, 200, 0.30, 0x020510],
  [1.18, 140, 0.25, 0x030818],
  [1.10, 100, 0.20, 0x050c20],
  // Transição média
  [1.05, 70,  0.16, 0x081028],
  [1.02, 50,  0.12, 0x0a1430],
  // Borda suave — mais clara e fina
  [1.00, 30,  0.08, 0x102040],
  [0.97, 15,  0.05, 0x1a3060],
  // Glow interno sutil
  [0.93, 6,   0.03, 0x2a50aa],
];

export function desenharNeblinaVisao(mundo, fontesVisao) {
  if (!_neblinaSuja && !fontesVisaoMudaram(fontesVisao)) return;

  const g = mundo.visaoContainer;
  g.clear();

  for (const fonte of fontesVisao) {
    for (const [mult, largura, alpha, cor] of CAMADAS_NEBLINA) {
      g.circle(fonte.x, fonte.y, fonte.raio * mult).stroke({
        color: cor,
        width: largura,
        alpha,
      });
    }
  }

  _fontesAnteriores = fontesVisao.map(f => ({ x: f.x, y: f.y, raio: f.raio }));
  _neblinaSuja = false;
}
