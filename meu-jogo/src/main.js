import { Application } from 'pixi.js';
import { criarMundo, atualizarMundo, getEstadoJogo, construirNoPlaneta } from './world/mundo.js';
import { configurarCamera, atualizarCamera, getCamera, setCameraPos, setTipoJogador } from './core/player.js';
import { criarMinimapa, atualizarMinimapa, onMinimapClick } from './ui/minimapa.js';
import { criarPainel, atualizarPainel, definirAcaoPainel } from './ui/painel.js';
import { criarTelaSelecao } from './ui/selecao.js';
import { criarTutorial, atualizarTutorial } from './ui/tutorial.js';
import { somVitoria, somDerrota } from './audio/som.js';

const app = new Application();
await app.init({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 0x0a0a1a,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  antialias: true,
});

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.appendChild(app.canvas);

window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
});

const tipoEscolhido = await criarTelaSelecao(app);
setTipoJogador(tipoEscolhido);

const mundo = await criarMundo(app, tipoEscolhido);
app.stage.addChild(mundo.container);

// Câmera é o centro da visão em coords do mundo
const planetaJogador = mundo.planetas.find(p => p.dados.dono === 'jogador');
setCameraPos(planetaJogador.x, planetaJogador.y);

configurarCamera(app, mundo);

const minimapa = criarMinimapa(app, mundo);
app.stage.addChild(minimapa);

onMinimapClick((worldX, worldY) => {
  setCameraPos(worldX, worldY);
});

const painel = criarPainel(app);
app.stage.addChild(painel);
definirAcaoPainel(painel, (acao, planeta) => {
  construirNoPlaneta(mundo, planeta, acao);
});

const tutorial = criarTutorial(app);
app.stage.addChild(tutorial);

app.ticker.add(() => {
  const camera = getCamera();
  atualizarCamera(mundo, app);
  atualizarMundo(mundo, app, camera);
  atualizarMinimapa(minimapa, camera, app);
  atualizarPainel(painel, mundo, tipoEscolhido, app);
  atualizarTutorial(tutorial, mundo);

  const estado = getEstadoJogo();
  if (estado === 'vitoria' && !app._fimTocado) {
    somVitoria();
    app._fimTocado = true;
  } else if (estado === 'derrota' && !app._fimTocado) {
    somDerrota();
    app._fimTocado = true;
  }
});
