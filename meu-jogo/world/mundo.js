import { Container, Graphics, Text } from 'pixi.js';
import { criarFundo, atualizarFundo } from './fundo.js';
import { criarPlaneta, criarPlanetaSprite } from './planeta.js';

const DONOS = {
  neutro: 0x888888,
  jogador: 0x44aaff,
  inimigo1: 0xff4444,
  inimigo2: 0xffaa00,
  inimigo3: 0xaa44ff,
};

let estadoJogo = 'jogando';

export function getEstadoJogo() {
  return estadoJogo;
}

export async function criarMundo(app, tipoJogador) {
  const tamanho = Math.max(window.innerWidth, window.innerHeight) * 30;
  const container = new Container();

  const fundo = criarFundo(tamanho);
  container.addChild(fundo);

  const planetaSheet = await criarPlaneta(app);
  const planetas = [];
  const frotas = [];
  const frotasContainer = new Container();
  const grid = 15;
  const celula = tamanho / grid;
  const DIST_MIN = 1200;

  function muitoPerto(x, y) {
    for (const p of planetas) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < DIST_MIN * DIST_MIN) return true;
    }
    return false;
  }

  for (let gx = 0; gx < grid; gx++) {
    for (let gy = 0; gy < grid; gy++) {
      let x, y, tentativas = 0;
      do {
        x = gx * celula + Math.random() * celula;
        y = gy * celula + Math.random() * celula;
        tentativas++;
      } while (muitoPerto(x, y) && tentativas < 10);

      if (tentativas >= 10) continue;

      const tam = 200 + Math.random() * 250;
      const p = criarPlanetaSprite(planetaSheet, x, y, tam);

      // Dados de gameplay
      p.dados = {
        dono: 'neutro',
        tropas: Math.floor(Math.random() * 20 + 5),
        producao: 0.5 + Math.random() * 1.5,
        tamanho: tam,
        selecionado: false,
      };

      // Label de tropas
      const label = new Text({ text: '', style: { fontSize: 16, fill: 0xffffff, fontFamily: 'monospace' } });
      label.anchor.set(0.5);
      label.y = tam / 2 + 14;
      p.addChild(label);
      p._label = label;

      // Anel de dono
      const anel = new Graphics();
      p.addChild(anel);
      p._anel = anel;

      p.visible = false;
      container.addChild(p);
      planetas.push(p);
    }
  }

  container.addChild(frotasContainer);

  const mundo = { container, tamanho, planetas, fundo, frotas, frotasContainer, planetaSheet };

  // Definir planeta do jogador (perto do centro)
  let maisPertoDocentro = planetas[0];
  let menorDist = Infinity;
  for (const p of planetas) {
    const d = Math.hypot(p.x - tamanho / 2, p.y - tamanho / 2);
    if (d < menorDist) {
      menorDist = d;
      maisPertoDocentro = p;
    }
  }
  maisPertoDocentro.dados.dono = 'jogador';
  const tropasBase = 30;
  const multTropas = tipoJogador?.bonus?.tropasIniciais || 1;
  const multProd = tipoJogador?.bonus?.producao || 1;
  maisPertoDocentro.dados.tropas = tropasBase * multTropas;
  maisPertoDocentro.dados.producao *= multProd;

  // Alguns inimigos
  const inimigos = ['inimigo1', 'inimigo2', 'inimigo3'];
  const cantos = [
    { x: tamanho * 0.15, y: tamanho * 0.15 },
    { x: tamanho * 0.85, y: tamanho * 0.15 },
    { x: tamanho * 0.15, y: tamanho * 0.85 },
  ];

  for (let i = 0; i < inimigos.length; i++) {
    let maisPertoDocanto = planetas[0];
    let md = Infinity;
    for (const p of planetas) {
      if (p.dados.dono !== 'neutro') continue;
      const d = Math.hypot(p.x - cantos[i].x, p.y - cantos[i].y);
      if (d < md) { md = d; maisPertoDocanto = p; }
    }
    maisPertoDocanto.dados.dono = inimigos[i];
    maisPertoDocanto.dados.tropas = 30;
  }

  estadoJogo = 'jogando';

  return mundo;
}

