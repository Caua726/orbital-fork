import { Container, Graphics, Text, AnimatedSprite } from 'pixi.js';
import type { Planeta, Mundo, FonteVisao, Camera } from '../types';
import {
  aplicarAparenciaTipoPlaneta,
  criarPlanetaSprite,
  nomeTipoPlaneta,
} from './planeta';

interface MemoriaPlanetaDados {
  dono: string;
  tipoPlaneta: string;
  tamanho: number;
  fabricas: number;
  infraestrutura: number;
  naves: number;
  producao: number;
}

interface MemoriaPlanetaSnapshot {
  x: number;
  y: number;
  frame: number;
  timestamp: number;
  dados: MemoriaPlanetaDados;
}

interface MemoriaPlaneta {
  conhecida: boolean;
  visual: Container;
  fantasma: AnimatedSprite;
  anel: Graphics;
  infoBg: Graphics;
  info: Text;
  tempoLabel: Text;
  dados: MemoriaPlanetaSnapshot | null;
  _textoAnterior: string;
}

const ALPHA_FANTASMA = 0.32;
const ALPHA_FANTASMA_ANEL = 0.3;
const COR_ANEL_FANTASMA = 0x8aa4bd;
const DISTANCIA_LABEL_MEMORIA = 18;

function nomeDonoCurto(dono: string): string {
  if (dono === 'jogador') return 'Seu';
  if (dono === 'neutro') return 'Neutro';
  return dono || '?';
}

