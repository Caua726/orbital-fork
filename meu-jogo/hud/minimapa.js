import { Graphics, Container } from 'pixi.js';

const TAMANHO_MAPA = 220;
const MARGEM = 15;

const CORES_DONO = {
  neutro: 0x888888,
  jogador: 0x44aaff,
  inimigo1: 0xff4444,
  inimigo2: 0xffaa00,
  inimigo3: 0xaa44ff,
};

let _clickCallback = null;

export function onMinimapClick(cb) {
  _clickCallback = cb;
}

export function criarMinimapa(app, mundo) {
  const container = new Container();

  const bg = new Graphics();
  bg.roundRect(0, 0, TAMANHO_MAPA, TAMANHO_MAPA, 8).fill({ color: 0x000000, alpha: 0.65 });
  bg.roundRect(0, 0, TAMANHO_MAPA, TAMANHO_MAPA, 8).stroke({ color: 0x555555, width: 1 });
  container.addChild(bg);

  const fleetLines = new Graphics();
  container.addChild(fleetLines);

  const dots = new Graphics();
  container.addChild(dots);

  const viewport = new Graphics();
  container.addChild(viewport);

  container._dots = dots;
  container._fleetLines = fleetLines;
  container._viewport = viewport;
  container._mundo = mundo;

  container.x = app.screen.width - TAMANHO_MAPA - MARGEM;
  container.y = app.screen.height - TAMANHO_MAPA - MARGEM;

  // Click handling
  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.on('pointertap', (e) => {
    if (!_clickCallback) return;
    const local = container.toLocal(e.global);
    const escala = TAMANHO_MAPA / mundo.tamanho;
    const worldX = local.x / escala;
    const worldY = local.y / escala;
    _clickCallback(worldX, worldY);
  });

  return container;
}

export function atualizarMinimapa(minimapa, camera, app) {
  const mundo = minimapa._mundo;
  const escala = TAMANHO_MAPA / mundo.tamanho;

  // Planetas
  const dots = minimapa._dots;
  dots.clear();
  for (const p of mundo.planetas) {
    const mx = p.x * escala;
    const my = p.y * escala;
    const r = Math.max(2, (p.dados.tamanho * escala) / 2);
    const cor = CORES_DONO[p.dados.dono] || 0x888888;
    dots.circle(mx, my, Math.min(r, 5)).fill({ color: cor });
  }

  // Fleet lines and moving dots
  const fl = minimapa._fleetLines;
  fl.clear();
  for (const f of mundo.frotas) {
    const cor = CORES_DONO[f.dono] || 0xffffff;
    // Fleet dot (moving)
    const fx = f.x * escala;
    const fy = f.y * escala;
    dots.circle(fx, fy, 1.5).fill({ color: cor });

    // Line from current position to destination
    if (f.destino) {
      const dx = f.destino.x * escala;
      const dy = f.destino.y * escala;
      fl.moveTo(fx, fy).lineTo(dx, dy).stroke({ color: cor, width: 0.5, alpha: 0.4 });
    }
  }

  // Viewport rectangle
  const vp = minimapa._viewport;
  vp.clear();
  const zoom = camera.zoom || 1;
  const vx = camera.x * escala;
  const vy = camera.y * escala;
  const vw = (app.screen.width / zoom) * escala;
  const vh = (app.screen.height / zoom) * escala;
  vp.rect(vx, vy, vw, vh).stroke({ color: 0xffffff, width: 0.8, alpha: 0.6 });

  minimapa.x = app.screen.width - TAMANHO_MAPA - MARGEM;
  minimapa.y = app.screen.height - TAMANHO_MAPA - MARGEM;
}
