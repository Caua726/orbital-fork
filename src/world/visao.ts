import type { Mundo, Planeta, FonteVisao, Camera, Application } from '../types';
import { RAIO_VISAO_BASE, RAIO_VISAO_NAVE, RAIO_VISAO_BATEDORA, RAIO_VISAO_COLONIZADORA } from './constantes';
import { cheats } from '../ui/debug';
import { desenharNeblinaVisao, registrarMemoriaPlaneta } from './nevoa';

function calcularRaioVisaoPlaneta(planeta: Planeta): number {
  return RAIO_VISAO_BASE() + planeta.dados.tamanho * 0.2;
}

export function revelarSistemaCompleto(mundo: Mundo, sistemaId: number): void {
  for (const planeta of mundo.planetas) {
    if (planeta.dados.sistemaId !== sistemaId) continue;
    if (!planeta._descobertoAoJogador) {
      planeta._descobertoAoJogador = true;
      registrarMemoriaPlaneta(planeta);
    }
  }
}

export function pontoDentroDaVisao(x: number, y: number, fontesVisao: FonteVisao[]): boolean {
  for (const fonte of fontesVisao) {
    const dx: number = fonte.x - x;
    const dy: number = fonte.y - y;
    if (dx * dx + dy * dy <= fonte.raio * fonte.raio) return true;
  }
  return false;
}

// Reused scratch pool for per-frame FonteVisao objects. Pre-allocated
// once at module load; atualizarCampoDeVisao grabs from the pool so
// no GC pressure from a 60 Hz visibility tick.
const _fontePool: FonteVisao[] = [];
let _fontePoolUsed = 0;
function grabFonte(): FonteVisao {
  if (_fontePoolUsed < _fontePool.length) return _fontePool[_fontePoolUsed++];
  const f: FonteVisao = { x: 0, y: 0, raio: 0 };
  _fontePool.push(f);
  _fontePoolUsed++;
  return f;
}

export function atualizarCampoDeVisao(mundo: Mundo, camera: Camera, app: Application): void {
  _fontePoolUsed = 0;
  // Reuse mundo.fontesVisao's own array rather than allocating fresh
  // each frame (60 Hz × any session length ⇒ millions of dead arrays).
  const fontesVisao = mundo.fontesVisao;
  fontesVisao.length = 0;

  for (const planeta of mundo.planetas) {
    if (planeta.dados.dono !== 'jogador') continue;
    const f = grabFonte();
    f.x = planeta.x;
    f.y = planeta.y;
    f.raio = calcularRaioVisaoPlaneta(planeta);
    fontesVisao.push(f);
  }

  for (const nave of mundo.naves) {
    // HUGE perf fix: only player-owned ships contribute to the player's
    // fog-of-war vision. Before: with SHIP_CAP_MUNDO=300 and a long
    // session where AIs saturate the cap, pontoDentroDaVisao was doing
    // 300+ circle tests per planet per frame — mostly useless work
    // (the player can't see through enemy ships). This alone cut fog
    // cost by ~10× on long idle sessions.
    if (nave.dono !== 'jogador') continue;
    let raio: number;
    if (nave.tipo === 'batedora') raio = RAIO_VISAO_BATEDORA();
    else if (nave.tipo === 'colonizadora') raio = RAIO_VISAO_COLONIZADORA();
    else raio = RAIO_VISAO_NAVE();
    const f = grabFonte();
    f.x = nave.x;
    f.y = nave.y;
    f.raio = raio;
    fontesVisao.push(f);
  }
  if (cheats.visaoTotal) {
    mundo.visaoContainer.removeChildren();
  } else {
    desenharNeblinaVisao(mundo, fontesVisao, camera, app.screen.width, app.screen.height, camera.zoom);
  }

  for (const sol of mundo.sois) {
    sol._visivelAoJogador = cheats.visaoTotal || pontoDentroDaVisao(sol.x, sol.y, fontesVisao);
    if (sol._visivelAoJogador) {
      sol._descobertoAoJogador = true;
    }
  }

  for (const planeta of mundo.planetas) {
    planeta._visivelAoJogador =
      cheats.visaoTotal ||
      planeta.dados.dono === 'jogador' ||
      pontoDentroDaVisao(planeta.x, planeta.y, fontesVisao);

    if (planeta._visivelAoJogador) {
      planeta._descobertoAoJogador = true;
      registrarMemoriaPlaneta(planeta);
    }

    if (!planeta._visivelAoJogador && planeta.dados.selecionado) {
      planeta.dados.selecionado = false;
    }
  }
}
