import type { Application } from 'pixi.js';
import type { Mundo, Sol, Planeta, Sistema, Nave, FonteVisao } from '../../types';
import type { MundoDTO, SolDTO, PlanetaDTO, NaveDTO, AlvoDTO } from './dto';
import { criarMundoVazio, aplicarZOrderMundo, type MundoVazio } from '../mundo';
import { GraphicsAdapter } from '../../core/graphics-adapter';
import { trackOrbitaLinha, trackAnel } from '../sistema';
import { criarEstrelaProcedural, criarPlanetaProceduralSprite, precompilarBakesPlanetas } from '../planeta-procedural';
import { rngFromSeed } from '../lore/seeded-rng';
import { criarMemoriaVisualPlaneta, restaurarMemoriaPlaneta } from '../nevoa';
import { resetarNomesPlanetas } from '../nomes';
import { instalarTrail } from '../engine-trails';
import { criarVisualNave, instalarWeydraSpriteNave } from '../naves';
import { restaurarMemoriasIa, resetMemoriasIa } from '../ia-memoria';
import { restaurarEventos, resetEventos } from '../eventos';
import { restaurarStats, resetStats } from '../stats';
import { restaurarBattles, resetBattles } from '../battle-log';
import { restaurarFirstContact, resetFirstContact } from '../first-contact';
import { restaurarLastSeen, resetLastSeen } from '../last-seen';
import { restaurarNomesUsados, resetNomesUsados } from '../proc-names';
// setIaTickState is intentionally NOT imported here — restoring tick
// state is the main.ts load orchestrator's job (after AI re-init).
import { buildDistanceMatrix } from '../distance-matrix';

export interface ReconstruirFactories {
  criarSol: (x: number, y: number, raio: number, rng?: () => number) => Sol;
  criarPlaneta: (x: number, y: number, tamanho: number, tipo: string, rng?: () => number) => Planeta;
  /**
   * When true, skip Pixi-dependent visual reconstruction (fog-of-war
   * memory visuals, stage mounting). Tests pass this to run without a
   * real renderer.
   */
  skipVisuals?: boolean;
}

const defaultFactories: ReconstruirFactories = {
  criarSol: (x, y, raio, rng) => criarEstrelaProcedural(x, y, raio, rng) as unknown as Sol,
  criarPlaneta: (x, y, tamanho, tipo, rng) =>
    criarPlanetaProceduralSprite(x, y, tamanho, tipo, undefined, rng) as unknown as Planeta,
};

/** Async fase callback — same signature as criarMundo's onFase. */
export type FaseLoadCallback = (label: string) => Promise<void>;
const noopLoadFase: FaseLoadCallback = async () => {};

