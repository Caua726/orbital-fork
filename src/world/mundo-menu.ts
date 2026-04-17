import { Container } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Planeta, Sistema } from '../types';
import { getCamera } from '../core/player';
import { criarFundo, atualizarFundo } from './fundo';
import { criarSistemaSolar } from './sistema';
import { atualizarTempoPlanetas, atualizarLuzPlaneta } from './planeta-procedural';
import { carregarSpritesheetNaves } from './naves';
import { resetarNomesPlanetas } from './nomes';

/**
 * A lightweight menu-background "world": just one procedural solar
 * system, its background stars, and a minimal per-frame tick. No fog,
 * no fleets, no memory, no player ownership — the ticker only updates
 * planet orbits and shader uniforms so the system feels alive.
 *
 * This exists so the main menu doesn't have to pay the cost of
 * criarMundo() (which generates 18 systems, fog buffers, memory
 * snapshots, etc). When the player clicks Novo Jogo, this whole
 * container is destroyed and the real criarMundo() runs.
 */

export interface MundoMenu {
  container: Container;
  orbitasContainer: Container;
  fundo: ReturnType<typeof criarFundo>;
  sistema: Sistema;
  planetas: Planeta[];
  tamanho: number;
}

export async function criarMundoMenu(app: Application): Promise<MundoMenu> {
  // Reset procedural name dedupe so the real game's name pool isn't
  // polluted by the menu's throwaway system.
  resetarNomesPlanetas();
  // Prewarm the ship spritesheet even though the menu has no ships —
  // this just saves a fetch when the real game starts right after.
  void carregarSpritesheetNaves();

  const tamanho = Math.max(window.innerWidth, window.innerHeight) * 6;
  const container = new Container();

  const fundo = criarFundo(tamanho);
  container.addChild(fundo);

  const orbitasContainer = new Container();

  // One system centered at the middle of the virtual world.
  const cx = tamanho / 2;
  const cy = tamanho / 2;
  const sistema = criarSistemaSolar(container, orbitasContainer, cx, cy, 0);

  container.addChild(orbitasContainer);

  // Mark every planet + the sun as permanently visible/discovered so the
  // shaders run and nothing is hidden by the fog/memory system (which
  // we aren't mounting at all here).
  for (const planeta of sistema.planetas) {
    planeta._visivelAoJogador = true;
    planeta._descobertoAoJogador = true;
    planeta.visible = true;
    // Orbit lines default to hidden; show them so the menu looks lived-in.
    if (planeta._linhaOrbita) planeta._linhaOrbita.visible = true;
  }
  sistema.sol._visivelAoJogador = true;
  sistema.sol._descobertoAoJogador = true;
  sistema.sol.visible = true;

  return {
    container,
    orbitasContainer,
    fundo,
    sistema,
    planetas: sistema.planetas,
    tamanho,
  };
}

/**
 * Per-frame update for the menu background: advances planet orbits,
 * updates their shader-side time uniforms, re-applies the sun light
 * direction, and scrolls the parallax starfield to match the camera.
 */
export function atualizarMundoMenu(
  mundo: MundoMenu,
  app: Application,
  camX: number,
  camY: number,
  deltaMs: number,
): void {
  for (const planeta of mundo.planetas) {
    planeta._orbita.angulo += planeta._orbita.velocidade * deltaMs;
    planeta.x = planeta._orbita.centroX + Math.cos(planeta._orbita.angulo) * planeta._orbita.raio;
    planeta.y = planeta._orbita.centroY + Math.sin(planeta._orbita.angulo) * planeta._orbita.raio;
    atualizarLuzPlaneta(planeta, mundo.sistema.sol.x, mundo.sistema.sol.y);
  }
  atualizarTempoPlanetas(mundo.planetas, deltaMs);
  atualizarTempoPlanetas([mundo.sistema.sol], deltaMs);
  const zoom = getCamera().zoom || 1;
  atualizarFundo(mundo.fundo, camX, camY, app.screen.width / zoom, app.screen.height / zoom);
}

export function destruirMundoMenu(mundo: MundoMenu, app: Application): void {
  if (mundo.container.parent) {
    mundo.container.parent.removeChild(mundo.container);
  }
  mundo.container.destroy({ children: true });
  // Canvas context is shared with whatever replaces us — we don't touch
  // app here.
  void app;
}
