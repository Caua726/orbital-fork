import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Mundo, Planeta, Sol, Nave, Camera, TipoJogador } from '../types';
import { criarFundo, atualizarFundo } from './fundo';
import { TIPO_PLANETA } from './planeta';
import { atualizarTempoPlanetas, atualizarLuzPlaneta } from './planeta-procedural';
import { criarCamadaMemoria, criarMemoriaVisualPlaneta, registrarMemoriaPlaneta, atualizarVisibilidadeMemoria, atualizarEscalaLabelMemoria, aplicarLimiteFantasmas, destruirFog } from './nevoa';
import { criarSistemaSolar } from './sistema';
import { calcularBoundsViewport, type ViewportBounds } from './viewport-bounds';

// Persistent scratch buffer for atualizarMundo's viewport-bounds call.
// Previously allocated a fresh object every frame (2.16M allocations
// over a 10-hour session); now the same object is mutated in place.
const _boundsScratch: ViewportBounds = {
  esq: 0, dir: 0, cima: 0, baixo: 0, halfW: 0, halfH: 0, margem: 0,
};
import { resetarNomesPlanetas } from './nomes';
import { atualizarNaves, atualizarSelecaoNave, carregarSpritesheetNaves } from './naves';
import { inicializarIas, atualizarIasV2, resetIasV2, getPersonalidades } from './ia-decisao';
import { buildDistanceMatrix, resetDistanceMatrix } from './distance-matrix';
import { acumularStats, resetStats } from './stats';
import { resetEventos, registrarEvento } from './eventos';
import { resetBattles } from './battle-log';
import { resetFirstContact, marcarPrimeiroContato, getFirstContactCount } from './first-contact';
import { resetLastSeen } from './last-seen';
import { resetNomesUsados } from './proc-names';
import type { Dificuldade } from './personalidade-ia';
import { atualizarCombate, resetCombateVisuals } from './combate-resolucao';
import { gerarSeedMusical } from '../audio/musica-ambiente';
import { atualizarPesquisaPlaneta } from './pesquisa';
import { atualizarCampoDeVisao } from './visao';
import { atualizarFilasPlaneta, atualizarRecursosPlaneta } from './construcao';
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
let _dificuldadeAtual: Dificuldade = 'normal';

/** Set difficulty BEFORE calling criarMundo. */
export function setDificuldadeProximoMundo(d: Dificuldade): void {
  _dificuldadeAtual = d;
}

export function getDificuldadeAtual(): Dificuldade {
  return _dificuldadeAtual;
}

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

/** Async fase callback — receives a label and yields back to event loop. */
export type FaseCallback = (label: string) => Promise<void>;

const noopFase: FaseCallback = async () => {};