export async function reconstruirMundo(
  dto: MundoDTO,
  app: Application,
  factories: ReconstruirFactories = defaultFactories,
  onFase: FaseLoadCallback = noopLoadFase,
): Promise<Mundo> {
  await onFase('Lendo arquivo do mundo');
  resetarNomesPlanetas();

  const mv = criarMundoVazio(dto.tamanho);

  // 1. Reconstruct sois first — they hold the system centers planets
  //    orbit around.
  await onFase('Reacendendo estrelas');
  const solsById = new Map<string, Sol>();
  for (const solDto of dto.sois) {
    const sol = reconstruirSol(solDto, factories);
    solsById.set(sol.id, sol);
    mv.container.addChild(sol);
  }

  // 2. Reconstruct planetas — position is derived from the saved orbit
  //    (centro + angulo + raio) so we don't need to persist x/y.
  await onFase('Restaurando planetas');
  const planetasById = new Map<string, Planeta>();
  for (const planetaDto of dto.planetas) {
    const planeta = reconstruirPlaneta(planetaDto, factories, mv);
    planetasById.set(planeta.id, planeta);
    mv.container.addChild(planeta);
  }

  // 3. Stack the overlay containers (orbits, fleets, ships, routes, fog,
  //    memory) on top of the sol/planet meshes we just added.
  aplicarZOrderMundo(mv);

  // 4. Reconstruct sistemas, resolving sol/planeta references by id.
  const sistemas: Sistema[] = dto.sistemas.map((sistemaDto) => {
    const sol = solsById.get(sistemaDto.solId);
    if (!sol) {
      throw new Error(`Save corrompido: sistema ${sistemaDto.id} referencia sol inexistente ${sistemaDto.solId}`);
    }
    const planetas = sistemaDto.planetaIds.map((pid) => {
      const p = planetasById.get(pid);
      if (!p) {
        throw new Error(`Save corrompido: sistema ${sistemaDto.id} referencia planeta inexistente ${pid}`);
      }
      return p;
    });
    return { id: sistemaDto.id, x: sistemaDto.x, y: sistemaDto.y, sol, planetas };
  });

  // Reassign dados.sistemaId to match the new array index, since the
  // serializer sorts by string id (lexicographic) which differs from
  // the original numeric creation order for indices >= 10.
  for (let i = 0; i < sistemas.length; i++) {
    for (const p of sistemas[i].planetas) {
      p.dados.sistemaId = i;
    }
  }

  const planetas = Array.from(planetasById.values());
  const sois = Array.from(solsById.values());

  // 4.5 Re-link sistemas
  await onFase('Reconectando sistemas estelares');

  // 5. Reconstruct naves
  await onFase(`Restaurando ${dto.naves.length} naves em órbita`);
  const naves: Nave[] = [];
  for (const naveDto of dto.naves) {
    const nave = reconstruirNave(naveDto, planetasById, solsById);
    naves.push(nave);
    if (!factories.skipVisuals) {
      mv.navesContainer.addChild(nave.gfx);
      nave.rotaGfx.attachTo(mv.rotasContainer);
      // Engine trail rendered behind the (placeholder) sprite.
      instalarTrail(nave);
      // Create the weydra sprite — without this loaded ships render only
      // their engine trail (the Pixi sprite is the dead no-op path). Same
      // call criarNave makes; `naves` is the liveness list for the retry.
      instalarWeydraSpriteNave(nave, naveDto.tipo, naveDto.tier, naves);
    }
  }

  // 6. Assemble the Mundo.
  const mundo: Mundo = {
    container: mv.container,
    tamanho: mv.tamanho,
    planetas,
    sistemas,
    sois,
    naves,
    fundo: mv.fundo,
    frotas: [] as unknown[],
    frotasContainer: mv.frotasContainer,
    navesContainer: mv.navesContainer,
    rotasContainer: mv.rotasContainer,
    tipoJogador: dto.tipoJogador,
    imperioJogador: dto.imperioJogador ? {
      nome: dto.imperioJogador.nome,
      logo: {
        seed: dto.imperioJogador.logo.seed,
        manual: dto.imperioJogador.logo.manual ? {
          frame: dto.imperioJogador.logo.manual.frame as import('../../ui/empire-builder/sigilos').Frame,
          motif: dto.imperioJogador.logo.manual.motif as import('../../ui/empire-builder/sigilos').MotifKind,
          ornament: dto.imperioJogador.logo.manual.ornament as import('../../ui/empire-builder/sigilos').Ornament,
          strokeWidth: dto.imperioJogador.logo.manual.strokeWidth,
        } : undefined,
      },
      pesos: { ...dto.imperioJogador.pesos },
      objetivo: dto.imperioJogador.objetivo,
      lore: dto.imperioJogador.lore as import('../lore/imperio-lore').ImperioLore | undefined,
      bonus: { ...dto.imperioJogador.bonus },
    } : undefined,
    ultimoTickMs: performance.now(),
    visaoContainer: mv.visaoContainer,
    orbitasContainer: mv.orbitasContainer,
    memoriaPlanetasContainer: mv.memoriaPlanetasContainer,
    fontesVisao: dto.fontesVisao.map((f: FonteVisao) => ({ ...f })),
    // Fresh soundtrack on every load — the saved seedMusical is
    // deliberately ignored so the player hears new procedural music
    // each time they return to a world. The new seed is written back
    // on the next save, so subsequent loads roll again from there.
    seedMusical: Math.floor(Math.random() * 0xFFFFFFFF),
    galaxySeed: dto.galaxySeed ?? Math.floor(Math.random() * 0xFFFFFFFF),
  } as Mundo;

  // 7. Rebuild fog-of-war memory visuals and restore captured snapshots.
  //    Tests flip skipVisuals so they don't need a real Pixi renderer.
  if (!factories.skipVisuals) {
    await onFase('Recuperando névoa de guerra');
    for (const planeta of planetas) {
      criarMemoriaVisualPlaneta(mundo, planeta);
      const dtoRef = dto.planetas.find((p) => p.id === planeta.id);
      if (!dtoRef?.memoria) continue;
      const m = dtoRef.memoria;
      restaurarMemoriaPlaneta(planeta, {
        conhecida: m.conhecida,
        x: m.snapshotX,
        y: m.snapshotY,
        // Rebase the absolute save-time timestamp onto the current
        // performance.now() clock so "X minutes ago" labels stay correct.
        timestamp: performance.now() - m.idadeMs,
        dados: { ...m.dados },
      });
    }
  }

  await onFase('Restaurando memórias das facções');
  restaurarEstadoGlobalDoSave(dto);
  // Note: iaTickState is intentionally NOT restored here — the caller
  // (main.ts) calls restaurarOuReinicializarIas next, which invokes
  // setPersonalidadesParaMundoCarregado → resetIasV2(), zeroing the tick
  // accumulator. setIaTickState must be called AFTER that handshake.

  // Rebuild the planet-to-planet distance cache so post-load AI decisions
  // don't eat a cold Math.hypot storm on their first tick.
  buildDistanceMatrix(mundo);

  // Pre-bake planetas pequenos antes do jogo voltar a rodar, igual ao
  // criarMundo faz. Evita os stalls dos primeiros 50 frames pós-load.
  // O zoom real é restaurado depois (main.ts), mas bakear pelo zoom 1.0
  // cobre a maioria dos casos; planetas que ficam grandes no zoom
  // restaurado vão ser unbaked naturalmente pelo loop.
  if (!factories.skipVisuals) {
    await onFase('Pré-renderizando planetas distantes');
    await precompilarBakesPlanetas(planetas, 1.0);
  }

  await onFase('Mundo carregado');
  return mundo;
}

