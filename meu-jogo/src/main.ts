import { Application } from 'pixi.js';
import type { Mundo } from './types';
import { criarMundo, atualizarMundo, getEstadoJogo, construirNoPlaneta } from './world/mundo';
import { cancelarRotaNaveSelecionada, configurarCamera, atualizarCamera, getCamera, iniciarComandoNave, setCameraPos, setTipoJogador } from './core/player';
import { criarMinimapa, atualizarMinimapa, onMinimapClick } from './ui/minimapa';
import { criarPainel, atualizarPainel, definirAcaoPainel, definirAcaoNavePainel } from './ui/painel';
import { getTipos } from './ui/selecao';
import { criarTutorial, atualizarTutorial } from './ui/tutorial';
import { criarDebug, atualizarDebug, processarTeclaDebug, getRendererPreference } from './ui/debug';
import { somVitoria, somDerrota } from './audio/som';
import { ajustarConfiguracaoCarga, alternarLoopCargueira } from './world/mundo';

const app = new Application();
await app.init({
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 0x0a0a1a,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  antialias: true,
  preference: 'webgl', // WebGPU pendente: Mesh com shader customizado requer bind group layout específico
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
definirAcaoNavePainel(painel, (acao: string, nave: any) => {
  if (acao === 'comando_nave_mover') iniciarComandoNave('mover', nave);
  else if (acao === 'comando_nave_cancelar') cancelarRotaNaveSelecionada(mundo);
  else if (acao === 'comando_nave_origem') iniciarComandoNave('origem', nave);
  else if (acao === 'comando_nave_destino') iniciarComandoNave('destino', nave);
  else if (acao === 'comando_nave_loop') alternarLoopCargueira(nave);
  else if (acao.startsWith('config_cargo_')) {
    const m = acao.match(/^config_cargo_(comum|raro|combustivel)_(mais|menos)$/);
    if (m) ajustarConfiguracaoCarga(nave, m[1] as 'comum' | 'raro' | 'combustivel', m[2] === 'mais' ? 5 : -5);
  }
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
