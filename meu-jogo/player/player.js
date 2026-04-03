import { Graphics, Text } from 'pixi.js';

const camera = { x: 0, y: 0, zoom: 1 };
let _tipoJogador = null;

// Camera drag (right/middle click)
let cameraDragging = false;
let cameraLastMouse = { x: 0, y: 0 };

// Troop send drag (left click on own planet)
let dragOrigem = null;
let dragActive = false;
let dragMouse = { x: 0, y: 0 };
let dragLine = null;
let dragPercentage = 50; // 10-100 in steps of 10
let dragText = null;

export function setTipoJogador(tipo) {
  _tipoJogador = tipo;
}

export function getCamera() {
  return camera;
}

export function getZoom() {
  return camera.zoom;
}

export function setCameraPos(x, y) {
  camera.x = x;
  camera.y = y;
}

function screenToWorld(sx, sy, app) {
  return {
    x: (sx - app.screen.width / 2) / camera.zoom + camera.x,
    y: (sy - app.screen.height / 2) / camera.zoom + camera.y,
  };
}

function encontrarPlaneta(mundoX, mundoY, mundo) {
  for (const p of mundo.planetas) {
    const dx = p.x - mundoX;
    const dy = p.y - mundoY;
    const raio = p.dados.tamanho / 2;
    if (dx * dx + dy * dy < raio * raio) return p;
  }
  return null;
}

function enviarTropas(origem, destino, mundo, fracao) {
  const qtd = Math.floor(origem.dados.tropas * fracao);
  if (qtd <= 0) return;

  origem.dados.tropas -= qtd;

  const velBase = 2;
  const velMult = _tipoJogador?.bonus?.velocidadeFrota || 1;

  mundo.frotas.push({
    x: origem.x,
    y: origem.y,
    destino,
    qtd,
    dono: origem.dados.dono,
    velocidade: velBase * velMult,
  });
}

export function configurarCamera(app, mundo) {
  // Create graphics for drag line
  dragLine = new Graphics();
  mundo.container.addChild(dragLine);

  // Create text for percentage display
  dragText = new Text({ text: '', style: { fill: 0xffffff, fontSize: 16, fontFamily: 'monospace' } });
  dragText.visible = false;
  mundo.container.addChild(dragText);

  const canvas = app.canvas;

  // Prevent context menu
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Mouse down
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY, app);
      const planeta = encontrarPlaneta(world.x, world.y, mundo);

      if (planeta && planeta.dados.dono === 'jogador') {
        // Left click on own planet — start troop drag
        dragOrigem = planeta;
        dragActive = true;
        dragMouse.x = e.clientX;
        dragMouse.y = e.clientY;
        dragPercentage = 50;
      } else {
        // Left click on empty/other — camera drag
        cameraDragging = true;
        cameraLastMouse.x = e.clientX;
        cameraLastMouse.y = e.clientY;
      }
    } else if (e.button === 1 || e.button === 2) {
      cameraDragging = true;
      cameraLastMouse.x = e.clientX;
      cameraLastMouse.y = e.clientY;
    }
  });

  // Mouse move
  canvas.addEventListener('mousemove', (e) => {
    if (cameraDragging) {
      const dx = e.clientX - cameraLastMouse.x;
      const dy = e.clientY - cameraLastMouse.y;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      cameraLastMouse.x = e.clientX;
      cameraLastMouse.y = e.clientY;
      return;
    }

    if (dragActive) {
      dragMouse.x = e.clientX;
      dragMouse.y = e.clientY;
    }
  });

  // Mouse up
  window.addEventListener('mouseup', (e) => {
    if (cameraDragging) {
      cameraDragging = false;
    }

    if (e.button === 0 && dragActive) {
      const world = screenToWorld(e.clientX, e.clientY, app);
      const destino = encontrarPlaneta(world.x, world.y, mundo);

      if (destino && destino !== dragOrigem) {
        enviarTropas(dragOrigem, destino, mundo, dragPercentage / 100);
      }

      dragActive = false;
      dragOrigem = null;
      dragLine.clear();
      dragText.visible = false;
    }
  });

  // Wheel — zoom or adjust percentage
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    if (dragActive) {
      // Adjust troop percentage while dragging
      if (e.deltaY < 0) {
        dragPercentage = Math.min(100, dragPercentage + 10);
      } else {
        dragPercentage = Math.max(10, dragPercentage - 10);
      }
      return;
    }

    // Zoom toward mouse position
    const mouseWorld = screenToWorld(e.clientX, e.clientY, app);
    const oldZoom = camera.zoom;

    if (e.deltaY < 0) {
      camera.zoom = Math.min(2.0, camera.zoom * 1.1);
    } else {
      camera.zoom = Math.max(0.3, camera.zoom / 1.1);
    }

    // Adjust camera so the world point under the mouse stays in place
    camera.x = mouseWorld.x - (e.clientX - app.screen.width / 2) / camera.zoom;
    camera.y = mouseWorld.y - (e.clientY - app.screen.height / 2) / camera.zoom;
  }, { passive: false });
}

export function atualizarCamera(mundo, app) {
  mundo.container.scale.set(camera.zoom);
  mundo.container.x = -camera.x * camera.zoom + app.screen.width / 2;
  mundo.container.y = -camera.y * camera.zoom + app.screen.height / 2;

  // Draw drag line
  if (dragActive && dragOrigem && dragLine) {
    const world = screenToWorld(dragMouse.x, dragMouse.y, app);

    dragLine.clear();
    dragLine.moveTo(dragOrigem.x, dragOrigem.y);
    dragLine.lineTo(world.x, world.y);
    dragLine.stroke({ width: 2 / camera.zoom, color: 0x00ffff, alpha: 0.8 });

    // Show percentage text near cursor in world coords
    dragText.text = `${dragPercentage}%`;
    dragText.x = world.x + 15 / camera.zoom;
    dragText.y = world.y - 15 / camera.zoom;
    dragText.scale.set(1 / camera.zoom);
    dragText.visible = true;
  }
}
