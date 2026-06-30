import { Container } from 'pixi.js';
import { GraphicsAdapter } from '../core/graphics-adapter';
import type { Sol, Planeta, Sistema } from '../types';
import { DIST_MIN_SISTEMA } from './constantes';
import { TIPO_PLANETA } from './planeta';
import { criarPlanetaProceduralSprite, criarEstrelaProcedural } from './planeta-procedural';
import { criarEstadoPesquisas } from './pesquisa';
import { gerarNomePlaneta } from './nomes';
import { rngFromSeed } from './lore/seeded-rng';
import { getWeydraRenderer } from '../weydra-loader';
import { getConfig } from '../core/config';
import { Z } from '../core/render-order';

function sortearTipoPlaneta(): string {
  const tipos = Object.values(TIPO_PLANETA);
  return tipos[Math.floor(Math.random() * tipos.length)];
}

export interface OpcoesSistema {
  /**
   * When set, forces the first planet of this system to use this tipo
   * instead of a random pick. Used by criarMundo to guarantee at least
   * one COMUM planet exists at worldgen time (so the player has a valid
   * starter) without having to re-create a sprite afterward.
   */
  forcarTipoPrimeiro?: string;
}

export function criarSistemaSolar(container: Container, orbitasContainer: Container, centroX: number, centroY: number, indiceSistema: number, opts: OpcoesSistema = {}): Sistema {
  const corSol = [0xffd166, 0xffb703, 0xfff1a8, 0xf4a261][indiceSistema % 4];
  const quantidadePlanetas = 1 + Math.floor(Math.random() * 5);
  const tamanhosPlaneta = Array.from({ length: quantidadePlanetas }, () => 140 + Math.random() * 170);
  const maiorPlaneta = Math.max(...tamanhosPlaneta);
  const raioSol = Math.max(110 + Math.random() * 60, maiorPlaneta * 1.5);

  // Per-entity visual seed — drives palette + uSeed uniform so save/
  // load preserves the exact shader output. Gerado uma única vez aqui
  // e persistido em _visualSeed; na reconstrução, o save fornece o
  // mesmo número de volta.
  const solVisualSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
  const solMesh = criarEstrelaProcedural(centroX, centroY, raioSol, rngFromSeed(solVisualSeed));
  const sol = solMesh as unknown as Sol;
  sol.id = `sol-${indiceSistema}`;
  sol._visualSeed = solVisualSeed;
  sol._raio = raioSol;
  sol._cor = corSol;
  sol._tipoAlvo = 'sol';
  sol._visivelAoJogador = false;
  sol._descobertoAoJogador = false;
  sol.visible = false;
  container.addChild(sol);

  const planetas: Planeta[] = [];
  let ultimoRaioOrbita = raioSol;
  let ultimoRaioPlaneta = 0;
  const margemEntreOrbital = 90;

  for (let i = 0; i < quantidadePlanetas; i++) {
    const tamanho = tamanhosPlaneta[i];
    const raioPlaneta = tamanho / 2;
    const distanciaMinDoSol = raioSol * 1.5 + raioPlaneta + 220;
    const distanciaMinDoAnterior = ultimoRaioOrbita + ultimoRaioPlaneta + raioPlaneta + margemEntreOrbital;
    const baseOrbita = i === 0 ? distanciaMinDoSol : Math.max(distanciaMinDoSol, distanciaMinDoAnterior);
    const raioOrbita = baseOrbita + Math.random() * 70;
    const anguloInicial = Math.random() * Math.PI * 2;
    const velocidade = 0.00003 + Math.random() * 0.000025;
    const tipoPlaneta = (i === 0 && opts.forcarTipoPrimeiro)
      ? opts.forcarTipoPrimeiro
      : sortearTipoPlaneta();
    // Orbit line: circle around the sun at the planet's orbital radius.
// Behind M7, this draws via the weydra-renderer Graphics primitive
// (lyon tessellation) when weydra.graphics is on, with worldSpace=true
// so the camera transform in graphics.wgsl positions it correctly.
// Pixi fallback otherwise — the existing canvas-2D path stays valid.
const weydraRenderer = getWeydraRenderer();
// M10: weydra.graphics is now true by default (CP1). The check is a
// no-op; left as-is for the M10.1 cleanup pass that fully removes
// the Pixi fallback body below. The else branch (line 95) is
// DEAD CODE — kept temporarily for the M10 transition safety net.
const useWeydraGraphics = weydraRenderer !== null;
  const linhaOrbita: GraphicsAdapter = (() => {
    if (useWeydraGraphics) {
      // weydra Graphics doesn't have a `visible` flag — visibility is
      // expressed via tessellation (don't render if no commands). For an
      // orbit line we want it always visible. The Pixi path's `visible=false`
      // toggling is irrelevant on the weydra path.
      // Build via GraphicsAdapter so the renderer ref is captured
      // (needed by destroy() to free the SlotMap handle).
      const g = GraphicsAdapter.create({ worldSpace: true, zOrder: Z.ORBITS });
      g.circle(centroX, centroY, raioOrbita).stroke({ color: corSol, width: 2, alpha: 0.3 });
      trackOrbitaLinha(g);
      return g;
    }
    const pixiG = GraphicsAdapter.create({ worldSpace: true, zOrder: Z.ORBITS });
    pixiG.visible = false;
    pixiG.circle(centroX, centroY, raioOrbita).stroke({
      color: corSol,
      width: 2,
      alpha: 0.3,
    });
    pixiG.attachTo(orbitasContainer);
    return pixiG;
  })();

    const planetVisualSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const sprite = criarPlanetaProceduralSprite(
      centroX + Math.cos(anguloInicial) * raioOrbita,
      centroY + Math.sin(anguloInicial) * raioOrbita,
      tamanho,
      tipoPlaneta,
      undefined,
      rngFromSeed(planetVisualSeed),
    );
    const p = sprite as unknown as Planeta;
    p.id = `pla-${indiceSistema}-${i}`;
    p._visualSeed = planetVisualSeed;

    p.dados = {
      dono: 'neutro',
      tipoPlaneta,
      nome: gerarNomePlaneta(tipoPlaneta),
      producao: 1,
      recursos: { comum: 0, raro: 0, combustivel: 0 },
      tamanho,
      selecionado: false,
      fabricas: 0,
      infraestrutura: 0,
      naves: 0,
      acumuladorRecursosMs: 0,
      fracProducao: { comum: 0, raro: 0, combustivel: 0 },
      sistemaId: indiceSistema,
      construcaoAtual: null,
      producaoNave: null,
      filaProducao: [],
      repetirFilaProducao: false,
      pesquisas: criarEstadoPesquisas(),
      pesquisaAtual: null,
    };
    p._tipoAlvo = 'planeta';
    p._orbita = {
      centroX,
      centroY,
      raio: raioOrbita,
      angulo: anguloInicial,
      velocidade,
    };
    p._linhaOrbita = linhaOrbita;
    p._visivelAoJogador = false;
    p._descobertoAoJogador = false;

    const anel = GraphicsAdapter.create({ worldSpace: true, zOrder: 55 /* Z.UI_HOVER */ });
    anel.attachTo(p);
    p._anel = anel;
    // Register so destruirWeidraGraphicsGlobais frees it on world teardown —
    // the weydra ring has no Pixi parent, so the container destroy cascade
    // never reaches it. Without this every planet's ring leaks per world.
    trackAnel(p, anel);

    p.visible = false;
    container.addChild(p);
    planetas.push(p);
    ultimoRaioOrbita = raioOrbita;
    ultimoRaioPlaneta = raioPlaneta;
  }

  return { id: `sys-${indiceSistema}`, x: centroX, y: centroY, sol, planetas };
}

/**
 * Module-level registry of weydra Graphics (orbit lines + planet
 * anel) so destruirMundo can call destroy() on every entry and free
 * the SlotMap handles. Without this, every world the player
 * generates leaks Graphics + GPU buffers (review: Graphics handle
 * leak). The planet anel registry uses the Planeta object as key;
 * entries are removed when the Planeta is GC'd, or explicitly here.
 */
const _weydraOrbitas: GraphicsAdapter[] = [];
const _weydraAneis: Map<object, GraphicsAdapter> = new Map();

export function trackOrbitaLinha(g: GraphicsAdapter): void {
  _weydraOrbitas.push(g);
}

export function trackAnel(planeta: object, g: GraphicsAdapter): void {
  _weydraAneis.set(planeta, g);
}

/**
 * Destroy every weydra Graphics registered via trackOrbitaLinha /
 * trackAnel. Called from destruirMundo.
 */
export function destruirWeidraGraphicsGlobais(): void {
  for (const g of _weydraOrbitas) g.destroy();
  _weydraOrbitas.length = 0;
  for (const g of _weydraAneis.values()) g.destroy();
  _weydraAneis.clear();
}

export { DIST_MIN_SISTEMA };