function capturarMemoriaPlaneta(planeta: Planeta): MemoriaPlanetaSnapshot {
  return {
    x: planeta.x,
    y: planeta.y,
    frame: planeta.currentFrame ?? 0,
    timestamp: performance.now(),
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

function dadosMudaram(anterior: MemoriaPlanetaSnapshot | null, atual: MemoriaPlanetaSnapshot): boolean {
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
const memorias: WeakMap<Planeta, MemoriaPlaneta> = new WeakMap();

export function getMemoria(planeta: Planeta): MemoriaPlaneta | null {
  return memorias.get(planeta) || null;
}

export function criarCamadaMemoria(): Container {
  const container = new Container();
  container.eventMode = 'none';
  return container;
}

export function criarMemoriaVisualPlaneta(mundo: Mundo, planeta: Planeta): void {
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
  };

  memorias.set(planeta, memoria);
}

function redesenharVisualMemoria(memoria: MemoriaPlaneta): void {
  const { dados } = memoria;
  if (!dados) return;

  const tamanho = dados.dados.tamanho;

  memoria.fantasma.width = tamanho;
  memoria.fantasma.height = tamanho;
  memoria.fantasma.gotoAndStop(dados.frame ?? 0);
  memoria.fantasma.alpha = ALPHA_FANTASMA;
  aplicarAparenciaTipoPlaneta(memoria.fantasma, dados.dados.tipoPlaneta);

  memoria.anel.clear();
  const larguraAnel = 1.1;
  const raioAnel = Math.max(10, tamanho * 0.42 - larguraAnel * 0.5);
  memoria.anel.circle(0, 0, raioAnel).stroke({
    color: COR_ANEL_FANTASMA,
    width: larguraAnel,
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

export function registrarMemoriaPlaneta(planeta: Planeta): void {
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



function formatarTempoPassado(ms: number): string {
  const seg = Math.floor(ms / 1000);
  if (seg < 60) return `~${seg}s atrás`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `~${min}m atrás`;
  return `~${Math.floor(min / 60)}h atrás`;
}

export function atualizarVisibilidadeMemoria(planeta: Planeta, visivelAoJogador: boolean, esq: number, dir: number, cima: number, baixo: number): void {
  const memoria = memorias.get(planeta);
  if (!memoria) return;

  const memoriaDados = memoria.dados;
  const deveMostrar = memoria.conhecida && !visivelAoJogador && !!memoriaDados;
  const memoriaNaTela = deveMostrar &&
    memoriaDados.x > esq && memoriaDados.x < dir &&
    memoriaDados.y > cima && memoriaDados.y < baixo;

  if (deveMostrar && memoriaNaTela) {
    memoria.visual.visible = true;
    memoria.visual.x = memoriaDados.x;
    memoria.visual.y = memoriaDados.y;
    memoria.visual.alpha = ALPHA_FANTASMA + 0.15;

    const agora = performance.now();
    const tempoTexto = formatarTempoPassado(agora - memoriaDados.timestamp);
    if (memoria.tempoLabel.text !== tempoTexto) {
      memoria.tempoLabel.text = tempoTexto;
    }
  } else {
    memoria.visual.visible = false;
  }
}

export function atualizarEscalaLabelMemoria(planeta: Planeta, zoom: number): void {
  const memoria = memorias.get(planeta);
  if (!memoria?.visual.visible) return;

  const escalaInversa = 1 / Math.max(zoom, 0.1);
  const escala = Math.min(Math.max(escalaInversa, 0.5), 2.5);
  memoria.info.scale.set(escala);
  memoria.infoBg.scale.set(escala);
  memoria.tempoLabel.scale.set(escala);
}

export function removerMemoriaPlaneta(mundo: Mundo, planeta: Planeta): void {
  const memoria = memorias.get(planeta);
  if (!memoria) return;
  mundo.memoriaPlanetasContainer.removeChild(memoria.visual);
  memoria.visual.destroy({ children: true });
  memorias.delete(planeta);
}

import { Sprite, Texture, ImageSource } from 'pixi.js';
import { config } from '../ui/debug';

const FOG_MAX_W = 960;
const FOG_MAX_H = 540;

let _fogCanvas: HTMLCanvasElement | null = null;
let _fogCtx: CanvasRenderingContext2D | null = null;
let _fogSprite: Sprite | null = null;
let _fogSource: ImageSource | null = null;
let _fogTexture: Texture | null = null;
let _fogFrame: number = 0;

/** Sub-profiling do fog */
interface FogProfiling {
  canvas: number;
  upload: number;
}

export const fogProfiling: FogProfiling = { canvas: 0, upload: 0 };
let _fogProfSoma: FogProfiling = { canvas: 0, upload: 0 };
let _fogProfFrames: number = 0;

export function desenharNeblinaVisao(mundo: Mundo, fontesVisao: FonteVisao[], camera: Camera, screenW: number, screenH: number, zoom: number): void {
  _fogFrame++;

  const invZoom = 1 / (zoom || 1);
  const margem = 1500 * invZoom;

  const worldX = camera.x - margem;
  const worldY = camera.y - margem;
  const worldW = screenW * invZoom + margem * 2;
  const worldH = screenH * invZoom + margem * 2;

  // Resolução fixa — nunca muda com zoom
  const canvasW = FOG_MAX_W;
  const canvasH = FOG_MAX_H;
  const scaleX = canvasW / worldW;
  const scaleY = canvasH / worldH;

  if (!_fogCanvas) {
    _fogCanvas = document.createElement('canvas');
    _fogCanvas.width = canvasW;
    _fogCanvas.height = canvasH;
    _fogCtx = _fogCanvas.getContext('2d');
  }

  // Só redesenhar canvas a cada N frames
  const redesenhar = _fogFrame % config.fogThrottle === 0;

  if (redesenhar) {
    const t0 = performance.now();
    const ctx = _fogCtx!;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(2, 5, 16, ${config.fogAlpha})`;
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'white';
    for (const fonte of fontesVisao) {
      const cx = (fonte.x - worldX) * scaleX;
      const cy = (fonte.y - worldY) * scaleY;
      const rx = fonte.raio * scaleX;
      const ry = fonte.raio * scaleY;

      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const t1 = performance.now();
    _fogProfSoma.canvas += t1 - t0;

    // Upload textura
    const visao = mundo.visaoContainer;

    if (!_fogSprite) {
      _fogSource = new ImageSource({ resource: _fogCanvas });
      _fogTexture = new Texture({ source: _fogSource });
      _fogSprite = new Sprite(_fogTexture);
    }

    // Re-adicionar se foi removido (ex: visaoTotal toggle)
    if (!_fogSprite.parent) {
      visao.addChild(_fogSprite);
    }

    _fogSource!.resource = _fogCanvas;
    _fogSource!.update();

    _fogProfSoma.upload += performance.now() - t1;
    _fogProfFrames++;

    if (_fogProfFrames >= 10) {
      fogProfiling.canvas = _fogProfSoma.canvas / _fogProfFrames;
      fogProfiling.upload = _fogProfSoma.upload / _fogProfFrames;
      _fogProfSoma = { canvas: 0, upload: 0 };
      _fogProfFrames = 0;
    }
  }

  // Posição do sprite atualiza todo frame (câmera move)
  if (_fogSprite) {
    _fogSprite.x = worldX;
    _fogSprite.y = worldY;
    _fogSprite.width = worldW;
    _fogSprite.height = worldH;
  }
}
