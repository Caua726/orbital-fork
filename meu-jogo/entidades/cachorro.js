import { Assets, AnimatedSprite, Spritesheet, SCALE_MODES } from 'pixi.js';

const FRAME_W = 16;
const FRAME_H = 16;
const LINHAS_CONFIG = [
  { nome: 'idle', colunas: 6 },
  { nome: 'andar', colunas: 6 },
  { nome: 'esquiva', colunas: 6 },
  { nome: 'pulo', colunas: 6 },
  { nome: 'pulo2', colunas: 4 },
];

export async function criarCachorro(app, areaJogo) {
  const texture = await Assets.load('../assets/cachorro_branco.png');
  texture.source.scaleMode = SCALE_MODES.NEAREST;

  const frames = {};
  const animacoes = {};

  for (let linha = 0; linha < LINHAS_CONFIG.length; linha++) {
    const { nome, colunas } = LINHAS_CONFIG[linha];
    animacoes[nome] = [];
    for (let col = 0; col < colunas; col++) {
      const id = `cachorro_${linha}_${col}`;
      frames[id] = {
        frame: { x: col * FRAME_W, y: linha * FRAME_H, w: FRAME_W, h: FRAME_H },
        sourceSize: { w: FRAME_W, h: FRAME_H },
        spriteSourceSize: { x: 0, y: 0, w: FRAME_W, h: FRAME_H },
      };
      animacoes[nome].push(id);
    }
  }

  const sheet = new Spritesheet(texture, {
    frames,
    meta: { scale: 1 },
    animations: animacoes,
  });
  await sheet.parse();

  const escala = 5;
  const sprite = new AnimatedSprite(sheet.animations['idle']);
  sprite.animationSpeed = 0.05;
  sprite.play();
  sprite.scale.set(escala);
  sprite.anchor.set(0.5);
  sprite.x = app.screen.width / 2 - 120;
  sprite.y = areaJogo.top + areaJogo.height / 2;
  sprite._sheet = sheet;
  sprite._escala = escala;

  return sprite;
}

export function atualizarCachorro(cachorro, alvo, areaJogo, velocidade) {
  const dx = alvo.x - cachorro.x;
  const dy = alvo.y - cachorro.y;
  const dist = Math.hypot(dx, dy);
  const distanciaMinima = 48;

  if (dist > distanciaMinima && dist > 0.001) {
    cachorro.x += (dx / dist) * velocidade;
    cachorro.y += (dy / dist) * velocidade;

    cachorro.scale.x = dx < 0 ? -cachorro._escala : cachorro._escala;

    if (cachorro._animAtual !== 'andar') {
      cachorro.textures = cachorro._sheet.animations['andar'];
      cachorro.animationSpeed = 0.15;
      cachorro.play();
      cachorro._animAtual = 'andar';
    }
  } else {
    if (cachorro._animAtual !== 'idle') {
      cachorro.textures = cachorro._sheet.animations['idle'];
      cachorro.animationSpeed = 0.05;
      cachorro.play();
      cachorro._animAtual = 'idle';
    }
  }

  const m = 20;
  cachorro.x = Math.max(areaJogo.left + m, Math.min(areaJogo.right - m, cachorro.x));
  cachorro.y = Math.max(areaJogo.top + m, Math.min(areaJogo.bottom - m, cachorro.y));
}
