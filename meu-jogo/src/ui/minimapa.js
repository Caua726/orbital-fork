import { Graphics, Container, Text } from 'pixi.js';

const TAMANHO_MAPA = 210;
const MARGEM = 16;

const SP = {
  panelBg: 0x101830,
  panelBgDark: 0x0a1020,
  panelBorder: 0x2a4070,
  cornerAccent: 0x4a80cc,
  titleBg: 0x1a3060,
  titleBgLight: 0x2a5090,
  titleText: 0xa0d0ff,
  diamond: 0x60ccff,
  fieldBg: 0x040810,
  fieldBorder: 0x1a2848,
};

const CORES_DONO = {
  neutro: 0x666666,
  jogador: 0x60ccff,
};

let _clickCallback = null;

export function onMinimapClick(cb) {
  _clickCallback = cb;
}

export function criarMinimapa(app, mundo) {
  const container = new Container();

  const frame = new Graphics();
  container.addChild(frame);
  container._frame = frame;

  const dots = new Graphics();
  container.addChild(dots);

  const fleetLines = new Graphics();
  container.addChild(fleetLines);

  const viewport = new Graphics();
  container.addChild(viewport);

  container._dots = dots;
  container._fleetLines = fleetLines;
  container._viewport = viewport;
  container._mundo = mundo;

  container.x = app.screen.width - TAMANHO_MAPA - MARGEM;
  container.y = app.screen.height - TAMANHO_MAPA - 50;

  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.on('pointertap', (e) => {
    if (!_clickCallback) return;
    const local = container.toLocal(e.global);
    const mapX = 6;
    const mapY = 28;
    const mapSize = TAMANHO_MAPA - 12;
    const escala = mapSize / mundo.tamanho;
    const worldX = (local.x - mapX) / escala;
    const worldY = (local.y - mapY) / escala;
    _clickCallback(worldX, worldY);
  });

  return container;
}

export function atualizarMinimapa(minimapa, camera, app) {
  const mundo = minimapa._mundo;
  const totalW = TAMANHO_MAPA;
  const totalH = TAMANHO_MAPA + 26;
  const mapX = 6;
  const mapY = 28;
  const mapSize = TAMANHO_MAPA - 12;
  const escala = mapSize / mundo.tamanho;

  const frame = minimapa._frame;
  frame.clear();

  // Panel background
  frame.rect(0, 0, totalW, totalH / 2).fill({ color: SP.panelBg });
  frame.rect(0, totalH / 2, totalW, totalH / 2).fill({ color: SP.panelBgDark });
  // Border
  frame.roundRect(0, 0, totalW, totalH, 4).stroke({ color: SP.panelBorder, width: 2 });
  // Corner brackets
  const s = 8;
  frame.moveTo(0, s).lineTo(0, 0).lineTo(s, 0).stroke({ color: SP.cornerAccent, width: 2 });
  frame.moveTo(totalW - s, 0).lineTo(totalW, 0).lineTo(totalW, s).stroke({ color: SP.cornerAccent, width: 2 });
  frame.moveTo(0, totalH - s).lineTo(0, totalH).lineTo(s, totalH).stroke({ color: SP.cornerAccent, width: 2 });
  frame.moveTo(totalW - s, totalH).lineTo(totalW, totalH).lineTo(totalW, totalH - s).stroke({ color: SP.cornerAccent, width: 2 });

  // Title bar
  frame.rect(2, 2, totalW - 4, 22).fill({ color: SP.titleBg });
  frame.rect(2 + (totalW - 4) / 3, 2, (totalW - 4) * 2 / 3, 22).fill({ color: SP.titleBgLight, alpha: 0.5 });
  frame.moveTo(2, 24).lineTo(totalW - 2, 24).stroke({ color: SP.panelBorder, width: 1 });
  // Diamond
  const dx = 12;
  const dy = 13;
  frame.moveTo(dx, dy - 3).lineTo(dx + 3, dy).lineTo(dx, dy + 3).lineTo(dx - 3, dy).lineTo(dx, dy - 3).fill({ color: SP.diamond });
  // Title text (drawn as graphic text)
  // We'll use a separate text object below

  // Sunken map area
  frame.rect(mapX, mapY, mapSize, mapSize).fill({ color: SP.fieldBg });
  frame.rect(mapX, mapY, mapSize, mapSize).stroke({ color: SP.fieldBorder, width: 1 });

  // Bottom padding
  frame.rect(mapX, mapY + mapSize, mapSize, 4).fill({ color: SP.panelBgDark });

  const dots = minimapa._dots;
  dots.clear();
  for (const sol of mundo.sois) {
    if (!sol._visivelAoJogador) continue;
    dots.circle(mapX + sol.x * escala, mapY + sol.y * escala, 2.5).fill({ color: sol._cor || 0xffdd88, alpha: 0.9 });
  }

  for (const p of mundo.planetas) {
    if (!p._visivelAoJogador) continue;
    const mx = mapX + p.x * escala;
    const my = mapY + p.y * escala;
    const r = Math.max(2, (p.dados.tamanho * escala) / 2);
    const cor = CORES_DONO[p.dados.dono] || 0x666666;
    dots.circle(mx, my, Math.min(r, 5)).fill({ color: cor });
  }

  for (const nave of mundo.naves) {
    const mx = mapX + nave.x * escala;
    const my = mapY + nave.y * escala;
    dots.circle(mx, my, 1.4).fill({ color: 0xffffff, alpha: 0.95 });
  }

  const fl = minimapa._fleetLines;
  fl.clear();

  const vp = minimapa._viewport;
  vp.clear();
  const zoom = camera.zoom || 1;
  const vx = mapX + camera.x * escala;
  const vy = mapY + camera.y * escala;
  const vw = (app.screen.width / zoom) * escala;
  const vh = (app.screen.height / zoom) * escala;
  vp.rect(vx, vy, vw, vh).stroke({ color: 0x60ccff, width: 0.8, alpha: 0.4 });

  minimapa.x = app.screen.width - TAMANHO_MAPA - MARGEM;
  minimapa.y = app.screen.height - totalH - MARGEM;
}
