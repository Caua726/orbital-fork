import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Planeta, Sol, Nave, Camera, TipoJogador } from '../types';
import { criarFundo, atualizarFundo } from './fundo';
import { TIPO_PLANETA } from './planeta';
import { atualizarTempoPlanetas, atualizarLuzPlaneta } from './planeta-procedural';
import { criarCamadaMemoria, criarMemoriaVisualPlaneta, registrarMemoriaPlaneta, atualizarVisibilidadeMemoria, atualizarEscalaLabelMemoria, aplicarLimiteFantasmas } from './nevoa';
import { criarSistemaSolar } from './sistema';
import { calcularBoundsViewport } from './viewport-bounds';
import { resetarNomesPlanetas } from './nomes';
import { atualizarNaves, atualizarSelecaoNave, carregarSpritesheetNaves } from './naves';
import { spawnInimigosNoMundo, atualizarIaInimigos, resetIaInimigos } from './ia-inimigo';
import { atualizarCombate, resetCombateVisuals } from './combate-resolucao';
import { atualizarPesquisaPlaneta } from './pesquisa';
import { atualizarCampoDeVisao } from './visao';
import { atualizarFilasPlaneta, desenharConstrucoesPlaneta } from './construcao';
import { profileMark, profileAcumular, profileFlush } from './profiling';
import { getConfig } from '../core/config';

// Cached lazy import to avoid circular dep (mundo → save → reconstruir → mundo)
// and eliminate per-frame Promise allocation from dynamic import().
let _marcarTudoDirty: ((mundo: Mundo) => void) | null = null;

// === Re-exports para manter compatibilidade de imports externos ===
export { profiling } from './profiling';
export { construirNoPlaneta } from './construcao';
export { calcularCustoTier, calcularTempoConstrucaoMs, calcularTempoColonizadoraMs, calcularTempoCicloPlaneta, calcularTempoRestantePlaneta, getTierMax, textoProducaoCicloPlaneta, obterProducaoNaturalCiclo } from './recursos';
export { encontrarNaveNoPonto, obterNaveSelecionada, selecionarNave, enviarNaveParaAlvo, enviarNaveParaPosicao, definirRotaManualNave, cancelarMovimentoNave, parseAcaoNave, capacidadeCargaCargueira, ajustarConfiguracaoCarga, definirPlanetaRotaCargueira, alternarLoopCargueira, confirmarColonizacao, manterComoOutpost, recolherColonizadoraParaOrigem, sucatearNave, ehColonizadoraOutpost, iniciarPilotagem, setNaveThrust } from './naves';
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
export interface MundoVazio {
  container: Container;
  fundo: Container;
  frotasContainer: Container;
  navesContainer: Container;
  rotasContainer: Container;
  visaoContainer: Container;
  orbitasContainer: Container;
  memoriaPlanetasContainer: Container;
  tamanho: number;
}

export function criarMundoVazio(tamanho: number): MundoVazio {
  const container = new Container();

  const fundo = criarFundo(tamanho);
  container.addChild(fundo);

  const frotasContainer = new Container();
  const navesContainer = new Container();
  const rotasContainer = new Container();
  const visaoContainer = new Container();
  const orbitasContainer = new Container();
  const memoriaPlanetasContainer = criarCamadaMemoria();

  return {
    container,
    fundo,
    frotasContainer,
    navesContainer,
    rotasContainer,
    visaoContainer,
    orbitasContainer,
    memoriaPlanetasContainer,
    tamanho,
  };
}

export function aplicarZOrderMundo(mv: MundoVazio): void {
  mv.container.addChild(mv.orbitasContainer);
  mv.container.addChild(mv.frotasContainer);
  mv.container.addChild(mv.navesContainer);
  mv.container.addChild(mv.rotasContainer);
  mv.container.addChild(mv.visaoContainer);
  mv.container.addChild(mv.memoriaPlanetasContainer);
}

export async function criarMundo(app: Application, tipoJogador: TipoJogador): Promise<Mundo> {
  resetarNomesPlanetas();
  void carregarSpritesheetNaves();
  const tamanho = Math.max(window.innerWidth, window.innerHeight) * 30;

  const mv = criarMundoVazio(tamanho);
  const {
    container,
    fundo,
    frotasContainer,
    navesContainer,
    rotasContainer,
    visaoContainer,
    orbitasContainer,
    memoriaPlanetasContainer,
  } = mv;

  const planetas: Planeta[] = [];
  const sistemas: import('../types').Sistema[] = [];
  const sois: Sol[] = [];
  const frotas: unknown[] = [];

  // Build the system objects first — `criarSistemaSolar` appends each sun
  // and planet directly onto `container`, so they need to exist before
  // we stack the ship / route / fog / memory layers on top.
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

  // Correct z-order (bottom → top):
  //   fundo → planets (added via criarSistemaSolar) → orbit rings →
  //   fleets → ships → ship routes → fog → memory ghosts.
  // Fog has transparent holes where vision sources sit, so ships in
  // visible territory remain visible through them.
  aplicarZOrderMundo(mv);

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
  resetIaInimigos();
  resetCombateVisuals();
  spawnInimigosNoMundo(mundo);
  return mundo;
}