export async function criarMundo(
  app: Application,
  tipoJogador: TipoJogador,
  onFase: FaseCallback = noopFase,
): Promise<Mundo> {
  // ─── Fase 1: Inicializando galáxia ──
  await onFase('Inicializando galáxia');
  resetarNomesPlanetas();
  // Start spritesheet load immediately but keep the handle — we await
  // it before IAs spawn their starter fleets so those ships have valid
  // sprites instead of racing against the asset loader.
  const shipsheetPromise = carregarSpritesheetNaves();
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

  // ─── Fase 2: Gerando sistemas estelares ──
  // Progressive placement: start with an ideal spacing and, if the RNG
  // can't place all systems within a few hundred attempts, shrink the
  // minimum distance and retry the remaining slots. Guarantees the final
  // system count at the cost of a slightly denser galaxy on bad seeds.
  await onFase('Gerando sistemas estelares');
  const totalSistemas = 18;
  const DIST_MIN_IDEAL = 4500;
  const DIST_MIN_FALLBACK = 3200; // hard floor — still larger than DIST_MIN_SISTEMA (2800)
  const MAX_TENTATIVAS_POR_SISTEMA = 40;
  let distMinAtual = DIST_MIN_IDEAL;
  let tentativasNoPatamar = 0;

  while (sistemas.length < totalSistemas) {
    if (tentativasNoPatamar > MAX_TENTATIVAS_POR_SISTEMA * (totalSistemas - sistemas.length)) {
      if (distMinAtual <= DIST_MIN_FALLBACK) {
        console.warn(`[worldgen] parou com ${sistemas.length}/${totalSistemas} sistemas — seed inviável`);
        break;
      }
      distMinAtual = Math.max(DIST_MIN_FALLBACK, distMinAtual - 400);
      tentativasNoPatamar = 0;
      console.info(`[worldgen] reduzindo DIST_MIN pra ${distMinAtual} (${sistemas.length}/${totalSistemas})`);
    }
    tentativasNoPatamar++;
    const x = 1600 + Math.random() * (tamanho - 3200);
    const y = 1600 + Math.random() * (tamanho - 3200);

    let muitoPerto = false;
    const distMin2 = distMinAtual * distMinAtual;
    for (const sistema of sistemas) {
      const dx = sistema.x - x;
      const dy = sistema.y - y;
      if (dx * dx + dy * dy < distMin2) {
        muitoPerto = true;
        break;
      }
    }
    if (muitoPerto) continue;

    // First system gets a guaranteed COMUM planet so the player always
    // has a valid starter — avoids a post-creation sprite swap later.
    const opts = sistemas.length === 0 ? { forcarTipoPrimeiro: TIPO_PLANETA.COMUM } : {};
    const sistema = criarSistemaSolar(container, orbitasContainer, x, y, sistemas.length, opts);
    sistemas.push(sistema);
    sois.push(sistema.sol);
    planetas.push(...sistema.planetas);
  }

  // Hard validation: if the galaxy ended up empty, abort with a clear
  // error rather than letting the loader crash on an undefined planet.
  if (planetas.length === 0 || sistemas.length === 0) {
    throw new Error(
      `[worldgen] mundo vazio — ${sistemas.length} sistemas, ${planetas.length} planetas. ` +
      `Tamanho=${tamanho}. Aumente a resolução da janela ou reduza totalSistemas.`
    );
  }

  // ─── Fase 3: Calculando órbitas ──
  await onFase('Calculando órbitas planetárias');
  aplicarZOrderMundo(mv);
  // Note: the old "patch first planet to COMUM if none exists" hack is
  // gone — the first system now constructs one by design, so the sprite
  // always matches dados.tipoPlaneta.

  const mundo = {
    container, tamanho, planetas, sistemas, sois,
    naves: [] as Nave[], fundo, frotas, frotasContainer, navesContainer, rotasContainer,
    tipoJogador,
    ultimoTickMs: performance.now(),
    visaoContainer, orbitasContainer, memoriaPlanetasContainer,
    fontesVisao: [] as import('../types').FonteVisao[],
    seedMusical: gerarSeedMusical(),
    galaxySeed: Math.floor(Math.random() * 0xffffffff),
  } as Mundo;

  // ─── Fase 4: Cartografando memória de fog-of-war ──
  await onFase('Cartografando névoa de guerra');
  for (const planeta of planetas) {
    criarMemoriaVisualPlaneta(mundo, planeta);
  }

  // ─── Fase 5: Estabelecendo colônia inicial ──
  await onFase('Estabelecendo colônia inicial');
  const planetasComuns = planetas.filter((p) => p.dados.tipoPlaneta === TIPO_PLANETA.COMUM);
  const planetaInicial = planetasComuns[Math.floor(Math.random() * planetasComuns.length)];
  planetaInicial.dados.dono = 'jogador';
  planetaInicial._descobertoAoJogador = true;
  planetaInicial.dados.producao *= tipoJogador?.bonus?.producao || 1;
  planetaInicial.dados.fabricas += tipoJogador?.bonus?.fabricasIniciais || 0;
  planetaInicial.dados.infraestrutura += tipoJogador?.bonus?.infraestruturaInicial || 0;
  registrarMemoriaPlaneta(planetaInicial);

  const sistemaInicial = sistemas[planetaInicial.dados.sistemaId];
  if (sistemaInicial?.sol) {
    sistemaInicial.sol._descobertoAoJogador = true;
  }

  // ─── Fase 6: Despertando civilizações ──
  estadoJogo = 'jogando';
  resetIasV2();
  resetCombateVisuals();
  resetStats();
  resetEventos();
  resetBattles();
  resetFirstContact();
  resetLastSeen();
  resetNomesUsados();
  await onFase('Despertando civilizações alienígenas');
  // Ensure ship textures are loaded before AI fleets spawn — otherwise
  // their starter naves render as empty containers for the first few
  // frames of gameplay.
  await shipsheetPromise.catch((err) => {
    console.warn('[worldgen] spritesheet de naves falhou:', err);
  });
  const ias = inicializarIas(mundo, _dificuldadeAtual);

  // ─── Fase 6.5: Build distance matrix cache ──
  buildDistanceMatrix(mundo);

  // ─── Fase 7: Anunciar nomes das IAs (cosmético) ──
  for (const ia of ias) {
    await onFase(`Despertando: ${ia.nome}`);
    registrarEvento('ia_despertou', `${ia.nome} desperta entre as estrelas.`, 0);
  }

  // ─── Fase 8: Sanity check via reconciler ──
  // Runs the same healers the load path uses, but on a freshly-built
  // world. If worldgen drifts (someone changes criarSistemaSolar and
  // forgets to set a field), this catches it immediately instead of
  // waiting for the next save/load roundtrip.
  await onFase('Validando galáxia');
  try {
    // Lazy import to avoid circular dep mundo → save → reconstruir → mundo.
    const { reconciliarMundo } = await import('./save/reconciler');
    // Build a minimal DTO stub — the reconciler only reads a handful of
    // top-level fields, and none that don't exist on a fresh world.
    const dtoStub = {
      schemaVersion: 2,
      nome: '', criadoEm: 0, salvoEm: 0, tempoJogadoMs: 0,
      tamanho: mundo.tamanho,
      tipoJogador: mundo.tipoJogador,
      sistemas: [], sois: [], planetas: [], naves: [], fontesVisao: [],
    } as any;
    const diag = reconciliarMundo(mundo, dtoStub);
    const problemas = diag.filter((d) => d.severidade !== 'info');
    if (problemas.length > 0) {
      console.warn('[worldgen] sanity check encontrou problemas:');
      for (const d of problemas) {
        console.warn(`  [${d.severidade}][${d.categoria}] ${d.detalhe}`);
      }
    }
  } catch (err) {
    console.warn('[worldgen] reconciler pós-criação falhou:', err);
  }

  // ─── Fase 9: Pronto ──
  await onFase('Galáxia pronta');
  return mundo;
}

