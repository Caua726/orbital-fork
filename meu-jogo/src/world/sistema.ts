import { Assets, AnimatedSprite, Container, Graphics, Texture } from 'pixi.js';
import type { Sol, Planeta, Sistema } from '../types';
import { DIST_MIN_SISTEMA } from './constantes';
import { criarFramesSpriteStrip, criarPlanetaSprite, TIPO_PLANETA } from './planeta';
import type { TexturasPlaneta } from './planeta';
import { criarEstadoPesquisas } from './pesquisa';

function sortearTipoPlaneta(): string {
  const tipos = Object.values(TIPO_PLANETA);
  return tipos[Math.floor(Math.random() * tipos.length)];
}

let texturaSolPromise: Promise<Texture[]> | null = null;

async function carregarTexturaSol(): Promise<Texture[]> {
  if (!texturaSolPromise) {
    texturaSolPromise = Assets.load('/assets/estrela.png').then((texture: Texture) => {
      texture.source.scaleMode = 'nearest';
      return criarFramesSpriteStrip(texture, 128, 128);
    });
  }
  return texturaSolPromise;
}

function criarSol(x: number, y: number, raio: number, cor: number, frames: Texture[]): Sol {
  const sol = new AnimatedSprite(frames) as Sol;
  sol.x = x;
  sol.y = y;
  sol._raio = raio;
  sol._cor = cor;
  sol._tipoAlvo = 'sol';
  sol._visivelAoJogador = false;
  sol._descobertoAoJogador = false;
  sol.anchor.set(0.5);
  sol.width = raio * 2.9;
  sol.height = raio * 2.9;
  sol.tint = 0xffffff;
  sol.animationSpeed = 0.10;
  sol.gotoAndPlay(Math.floor(Math.random() * frames.length));
  return sol;
}

export async function criarSistemaSolar(container: Container, orbitasContainer: Container, planetaSheet: TexturasPlaneta, centroX: number, centroY: number, indiceSistema: number): Promise<Sistema> {
  const corSol = [0xffd166, 0xffb703, 0xfff1a8, 0xf4a261][indiceSistema % 4];
  const quantidadePlanetas = 1 + Math.floor(Math.random() * 5);
  const tamanhosPlaneta = Array.from({ length: quantidadePlanetas }, () => 140 + Math.random() * 170);
  const maiorPlaneta = Math.max(...tamanhosPlaneta);
  const raioSol = Math.max(110 + Math.random() * 60, maiorPlaneta * 0.7);
  const texturaSol = await carregarTexturaSol();
  const sol = criarSol(centroX, centroY, raioSol, corSol, texturaSol);
  sol.visible = false;
  container.addChild(sol);

  const planetas: Planeta[] = [];
  let ultimoRaioOrbita = raioSol;
  let ultimoRaioPlaneta = 0;
  const margemEntreOrbital = 90;

  for (let i = 0; i < quantidadePlanetas; i++) {
    const tamanho = tamanhosPlaneta[i];
    const raioPlaneta = tamanho / 2;
    const distanciaMinDoSol = raioSol + raioPlaneta + 220;
    const distanciaMinDoAnterior = ultimoRaioOrbita + ultimoRaioPlaneta + raioPlaneta + margemEntreOrbital;
    const baseOrbita = i === 0 ? distanciaMinDoSol : Math.max(distanciaMinDoSol, distanciaMinDoAnterior);
    const raioOrbita = baseOrbita + Math.random() * 70;
    const anguloInicial = Math.random() * Math.PI * 2;
    const velocidade = 0.00003 + Math.random() * 0.000025;
    const tipoPlaneta = sortearTipoPlaneta();
    const linhaOrbita = new Graphics();
    linhaOrbita.visible = false;
    linhaOrbita.circle(centroX, centroY, raioOrbita).stroke({
      color: corSol,
      width: 2,
      alpha: 0.3,
    });
    orbitasContainer.addChild(linhaOrbita);
    const p = criarPlanetaSprite(
      planetaSheet,
      centroX + Math.cos(anguloInicial) * raioOrbita,
      centroY + Math.sin(anguloInicial) * raioOrbita,
      tamanho,
      tipoPlaneta
    ) as unknown as Planeta;

    p.dados = {
      dono: 'neutro',
      tipoPlaneta,
      producao: 1,
      recursos: { comum: 0, raro: 0, combustivel: 0 },
      tamanho,
      selecionado: false,
      fabricas: 0,
      infraestrutura: 0,
      naves: 0,
      acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 },
      sistemaId: indiceSistema,
      construcaoAtual: null,
      producaoNave: null,
      filaProducao: [],
      repetirFilaProducao: false,
      pesquisas: criarEstadoPesquisas(),
      pesquisaAtual: null,
    };
    p._tipoAlvo = 'planeta';
    p._orbita = {
      centroX,
      centroY,
      raio: raioOrbita,
      angulo: anguloInicial,
      velocidade,
    };
    p._linhaOrbita = linhaOrbita;
    p._visivelAoJogador = false;
    p._descobertoAoJogador = false;

    const anel = new Graphics();
    p.addChild(anel);
    p._anel = anel;

    const construcoes = new Graphics();
    p.addChild(construcoes);
    p._construcoes = construcoes;

    p.visible = false;
    container.addChild(p);
    planetas.push(p);
    ultimoRaioOrbita = raioOrbita;
    ultimoRaioPlaneta = raioPlaneta;
  }

  return { x: centroX, y: centroY, sol, planetas };
}

export { DIST_MIN_SISTEMA };
