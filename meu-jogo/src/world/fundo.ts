import { Sprite, Texture, Container } from 'pixi.js';

const TILE = 2048;

interface TileSprite extends Sprite {
  _tx: number;
  _ty: number;
}

interface FundoContainer extends Container {
  _tileSprites: TileSprite[];
  _cache: Map<string, Texture>;
  _tamanhoMundo: number;
}

function gerarTile(w: number, h: number, seed: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  // Seed simples para estrelas consistentes por tile
  let s = seed;
  const rand = (): number => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };

  const estrelas = 180;
  for (let i = 0; i < estrelas; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rand() * 1.5 + 0.3;
    const brilho = Math.floor(rand() * 155 + 100);
    ctx.fillStyle = `rgb(${brilho},${brilho},${brilho})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return Texture.from(canvas);
}

export function criarFundo(tamanhoMundo: number): FundoContainer {
  const tilesX = Math.ceil(tamanhoMundo / TILE);
  const tilesY = Math.ceil(tamanhoMundo / TILE);

  const container = new Container() as FundoContainer;
  const cache = new Map<string, Texture>();

  // Placeholder: cria sprites vazios para todos os tiles
  const tileSprites: TileSprite[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const sprite = new Sprite() as TileSprite;
      sprite.x = tx * TILE;
      sprite.y = ty * TILE;
      sprite.visible = false;
      sprite._tx = tx;
      sprite._ty = ty;
      container.addChild(sprite);
      tileSprites.push(sprite);
    }
  }

  container._tileSprites = tileSprites;
  container._cache = cache;
  container._tamanhoMundo = tamanhoMundo;

  return container;
}

export function atualizarFundo(fundo: FundoContainer, jogadorX: number, jogadorY: number, telaW: number, telaH: number): void {
  const margem = TILE;
  const esq = jogadorX - telaW / 2 - margem;
  const dir = jogadorX + telaW / 2 + margem;
  const cima = jogadorY - telaH / 2 - margem;
  const baixo = jogadorY + telaH / 2 + margem;

  const cache = fundo._cache;
  const tamanhoMundo = fundo._tamanhoMundo;

  for (const sprite of fundo._tileSprites) {
    const tx = sprite._tx;
    const ty = sprite._ty;
    const px = tx * TILE;
    const py = ty * TILE;
    const visivel = px + TILE > esq && px < dir && py + TILE > cima && py < baixo;

    sprite.visible = visivel;

    if (visivel && !(sprite.texture as any).valid) {
      const key = `${tx}_${ty}`;
      if (!cache.has(key)) {
        const w = Math.min(TILE, tamanhoMundo - px);
        const h = Math.min(TILE, tamanhoMundo - py);
        cache.set(key, gerarTile(w, h, tx * 7919 + ty * 104729 + 1));
      }
      sprite.texture = cache.get(key)!;
    }
  }

  // Limpar tiles distantes do cache (manter só os próximos)
  if (cache.size > 25) {
    for (const [key] of cache) {
      const [tx, ty] = key.split('_').map(Number);
      const px = tx * TILE;
      const py = ty * TILE;
      if (px + TILE < esq - TILE || px > dir + TILE || py + TILE < cima - TILE || py > baixo + TILE) {
        cache.delete(key);
      }
    }
  }
}