/**
 * Restore all module-scoped state (AI memory, events, stats, etc.) from
 * the save. Caller must have already rebuilt the Mundo struct — this
 * step only touches in-process state of other modules.
 */
function restaurarEstadoGlobalDoSave(dto: MundoDTO): void {
  if (dto.iaMemoria) restaurarMemoriasIa(dto.iaMemoria);
  else resetMemoriasIa();

  if (dto.eventosHistorico) restaurarEventos(dto.eventosHistorico);
  else resetEventos();

  if (dto.statsAmostragem) restaurarStats(dto.statsAmostragem);
  else resetStats();

  if (dto.battleHistory) restaurarBattles(dto.battleHistory);
  else resetBattles();

  if (dto.firstContact) restaurarFirstContact(dto.firstContact);
  else resetFirstContact();

  if (dto.lastSeenInimigos) restaurarLastSeen(dto.lastSeenInimigos);
  else resetLastSeen();

  if (dto.procNamesUsados) restaurarNomesUsados(dto.procNamesUsados);
  else resetNomesUsados();
}

function reconstruirSol(dto: SolDTO, factories: ReconstruirFactories): Sol {
  // Old saves (pre-visualSeed) roll a fresh seed once here so the sun
  // still renders; we also write it back onto the Sol so the next save
  // captures it and future loads stay stable.
  const visualSeed = dto.visualSeed ?? ((Math.random() * 0xFFFFFFFF) >>> 0);
  const sol = factories.criarSol(dto.x, dto.y, dto.raio, rngFromSeed(visualSeed));
  sol.id = dto.id;
  sol._raio = dto.raio;
  sol._cor = dto.cor;
  sol._tipoAlvo = 'sol';
  sol._visivelAoJogador = dto.visivelAoJogador;
  sol._descobertoAoJogador = dto.descobertoAoJogador;
  sol._visualSeed = visualSeed;
  sol.visible = dto.visivelAoJogador || dto.descobertoAoJogador;
  return sol;
}

