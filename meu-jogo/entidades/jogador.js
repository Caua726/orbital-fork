import { Graphics, Sprite, Assets } from 'pixi.js';

const teclas = {};

export function configurarControles() {
  const down = (e) => {
    teclas[e.code] = true;
  };
  const up = (e) => {
    teclas[e.code] = false;
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
}

export async function criarJogador(app, areaJogo) {
  const jogador = await Assets.load('../assets/Personagem.jpeg');
  const sprite = new Sprite(jogador);
  sprite.width = 100;
  sprite.height = 150;
  sprite.x = app.screen.width / 2;
  sprite.y = areaJogo.top + areaJogo.height / 2;
  return sprite;
}

export function atualizarJogador(jogador, areaJogo, velocidade) {
  if (teclas.KeyW) jogador.y -= velocidade;
  if (teclas.KeyS) jogador.y += velocidade;
  if (teclas.KeyA) jogador.x -= velocidade;
  if (teclas.KeyD) jogador.x += velocidade;

  const m = 24;
  jogador.x = Math.max(areaJogo.left + m, Math.min(areaJogo.right - m, jogador.x));
  jogador.y = Math.max(areaJogo.top + m, Math.min(areaJogo.bottom - m, jogador.y));
}
