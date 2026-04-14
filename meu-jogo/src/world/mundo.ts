import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Planeta, Sol, Nave, Camera, TipoJogador } from '../types';
import { criarFundo, atualizarFundo } from './fundo';
import { TIPO_PLANETA } from './planeta';
import { atualizarTempoPlanetas, atualizarLuzPlaneta } from './planeta-procedural';
import { criarCamadaMemoria, criarMemoriaVisualPlaneta, registrarMemoriaPlaneta, atualizarVisibilidadeMemoria, atualizarEscalaLabelMemoria } from './nevoa';
import { criarSistemaSolar } from './sistema';
import { atualizarNaves, atualizarSelecaoNave } from './naves';
import { atualizarPesquisaPlaneta } from './pesquisa';
import { atualizarCampoDeVisao } from './visao';
import { atualizarFilasPlaneta, desenharConstrucoesPlaneta } from './construcao';
import { profileMark, profileAcumular, profileFlush } from './profiling';

// === Re-exports para manter compatibilidade de imports externos ===
export { profiling } from './profiling';
export { construirNoPlaneta } from './construcao';
export { calcularCustoTier, calcularTempoConstrucaoMs, calcularTempoColonizadoraMs, calcularTempoCicloPlaneta, calcularTempoRestantePlaneta, getTierMax, textoProducaoCicloPlaneta, obterProducaoNaturalCiclo } from './recursos';
export { encontrarNaveNoPonto, obterNaveSelecionada, selecionarNave, enviarNaveParaAlvo, enviarNaveParaPosicao, definirRotaManualNave, cancelarMovimentoNave, parseAcaoNave, capacidadeCargaCargueira, ajustarConfiguracaoCarga, definirPlanetaRotaCargueira, alternarLoopCargueira } from './naves';
export { iniciarPesquisa, pesquisaTierLiberada, pesquisaTierDisponivel, getPesquisaAtual } from './pesquisa';
export { nomeTipoPlaneta } from './planeta';

const COR_ANEL_PLANETA = 0xd9ecff;

// === Estado do jogo ===
let estadoJogo: 'jogando' | 'vitoria' | 'derrota' = 'jogando';

export function getEstadoJogo(): 'jogando' | 'vitoria' | 'derrota' {
  return estadoJogo;
}

// === Seleção ===
export function limparSelecoes(mundo: Mundo): void {
  for (const p of mundo.planetas) p.dados.selecionado = false;
  for (const nave of mundo.naves) {
    nave.selecionado = false;
    atualizarSelecaoNave(nave);
  }
}

export function selecionarPlaneta(mundo: Mundo, planeta: Planeta | null): void {
  limparSelecoes(mundo);
  if (planeta) planeta.dados.selecionado = true;
}

// === Busca ===
export function encontrarPlanetaNoPonto(mundoX: number, mundoY: number, mundo: Mundo, apenasVisiveis: boolean = true): Planeta | null {
  for (const p of mundo.planetas) {
    if (apenasVisiveis && !p._visivelAoJogador) continue;
    const dx = p.x - mundoX;
    const dy = p.y - mundoY;
    const raio = p.dados.tamanho / 2;
    if (dx * dx + dy * dy < raio * raio) return p;
  }
  return null;
}

export function encontrarSolNoPonto(mundoX: number, mundoY: number, mundo: Mundo, apenasVisiveis: boolean = true): Sol | null {
  for (const sol of mundo.sois) {
    if (apenasVisiveis && !sol._visivelAoJogador) continue;
    const dx = sol.x - mundoX;
    const dy = sol.y - mundoY;
    if (dx * dx + dy * dy < sol._raio * sol._raio) return sol;
  }
  return null;
}

// === Órbita ===
function atualizarOrbitaPlaneta(planeta: Planeta, deltaMs: number): void {
  planeta._orbita.angulo += planeta._orbita.velocidade * deltaMs;
  planeta.x = planeta._orbita.centroX + Math.cos(planeta._orbita.angulo) * planeta._orbita.raio;
  planeta.y = planeta._orbita.centroY + Math.sin(planeta._orbita.angulo) * planeta._orbita.raio;
}

