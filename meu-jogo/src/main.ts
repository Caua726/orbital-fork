import { Application } from 'pixi.js';
import type { Mundo } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo, construirNoPlaneta } from './world/mundo';
import { configurarCamera, atualizarCamera, getCamera, setCameraPos, setTipoJogador } from './core/player';
import { criarMinimapa, atualizarMinimapa, onMinimapClick } from './ui/minimapa';
import { criarPainel, atualizarPainel, definirAcaoPainel } from './ui/painel';
import { getTipos } from './ui/selecao';
import { criarTutorial, atualizarTutorial } from './ui/tutorial';
import { criarDebug, atualizarDebug, processarTeclaDebug, getRendererPreference } from './ui/debug';
import { somVitoria, somDerrota } from './audio/som';

const app = new Application();
await app.init({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 0x0a0a1a,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  antialias: true,
  preference: getRendererPreference() as 'webgl' | 'webgpu',
});

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.appendChild(app.canvas);

window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
});

const tipoEscolhido = getTipos()[0];
setTipoJogador();

const mundo = await criarMundo(app, tipoEscolhido) as unknown as Mundo;
app.stage.addChild(mundo.container);

const planetaJogador = mundo.planetas.find(p => p.dados.dono === 'jogador');
if (planetaJogador) setCameraPos(planetaJogador.x, planetaJogador.y);

configurarCamera(app, mundo);

const minimapa = criarMinimapa(app, mundo);
app.stage.addChild(minimapa);

onMinimapClick((worldX: number, worldY: number) => {
  setCameraPos(worldX, worldY);
});

const painel = (criarPainel as any)(app);
app.stage.addChild(painel);
definirAcaoPainel(painel, (acao: string, planeta: any) => {
  construirNoPlaneta(mundo, planeta, acao);
});

const tutorial = criarTutorial(app);
app.stage.addChild(tutorial);

const debug = criarDebug();

window.addEventListener('keydown', (e: KeyboardEvent) => {
  processarTeclaDebug(e);
});

let _fimTocado = false;

app.ticker.add(() => {
  const camera = getCamera();
  atualizarCamera(mundo, app);
  atualizarMundo(mundo, app, camera);
  atualizarMinimapa(minimapa, camera, app);
  atualizarPainel(painel, mundo, tipoEscolhido, app);
  atualizarTutorial(tutorial, mundo);
  atualizarDebug(debug, mundo, app);

  const estado = getEstadoJogo();
  if (estado === 'vitoria' && !_fimTocado) {
    somVitoria();
    _fimTocado = true;
  } else if (estado === 'derrota' && !_fimTocado) {
    somDerrota();
    _fimTocado = true;
  }
});
