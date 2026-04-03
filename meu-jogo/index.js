import { Application } from 'pixi.js';
import { criarTerreno } from './terreno/terreno.js';
import {
  configurarControles,
  criarJogador,
  atualizarJogador,
} from './entidades/jogador.js';
import { criarCachorro, atualizarCachorro } from './entidades/cachorro.js';

const app = new Application();
await app.init({
  width: 1880,
  height: 700,
  backgroundColor: 0x1a1a2e,
  resolution: window.devicePixelRatio || 1,
  antialias: true,
});

document.body.appendChild(app.canvas);

const terreno = criarTerreno(app);
app.stage.addChild(terreno)

const alturaCeus = app.screen.height * 0.28;
const areaJogo = {
  left: 0,
  top: alturaCeus,
  right: app.screen.width,
  bottom: app.screen.height,
  get width() {
    return this.right - this.left;
  },
  get height() {
    return this.bottom - this.top;
  },
};

const cachorro = criarCachorro(app, areaJogo);
const jogador = await criarJogador(app, areaJogo);

app.stage.addChild(cachorro);
app.stage.addChild(jogador);

configurarControles();

const velJogador = 4.2;
const velCachorro = 2.8;

app.ticker.add(() => {
  atualizarJogador(jogador, areaJogo, velJogador);
  atualizarCachorro(cachorro, jogador, areaJogo, velCachorro);
});