// === Criação do mundo ===
export async function criarMundo(app: Application, tipoJogador: TipoJogador): Promise<Mundo> {
  const tamanho = Math.max(window.innerWidth, window.innerHeight) * 30;
  const container = new Container();

  const fundo = criarFundo(tamanho);
  container.addChild(fundo);

  const planetas: Planeta[] = [];
  const sistemas: import('../types').Sistema[] = [];
  const sois: Sol[] = [];
  const frotas: unknown[] = [];
  const frotasContainer = new Container();
  const navesContainer = new Container();
  const rotasContainer = new Container();
  const visaoContainer = new Container();
  const orbitasContainer = new Container();
  const memoriaPlanetasContainer = criarCamadaMemoria();

  container.addChild(frotasContainer);
  container.addChild(navesContainer);

  const totalSistemas = 18;
  let tentativasSistema = 0;
  const DIST_MIN = 4500;
  while (sistemas.length < totalSistemas && tentativasSistema < totalSistemas * 20) {
    tentativasSistema++;
    const x = 1600 + Math.random() * (tamanho - 3200);
    const y = 1600 + Math.random() * (tamanho - 3200);

    let muitoPerto = false;
    for (const sistema of sistemas) {
      const dx = sistema.x - x;
      const dy = sistema.y - y;
      if (dx * dx + dy * dy < DIST_MIN * DIST_MIN) {
        muitoPerto = true;
        break;
      }
    }
    if (muitoPerto) continue;

    const sistema = criarSistemaSolar(container, orbitasContainer, x, y, sistemas.length);
    sistemas.push(sistema);
    sois.push(sistema.sol);
    planetas.push(...sistema.planetas);
  }

  container.addChild(visaoContainer);
  container.addChild(rotasContainer);
  container.addChild(orbitasContainer);
  container.addChild(memoriaPlanetasContainer);

  if (!planetas.some((p) => p.dados.tipoPlaneta === TIPO_PLANETA.COMUM) && planetas.length > 0) {
    planetas[0].dados.tipoPlaneta = TIPO_PLANETA.COMUM;
  }

  const mundo = {
    container, tamanho, planetas, sistemas, sois,
    naves: [] as Nave[], fundo, frotas, frotasContainer, navesContainer, rotasContainer,
    tipoJogador,
    ultimoTickMs: performance.now(),
    visaoContainer, orbitasContainer, memoriaPlanetasContainer,
    fontesVisao: [] as import('../types').FonteVisao[],
  } as Mundo;

  for (const planeta of planetas) {
    criarMemoriaVisualPlaneta(mundo, planeta);
  }

  const planetasComuns = planetas.filter((p) => p.dados.tipoPlaneta === TIPO_PLANETA.COMUM);
  const planetaInicial = planetasComuns[Math.floor(Math.random() * planetasComuns.length)];
  planetaInicial.dados.dono = 'jogador';
  planetaInicial._descobertoAoJogador = true;
  planetaInicial.dados.producao *= tipoJogador?.bonus?.producao || 1;
  planetaInicial.dados.fabricas += tipoJogador?.bonus?.fabricasIniciais || 0;
  planetaInicial.dados.infraestrutura += tipoJogador?.bonus?.infraestruturaInicial || 0;
  desenharConstrucoesPlaneta(planetaInicial);
  registrarMemoriaPlaneta(planetaInicial);

  const sistemaInicial = sistemas[planetaInicial.dados.sistemaId];
  if (sistemaInicial?.sol) {
    sistemaInicial.sol._descobertoAoJogador = true;
  }

  estadoJogo = 'jogando';
  return mundo;
}