export function atualizarMundo(mundo, app, camera) {
  const zoom = camera.zoom || 1;
  const camX = camera.x + app.screen.width / 2;
  const camY = camera.y + app.screen.height / 2;

  // Fundo chunking
  atualizarFundo(mundo.fundo, camX, camY, app.screen.width, app.screen.height);

  // Culling margins adjusted by zoom
  const margem = 500 / zoom;
  const esq = camera.x - margem;
  const dir = camera.x + app.screen.width / zoom + margem;
  const cima = camera.y - margem;
  const baixo = camera.y + app.screen.height / zoom + margem;

  for (const p of mundo.planetas) {
    // Production runs for ALL non-neutral planets regardless of visibility
    if (p.dados.dono !== 'neutro') {
      p.dados.tropas += p.dados.producao / 60;
    }

    const vis = p.x > esq && p.x < dir && p.y > cima && p.y < baixo;
    if (vis && !p.visible) p.play();
    else if (!vis && p.visible) p.stop();
    p.visible = vis;

    if (vis) {
      // Atualizar label
      p._label.text = Math.floor(p.dados.tropas);

      // Atualizar anel
      const anel = p._anel;
      anel.clear();
      const cor = DONOS[p.dados.dono] || 0x888888;
      const raio = p.dados.tamanho / 2 + 5;
      const largura = p.dados.selecionado ? 4 : 2;
      anel.circle(0, 0, raio).stroke({ color: cor, width: largura, alpha: 0.8 });
    }
  }

  // Atualizar frotas
  atualizarFrotas(mundo);

  // Victory/defeat check
  verificarEstadoJogo(mundo);
}

function verificarEstadoJogo(mundo) {
  if (estadoJogo !== 'jogando') return;

  let jogadorTemPlaneta = false;
  let todosSaoJogadorOuNeutro = true;

  for (const p of mundo.planetas) {
    if (p.dados.dono === 'jogador') {
      jogadorTemPlaneta = true;
    }
    if (p.dados.dono !== 'jogador' && p.dados.dono !== 'neutro') {
      todosSaoJogadorOuNeutro = false;
    }
  }

  if (!jogadorTemPlaneta) {
    estadoJogo = 'derrota';
  } else if (todosSaoJogadorOuNeutro) {
    estadoJogo = 'vitoria';
  }
}

const TRAIL_LENGTH = 5;

function atualizarFrotas(mundo) {
  const { frotas, frotasContainer } = mundo;

  for (let i = frotas.length - 1; i >= 0; i--) {
    const f = frotas[i];
    const dx = f.destino.x - f.x;
    const dy = f.destino.y - f.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 20) {
      // Chegou ao destino
      if (f.destino.dados.dono === f.dono) {
        f.destino.dados.tropas += f.qtd;
      } else {
        f.destino.dados.tropas -= f.qtd;
        if (f.destino.dados.tropas < 0) {
          f.destino.dados.dono = f.dono;
          f.destino.dados.tropas = Math.abs(f.destino.dados.tropas);
        }
      }

      if (f.gfx) frotasContainer.removeChild(f.gfx);
      frotas.splice(i, 1);
      continue;
    }

    // Save previous position for trail
    if (!f.trail) f.trail = [];
    f.trail.push({ x: f.x, y: f.y });
    if (f.trail.length > TRAIL_LENGTH) f.trail.shift();

    f.x += (dx / dist) * f.velocidade;
    f.y += (dy / dist) * f.velocidade;

    const angulo = Math.atan2(dy, dx);
    const cor = DONOS[f.dono] || 0xffffff;

    // Criar/atualizar visual
    if (!f.gfx) {
      const g = new Container();
      const shape = new Graphics();
      g.addChild(shape);
      g._shape = shape;

      const label = new Text({
        text: '',
        style: { fontSize: 10, fill: 0xffffff, fontFamily: 'monospace' },
      });
      label.anchor.set(0.5);
      label.y = -14;
      g.addChild(label);
      g._label = label;

      const trailGfx = new Graphics();
      g.addChild(trailGfx);
      g._trail = trailGfx;

      frotasContainer.addChild(g);
      f.gfx = g;
    }

    // Draw triangle pointing toward destination
    const shape = f.gfx._shape;
    shape.clear();
    const size = 8;
    shape
      .poly([
        Math.cos(angulo) * size, Math.sin(angulo) * size,
        Math.cos(angulo + 2.4) * size * 0.6, Math.sin(angulo + 2.4) * size * 0.6,
        Math.cos(angulo - 2.4) * size * 0.6, Math.sin(angulo - 2.4) * size * 0.6,
      ])
      .fill({ color: cor });

    // Update label
    f.gfx._label.text = Math.floor(f.qtd);

    // Draw trail
    const trailGfx = f.gfx._trail;
    trailGfx.clear();
    for (let t = 0; t < f.trail.length; t++) {
      const alpha = (t + 1) / (f.trail.length + 1) * 0.5;
      const r = 2 + (t / f.trail.length) * 2;
      trailGfx.circle(f.trail[t].x - f.x, f.trail[t].y - f.y, r).fill({ color: cor, alpha });
    }

    f.gfx.x = f.x;
    f.gfx.y = f.y;
  }
}