export function destruirMundo(mundo: Mundo, app: Application): void {
  app.stage.removeChild(mundo.container);
  mundo.container.destroy({ children: true });
  estadoJogo = 'jogando';
  resetDistanceMatrix();
  // The fog-of-war layer keeps module-level singletons (sprite, texture,
  // image source, backing canvas) that outlive a world otherwise.
  destruirFog();
  _primeiroContatoCompleto = false;
  // Reset the wall-clock frame timer so the first frame of the next
  // world doesn't report a huge 'Frame wall' delta covering the time
  // the player spent in the menu.
  _lastFrameMark = 0;
}

// Wall-clock delta between consecutive atualizarMundo calls. Captures
// Pixi render pipeline + browser idle (vsync wait) which our per-bucket
// profiling doesn't cover. Seed with 0 so the first frame shows nothing
// weird.
let _lastFrameMark = 0;

// === Game loop ===
export function atualizarMundo(mundo: Mundo, app: Application, camera: Camera): void {
  const frameInicio = profileMark();
  // Wall clock — how long since the PREVIOUS frame started? This
  // includes whatever happened between the previous atualizarMundo
  // return and now (Pixi render, ticker overhead, vsync wait).
  if (_lastFrameMark > 0) {
    // Write straight into the profiling aggregate via profileAcumular,
    // using a synthetic "start time" of frameInicio - delta so the
    // subtraction inside profileAcumular produces the right number.
    profileAcumular('frameWall', _lastFrameMark);
  }
  _lastFrameMark = frameInicio;

  // Use Pixi's ticker delta so the debug game-speed slider actually
  // scales simulation time. Previously a hand-rolled performance.now()
  // delta ignored `app.ticker.speed` entirely, making the slider inert.
  const deltaMs = app.ticker.deltaMS;
  mundo.ultimoTickMs = performance.now();

  // Per-system gameplay logic, now split into fine buckets so the
  // debug HUD can show exactly which system is burning frame budget.
  let t = profileMark();
  for (const planeta of mundo.planetas) {
    atualizarRecursosPlaneta(planeta, deltaMs);
    atualizarPesquisaPlaneta(planeta, deltaMs);
    atualizarOrbitaPlaneta(planeta, deltaMs);
    atualizarFilasPlaneta(mundo, planeta, deltaMs);
  }
  // Time integration for all celestial bodies — cheap enough to keep
  // bundled with the planet-logic bucket since it's the same domain.
  atualizarTempoPlanetas(mundo.planetas, deltaMs);
  atualizarTempoPlanetas(mundo.sois, deltaMs);
  for (const planeta of mundo.planetas) {
    if (!planeta.visible) continue;
    const sistema = mundo.sistemas[planeta.dados.sistemaId];
    if (sistema?.sol) atualizarLuzPlaneta(planeta, sistema.sol.x, sistema.sol.y);
  }
  profileAcumular('planetasLogic', t);

  t = profileMark();
  atualizarNaves(mundo, deltaMs);
  profileAcumular('naves', t);

  t = profileMark();
  atualizarIasV2(mundo, deltaMs);
  profileAcumular('ia', t);

  t = profileMark();
  atualizarCombate(mundo, deltaMs);
  profileAcumular('combate', t);

  t = profileMark();
  acumularStats(mundo, deltaMs, mundo.ultimoTickMs);
  atualizarPrimeiroContato(mundo);
  profileAcumular('stats', t);

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
    600,
    0,
    _boundsScratch,
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

// === First-contact detection ===
// When any planet belonging to an AI becomes visible for the first time,
// record the moment so tooltips can show "primeiro contato há X min".
// Short-circuits once every discovered AI has been marked — after first
// contact with all current AIs this function becomes a single flag read.
let _primeiroContatoCompleto = false;
function atualizarPrimeiroContato(mundo: Mundo): void {
  if (_primeiroContatoCompleto) return;
  for (const p of mundo.planetas) {
    if (!p._visivelAoJogador) continue;
    const d = p.dados.dono;
    if (!d.startsWith('inimigo')) continue;
    marcarPrimeiroContato(d, mundo.ultimoTickMs);
  }
  // Once we've logged first contact with every AI currently in the
  // world, stop scanning. Without this the loop walked every planet
  // every frame forever — my previous "early exit" commit added the
  // flag but never flipped it, so the check was a no-op.
  const ias = getPersonalidades();
  if (ias.length > 0 && getFirstContactCount() >= ias.length) {
    _primeiroContatoCompleto = true;
  }
}
/** Reset by callers when a new world / fresh game begins. */
export function resetPrimeiroContatoFlag(): void {
  _primeiroContatoCompleto = false;
}

// === Estado do jogo ===
function verificarEstadoJogo(mundo: Mundo): void {
  if (estadoJogo !== 'jogando') return;

  let jogadorTemPlaneta = false;
  let todosSaoJogador = true;

  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono === 'jogador') jogadorTemPlaneta = true;
    else todosSaoJogador = false;
    // Early exit once both flags are decided.
    if (jogadorTemPlaneta && !todosSaoJogador) break;
  }

  if (!jogadorTemPlaneta) {
    estadoJogo = 'derrota';
  } else if (todosSaoJogador) {
    estadoJogo = 'vitoria';
  }
}