// === Game loop ===
export function atualizarMundo(mundo: Mundo, app: Application, camera: Camera): void {
  const frameInicio = profileMark();
  const agora = performance.now();
  const deltaMs = agora - (mundo.ultimoTickMs || agora);
  mundo.ultimoTickMs = agora;

  let t = profileMark();

  for (const planeta of mundo.planetas) {
    atualizarPesquisaPlaneta(planeta, deltaMs);
    atualizarOrbitaPlaneta(planeta, deltaMs);
    atualizarFilasPlaneta(mundo, planeta, deltaMs);
  }

  // Pass all objects for time update (skips invisible ones internally)
  atualizarTempoPlanetas(mundo.planetas, deltaMs);
  atualizarTempoPlanetas(mundo.sois, deltaMs);
  // Light update only for visible planets
  for (const planeta of mundo.planetas) {
    if (!planeta.visible) continue;
    const sistema = mundo.sistemas[planeta.dados.sistemaId];
    if (sistema?.sol) {
      atualizarLuzPlaneta(planeta, sistema.sol.x, sistema.sol.y);
    }
  }

  atualizarNaves(mundo, deltaMs);
  profileAcumular('logica', t);

  const zoom = camera.zoom || 1;
  const camX = camera.x + app.screen.width / 2;
  const camY = camera.y + app.screen.height / 2;

  t = profileMark();
  atualizarFundo(mundo.fundo as ReturnType<typeof criarFundo>, camX, camY, app.screen.width, app.screen.height);
  profileAcumular('fundo', t);

  const margem = 600 / zoom;
  const esq = camera.x - margem;
  const dir = camera.x + app.screen.width / zoom + margem;
  const cima = camera.y - margem;
  const baixo = camera.y + app.screen.height / zoom + margem;

  t = profileMark();
  atualizarCampoDeVisao(mundo, camera, app);
  profileAcumular('fog', t);

  t = profileMark();
  for (const planeta of mundo.planetas) {
    const visNaTela = planeta.x > esq && planeta.x < dir && planeta.y > cima && planeta.y < baixo;
    const vis = visNaTela && planeta._visivelAoJogador;
    planeta.visible = vis;

    const raioOrbita = planeta._orbita.raio;
    const orbitaNaTela =
      planeta._orbita.centroX + raioOrbita > esq &&
      planeta._orbita.centroX - raioOrbita < dir &&
      planeta._orbita.centroY + raioOrbita > cima &&
      planeta._orbita.centroY - raioOrbita < baixo;
    const sistema = mundo.sistemas[planeta.dados.sistemaId];
    const solDoSistema = sistema?.sol;
    const orbitaDescoberta = planeta._descobertoAoJogador && !!(solDoSistema?._descobertoAoJogador);
    planeta._linhaOrbita.visible = orbitaDescoberta && orbitaNaTela;
    planeta._linhaOrbita.alpha = planeta._visivelAoJogador && !!(solDoSistema?._visivelAoJogador) ? 0.5 : 0.18;

    if (vis) {
      const anel = planeta._anel;
      anel.clear();
      const largura = planeta.dados.selecionado ? 2.5 : 1.25;
      const raioBase = planeta.dados.tamanho * 0.42;
      const raio = Math.max(10, raioBase - largura * 0.5);
      anel.circle(0, 0, raio).stroke({ color: COR_ANEL_PLANETA, width: largura, alpha: 0.72 });
      desenharConstrucoesPlaneta(planeta);
    }

    atualizarVisibilidadeMemoria(planeta, planeta._visivelAoJogador, esq, dir, cima, baixo);
    atualizarEscalaLabelMemoria(planeta, zoom);
  }
  profileAcumular('planetas', t);

  t = profileMark();
  for (const sol of mundo.sois) {
    const visNaTela = sol.x > esq && sol.x < dir && sol.y > cima && sol.y < baixo;
    sol.visible = visNaTela && (sol._visivelAoJogador || sol._descobertoAoJogador);
    sol.alpha = sol._visivelAoJogador ? 1 : 0.28;
  }

  for (const nave of mundo.naves) {
    const visNaTela = nave.x > esq && nave.x < dir && nave.y > cima && nave.y < baixo;
    nave.gfx.visible = visNaTela;
    if (nave._selecaoAnterior !== nave.selecionado) {
      nave._selecaoAnterior = nave.selecionado;
      atualizarSelecaoNave(nave);
    }
  }
  profileAcumular('render', t);

  profileAcumular('total', frameInicio);
  profileFlush();

  verificarEstadoJogo(mundo);
}

// === Estado do jogo ===
function verificarEstadoJogo(mundo: Mundo): void {
  if (estadoJogo !== 'jogando') return;

  let jogadorTemPlaneta = false;
  let todosSaoJogador = true;

  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono === 'jogador') jogadorTemPlaneta = true;
    if (planeta.dados.dono !== 'jogador') todosSaoJogador = false;
  }

  if (!jogadorTemPlaneta) {
    estadoJogo = 'derrota';
  } else if (todosSaoJogador) {
    estadoJogo = 'vitoria';
  }
}
