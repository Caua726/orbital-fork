import { somClique } from '../audio/som.js';
import {
  encontrarNaveNoPonto,
  encontrarPlanetaNoPonto,
  encontrarSolNoPonto,
  enviarNaveParaAlvo,
  enviarNaveParaPosicao,
  limparSelecoes,
  obterNaveSelecionada,
  selecionarNave,
  selecionarPlaneta,
} from '../world/mundo.js';

const camera = { x: 0, y: 0, zoom: 1 };

let cameraDragging = false;
let cameraLastMouse = { x: 0, y: 0 };
let clickStartScreen = { x: 0, y: 0 };
let clickInfo = null;

export function setTipoJogador() {}

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

export function configurarCamera(app, mundo) {
  const canvas = app.canvas;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY, app);
      clickInfo = {
        nave: encontrarNaveNoPonto(world.x, world.y, mundo),
        planeta: encontrarPlanetaNoPonto(world.x, world.y, mundo, true),
        sol: encontrarSolNoPonto(world.x, world.y, mundo, true),
      };
      clickStartScreen.x = e.clientX;
      clickStartScreen.y = e.clientY;

      if (!clickInfo.nave && !clickInfo.planeta && !clickInfo.sol) {
        cameraDragging = true;
        cameraLastMouse.x = e.clientX;
        cameraLastMouse.y = e.clientY;
      }
      return;
    }

    if (e.button === 1 || e.button === 2) {
      cameraDragging = true;
      cameraLastMouse.x = e.clientX;
      cameraLastMouse.y = e.clientY;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!cameraDragging) return;

    const dx = e.clientX - cameraLastMouse.x;
    const dy = e.clientY - cameraLastMouse.y;
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    cameraLastMouse.x = e.clientX;
    cameraLastMouse.y = e.clientY;
  });

  window.addEventListener('mouseup', (e) => {
    if (cameraDragging) {
      cameraDragging = false;
    }

    if (e.button !== 0) return;

    const movedX = e.clientX - clickStartScreen.x;
    const movedY = e.clientY - clickStartScreen.y;
    const movedDist = Math.hypot(movedX, movedY);

    if (movedDist < 5) {
      const naveSelecionada = obterNaveSelecionada(mundo);
      const destinoMapa = screenToWorld(e.clientX, e.clientY, app);

      if (clickInfo?.nave) {
        selecionarNave(mundo, clickInfo.nave);
        somClique();
      } else if (naveSelecionada && (clickInfo?.planeta || clickInfo?.sol)) {
        enviarNaveParaAlvo(mundo, naveSelecionada, clickInfo.planeta || clickInfo.sol);
        somClique();
      } else if (naveSelecionada) {
        enviarNaveParaPosicao(mundo, naveSelecionada, destinoMapa.x, destinoMapa.y);
        somClique();
      } else if (clickInfo?.planeta) {
        selecionarPlaneta(mundo, clickInfo.planeta);
        somClique();
      }
    }

    clickInfo = null;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    const mouseWorld = screenToWorld(e.clientX, e.clientY, app);

    if (e.deltaY < 0) {
      camera.zoom = Math.min(2.0, camera.zoom * 1.1);
    } else {
      camera.zoom = Math.max(0.3, camera.zoom / 1.1);
    }

    camera.x = mouseWorld.x - (e.clientX - app.screen.width / 2) / camera.zoom;
    camera.y = mouseWorld.y - (e.clientY - app.screen.height / 2) / camera.zoom;
  }, { passive: false });
}

export function atualizarCamera(mundo, app) {
  mundo.container.scale.set(camera.zoom);
  mundo.container.x = -camera.x * camera.zoom + app.screen.width / 2;
  mundo.container.y = -camera.y * camera.zoom + app.screen.height / 2;
}