function reconstruirPlaneta(
  dto: PlanetaDTO,
  factories: ReconstruirFactories,
  mv: MundoVazio,
): Planeta {
  const x = dto.orbita.centroX + Math.cos(dto.orbita.angulo) * dto.orbita.raio;
  const y = dto.orbita.centroY + Math.sin(dto.orbita.angulo) * dto.orbita.raio;
  const visualSeed = dto.visualSeed ?? ((Math.random() * 0xFFFFFFFF) >>> 0);
  const planeta = factories.criarPlaneta(
    x, y, dto.dados.tamanho, dto.dados.tipoPlaneta, rngFromSeed(visualSeed),
  );
  planeta.id = dto.id;
  planeta._visualSeed = visualSeed;
  planeta._tipoAlvo = 'planeta';
  planeta._orbita = { ...dto.orbita };
  planeta.dados = {
    ...dto.dados,
    recursos: { ...dto.dados.recursos },
    fracProducao: { ...dto.dados.fracProducao },
    pesquisas: Object.fromEntries(
      Object.entries(dto.dados.pesquisas).map(([k, v]) => [k, [...v]]),
    ),
    filaProducao: dto.dados.filaProducao.map((i) => ({ ...i })),
    construcaoAtual: dto.dados.construcaoAtual ? { ...dto.dados.construcaoAtual } : null,
    producaoNave: dto.dados.producaoNave ? { ...dto.dados.producaoNave } : null,
    pesquisaAtual: dto.dados.pesquisaAtual ? { ...dto.dados.pesquisaAtual } : null,
    selecionado: false,
  };
  planeta._visivelAoJogador = dto.visivelAoJogador;
  planeta._descobertoAoJogador = dto.descobertoAoJogador;
  planeta.visible = dto.visivelAoJogador;

  // Recreate the Graphics children that criarSistemaSolar normally
  // attaches: the orbit ring (in orbitasContainer) and the selection
  // ring / construction overlay (children of the planeta itself).
  const linhaOrbita = GraphicsAdapter.create({ worldSpace: true, zOrder: 20 /* Z.ORBITS */ });
  // Match criarSistemaSolar's per-system sun-colour palette so loaded
  // orbits keep the same hue as freshly-created ones (was hardcoded
  // 0xffd166, recolouring every system where index % 4 != 0).
  const corSol = [0xffd166, 0xffb703, 0xfff1a8, 0xf4a261][dto.dados.sistemaId % 4];
  linhaOrbita.circle(dto.orbita.centroX, dto.orbita.centroY, dto.orbita.raio)
    .stroke({ color: corSol, width: 2, alpha: 0.3 });
  linhaOrbita.attachTo(mv.orbitasContainer);
  planeta._linhaOrbita = linhaOrbita as unknown as typeof planeta._linhaOrbita;
  // Track for destruirWeidraGraphicsGlobais cleanup. Without this,
  // every save-load leaks a weydra Graphics + GPU buffer.
  trackOrbitaLinha(linhaOrbita);

  const anel = GraphicsAdapter.create({ worldSpace: true, zOrder: 55 /* Z.UI_HOVER */ });
  anel.attachTo(planeta);
  planeta._anel = anel;
  // Register the ring so world teardown frees it (same as the live create
  // path). Without this every loaded planet's ring leaks per world.
  trackAnel(planeta, anel);

  return planeta;
}