export function destruirMundo(mundo: Mundo, app: Application): void {
  app.stage.removeChild(mundo.container);
  mundo.container.destroy({ children: true });
  estadoJogo = 'jogando';
}

// === Game loop ===
export function atualizarMundo(mundo: Mundo, app: Application, camera: Camera): void {
  const frameInicio = profileMark();
  // Use Pixi's ticker delta so the debug game-speed slider actually
  // scales simulation time. Previously a hand-rolled performance.now()
  // delta ignored `app.ticker.speed` entirely, making the slider inert.
  const deltaMs = app.ticker.deltaMS;
  mundo.ultimoTickMs = performance.now();

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
  atualizarIaInimigos(mundo, deltaMs);
  atualizarCombate(mundo, deltaMs);
  profileAcumular('logica', t);

  const zoom = camera.zoom || 1;

  t = profileMark();
  atualizarFundo(
    mundo.fundo as ReturnType<typeof criarFundo>,
    camera.x,
    camera.y,
    app.screen.width / zoom,
    app.screen.height / zoom,
  );
  profileAcumular('fundo', t);

  const bounds = calcularBoundsViewport(
    camera.x,
    camera.y,
    camera.zoom,
    app.screen.width,
    app.screen.height,
  );
  const { esq, dir, cima, baixo } = bounds;

  t = profileMark();
  atualizarCampoDeVisao(mundo, camera, app);
  profileAcumular('fog', t);

  const gfxCfg = getConfig().graphics;

  t = profileMark();
  for (const planeta of mundo.planetas) {
    const visNaTela = planeta.x > esq && planeta.x < dir && planeta.y > cima && planeta.y < baixo;
    const vis = visNaTela && planeta._visivelAoJogador;
    // When baked, hide mesh and control sprite visibility instead
    if ((planeta as any)._bakedSprite) {
      planeta.visible = false;
      (planeta as any)._bakedSprite.visible = vis;
    } else {
      planeta.visible = vis;
    }

    const raioOrbita = planeta._orbita.raio;
    const orbitaNaTela =
      planeta._orbita.centroX + raioOrbita > esq &&
      planeta._orbita.centroX - raioOrbita < dir &&
      planeta._orbita.centroY + raioOrbita > cima &&
      planeta._orbita.centroY - raioOrbita < baixo;
    const sistema = mundo.sistemas[planeta.dados.sistemaId];
    const solDoSistema = sistema?.sol;
    const orbitaDescoberta = planeta._descobertoAoJogador && !!(solDoSistema?._descobertoAoJogador);
    planeta._linhaOrbita.visible = gfxCfg.mostrarOrbitas && orbitaDescoberta && orbitaNaTela;
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

    atualizarVisibilidadeMemoria(planeta, planeta._visivelAoJogador, esq, dir, cima, baixo, gfxCfg.maxFantasmas);
    atualizarEscalaLabelMemoria(planeta, zoom);
  }
  aplicarLimiteFantasmas(mundo);
  profileAcumular('planetas', t);

  t = profileMark();
  for (const sol of mundo.sois) {
    const visNaTela = sol.x > esq && sol.x < dir && sol.y > cima && sol.y < baixo;
    const solVis = visNaTela && (sol._visivelAoJogador || sol._descobertoAoJogador);
    if ((sol as any)._bakedSprite) {
      sol.visible = false;
      (sol as any)._bakedSprite.visible = solVis;
      (sol as any)._bakedSprite.alpha = sol._visivelAoJogador ? 1 : 0.28;
    } else {
      sol.visible = solVis;
      sol.alpha = sol._visivelAoJogador ? 1 : 0.28;
    }
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

  if (getConfig().saveMode === 'experimental') {
    if (_marcarTudoDirty) {
      _marcarTudoDirty(mundo);
    } else {
      import('./save').then(({ marcarTudoDirty }) => {
        _marcarTudoDirty = marcarTudoDirty;
        marcarTudoDirty(mundo);
      });
    }
  }

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