function reconstruirNave(
  dto: NaveDTO,
  planetasById: Map<string, Planeta>,
  solsById: Map<string, Sol>,
): Nave {
  const origem = planetasById.get(dto.origemId);
  if (!origem) throw new Error(`Save corrompido: referência órfã ${dto.origemId}`);

  const alvo = resolverAlvo(dto.alvo, planetasById, solsById);

  let rotaCargueira: Nave['rotaCargueira'] = null;
  if (dto.rotaCargueira) {
    const rOrigem = dto.rotaCargueira.origemId
      ? planetasById.get(dto.rotaCargueira.origemId) ?? null
      : null;
    if (dto.rotaCargueira.origemId && !rOrigem) {
      throw new Error(`Save corrompido: referência órfã ${dto.rotaCargueira.origemId}`);
    }
    const rDestino = dto.rotaCargueira.destinoId
      ? planetasById.get(dto.rotaCargueira.destinoId) ?? null
      : null;
    if (dto.rotaCargueira.destinoId && !rDestino) {
      throw new Error(`Save corrompido: referência órfã ${dto.rotaCargueira.destinoId}`);
    }
    rotaCargueira = {
      origem: rOrigem,
      destino: rDestino,
      loop: dto.rotaCargueira.loop,
      fase: dto.rotaCargueira.fase,
    };
  }

  // Build the sprite + ring via the shared helper so loaded ships
  // have the same visual structure as freshly-created ones.
  const visual = criarVisualNave(dto.tipo, dto.tier);

  return {
    id: dto.id,
    tipo: dto.tipo,
    tier: dto.tier,
    dono: dto.dono,
    x: dto.x,
    y: dto.y,
    estado: dto.estado,
    alvo,
    surveyTempoRestanteMs: dto.surveyTempoRestanteMs,
    surveyTempoTotalMs: dto.surveyTempoTotalMs,
    thrustX: dto.thrustX,
    thrustY: dto.thrustY,
    selecionado: false,
    origem,
    carga: { ...dto.carga },
    configuracaoCarga: { ...dto.configuracaoCarga },
    rotaManual: dto.rotaManual.map((p) => ({ _tipoAlvo: 'ponto' as const, x: p.x, y: p.y })),
    rotaCargueira,
    gfx: visual.gfx,
    rotaGfx: GraphicsAdapter.create({ worldSpace: true, zOrder: 25 /* Z.ROUTES */ }),
    _tipoAlvo: 'nave',
    _sprite: visual.sprite,
    _ring: visual.ring,
    orbita: dto.orbita ? { ...dto.orbita } : null,
    hp: dto.hp,
    // Rebase the fire cooldown to load time. dto.ultimoTiroMs is an absolute
    // performance.now() from the saving session; restoring it verbatim
    // breaks the cooldown gate (`now - lastShot`) — after a page reload
    // performance.now() restarts near 0 while the restored value is huge, so
    // `now - huge` stays negative and the ship can't fire for as long as the
    // previous session had run. Reset to "fired now" so each ship simply
    // waits one fresh cooldown after the world loads.
    _ultimoTiroMs: dto.ultimoTiroMs !== undefined ? performance.now() : undefined,
    _scrapAoChegar: dto.scrapAoChegar,
  } as Nave;
}

function resolverAlvo(
  alvoDto: AlvoDTO | null,
  planetasById: Map<string, Planeta>,
  solsById: Map<string, Sol>,
): Nave['alvo'] {
  if (!alvoDto) return null;
  if (alvoDto.tipo === 'planeta') {
    const p = planetasById.get(alvoDto.id);
    if (!p) throw new Error(`Save corrompido: referência órfã ${alvoDto.id}`);
    return p;
  }
  if (alvoDto.tipo === 'sol') {
    const s = solsById.get(alvoDto.id);
    if (!s) throw new Error(`Save corrompido: referência órfã ${alvoDto.id}`);
    return s;
  }
  return { _tipoAlvo: 'ponto', x: alvoDto.x, y: alvoDto.y };
}
