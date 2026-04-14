import { Graphics } from 'pixi.js';
import type { Nave, Mundo, Planeta, Sol, AlvoPonto, AcaoNaveParsed, Recursos } from '../types';
import { VELOCIDADE_NAVE, VELOCIDADE_ORBITA_NAVE, formatarId } from './constantes';
import { cheats } from '../ui/debug';
import { notifColonizacao, mostrarNotificacao } from '../ui/notificacao';
import { somConquista } from '../audio/som';

const COR_ROTA_NAVE = 0x27465f;
const COR_PONTO_ROTA_NAVE = 0x3d6888;
const ALPHA_ROTA_NAVE = 0.85;

function criarCargaVazia(): Recursos {
  return { comum: 0, raro: 0, combustivel: 0 };
}

function totalRecursos(recursos: Recursos): number {
  return recursos.comum + recursos.raro + recursos.combustivel;
}

function obterPlanetaAlvo(nave: Nave): Planeta | null {
  return nave.alvo && nave.alvo._tipoAlvo === 'planeta' ? nave.alvo : null;
}

export function capacidadeCargaCargueira(tier: number): number {
  return 30 * (2 ** Math.max(0, tier - 1));
}

function carregarRecursosPlaneta(planeta: Planeta, capacidade: number): Recursos {
  const carga = criarCargaVazia();
  let restante = capacidade;
  for (const tipo of ['comum', 'raro', 'combustivel'] as const) {
    if (restante <= 0) break;
    const disponivel = Math.floor(planeta.dados.recursos[tipo]);
    const quantidade = Math.min(disponivel, restante);
    planeta.dados.recursos[tipo] -= quantidade;
    carga[tipo] = quantidade;
    restante -= quantidade;
  }
  return carga;
}

function descarregarRecursosPlaneta(planeta: Planeta, carga: Recursos): void {
  planeta.dados.recursos.comum += carga.comum;
  planeta.dados.recursos.raro += carga.raro;
  planeta.dados.recursos.combustivel += carga.combustivel;
}

function totalConfigurado(nave: Nave): number {
  return totalRecursos(nave.configuracaoCarga);
}

function carregarConfiguracaoOrigem(nave: Nave, planeta: Planeta): Recursos {
  const carga = criarCargaVazia();
  for (const tipo of ['comum', 'raro', 'combustivel'] as const) {
    const desejado = Math.max(0, Math.floor(nave.configuracaoCarga[tipo]));
    const disponivel = Math.floor(planeta.dados.recursos[tipo]);
    const quantidade = Math.min(desejado, disponivel);
    planeta.dados.recursos[tipo] -= quantidade;
    carga[tipo] = quantidade;
  }
  return carga;
}

export function ajustarConfiguracaoCarga(nave: Nave, tipo: keyof Recursos, delta: number): void {
  if (nave.tipo !== 'cargueira') return;
  const capacidade = capacidadeCargaCargueira(nave.tier);
  const atual = nave.configuracaoCarga[tipo];
  const totalSemTipo = totalConfigurado(nave) - atual;
  const proximo = Math.max(0, Math.min(capacidade - totalSemTipo, atual + delta));
  nave.configuracaoCarga[tipo] = proximo;
}

export function definirPlanetaRotaCargueira(nave: Nave, modo: 'origem' | 'destino', planeta: Planeta): void {
  if (nave.tipo !== 'cargueira' || planeta.dados.dono !== 'jogador') return;
  nave.rotaCargueira ??= { origem: null, destino: null, loop: false, fase: 'origem' };
  nave.rotaCargueira[modo] = planeta;
}

export function alternarLoopCargueira(nave: Nave): void {
  if (nave.tipo !== 'cargueira') return;
  nave.rotaCargueira ??= { origem: null, destino: null, loop: false, fase: 'origem' };
  nave.rotaCargueira.loop = !nave.rotaCargueira.loop;
}

function processarLoopCargueira(nave: Nave): void {
  if (nave.tipo !== 'cargueira' || nave.estado !== 'orbitando' || !nave.rotaCargueira?.loop) return;
  const planetaAtual = obterPlanetaAlvo(nave);
  const rota = nave.rotaCargueira;
  if (!planetaAtual || !rota.origem || !rota.destino) return;
  if (totalConfigurado(nave) <= 0) return;

  if (rota.fase === 'origem' && planetaAtual === rota.origem && totalRecursos(nave.carga) <= 0) {
    const carga = carregarConfiguracaoOrigem(nave, planetaAtual);
    if (totalRecursos(carga) <= 0) return;
    nave.carga = carga;
    nave.origem = planetaAtual;
    rota.fase = 'destino';
    nave.estado = 'viajando';
    nave.alvo = rota.destino;
    nave.orbita = null;
    return;
  }

  if (rota.fase === 'destino' && planetaAtual === rota.destino && totalRecursos(nave.carga) <= 0) {
    rota.fase = 'origem';
    nave.estado = 'viajando';
    nave.alvo = rota.origem;
    nave.orbita = null;
  }
}

function desenharNaveGfx(nave: Nave): void {
  const g = nave.gfx;
  const tipo = nave.tipo || 'colonizadora';
  const tier = nave.tier || 1;
  const sel = nave.selecionado ? 0.95 : 0;
  g.clear();
  if (tipo === 'colonizadora') {
    g.poly([0, -10, 8, 8, 0, 4, -8, 8]).fill({ color: 0xffffff, alpha: 0.95 });
  } else if (tipo === 'cargueira') {
    const w = 10 + tier * 1.2;
    g.roundRect(-w, -7, w * 2, 14, 2).fill({ color: 0xa8d4ff, alpha: 0.95 });
    g.rect(-w * 0.4, -4, w * 0.8, 5).fill({ color: 0x446688, alpha: 0.9 });
  } else if (tipo === 'batedora') {
    g.poly([0, -9, 10, 0, 0, 9, -6, 0]).fill({ color: 0xffcc66, alpha: 0.95 });
  } else if (tipo === 'torreta') {
    const s = 5 + tier * 0.6;
    g.rect(-s, -s, s * 2, s * 2).fill({ color: 0xff6666, alpha: 0.95 });
    g.circle(0, 0, 3).fill({ color: 0xffaaaa, alpha: 0.95 });
  }
  g.circle(0, 0, 14).stroke({ color: 0x44aaff, width: 1.2, alpha: sel });
}

function desenharRotaNave(nave: Nave): void {
  const g = nave.rotaGfx;
  g.clear();
  const pontos: AlvoPonto[] = [];
  if (nave.alvo?._tipoAlvo === 'ponto') pontos.push(nave.alvo);
  if (nave.rotaManual.length > 0) pontos.push(...nave.rotaManual);
  if (pontos.length <= 0) return;

  g.moveTo(nave.x, nave.y);
  for (const ponto of pontos) {
    g.lineTo(ponto.x, ponto.y);
  }
  g.stroke({ color: COR_ROTA_NAVE, width: 1.2, alpha: ALPHA_ROTA_NAVE });

  for (const ponto of pontos) {
    g.circle(ponto.x, ponto.y, 3.5).fill({ color: 0x08111a, alpha: 0.96 });
    g.circle(ponto.x, ponto.y, 3.5).stroke({ color: COR_PONTO_ROTA_NAVE, width: 1.1, alpha: 0.92 });
  }
}

export function atualizarSelecaoNave(nave: Nave): void {
  desenharNaveGfx(nave);
}

function obterRaioAlvo(alvo: Planeta | Sol | AlvoPonto | null): number {
  if (!alvo) return 0;
  if (alvo._tipoAlvo === 'ponto') return 16;
  if (alvo._tipoAlvo === 'sol') return alvo._raio + 45;
  return alvo.dados.tamanho / 2 + 28;
}

export function entrarEmOrbita(nave: Nave, alvo: Planeta | Sol | AlvoPonto): void {
  // Use the current approach angle so the ship doesn't teleport to a random
  // point on the orbit circle. Fixed radius (no random jitter) so repeated
  // orbit entries don't visually bounce the ship in and out.
  const raio = obterRaioAlvo(alvo) + 20;
  const dx = nave.x - alvo.x;
  const dy = nave.y - alvo.y;
  const angulo = (dx === 0 && dy === 0) ? 0 : Math.atan2(dy, dx);
  nave.estado = 'orbitando';
  nave.alvo = alvo;
  nave.orbita = {
    raio,
    angulo,
    velocidade: VELOCIDADE_ORBITA_NAVE,
  };
}

export function criarNave(mundo: Mundo, planetaOrigem: Planeta, tipo: string, tier: number = 1): Nave {
  const nave: Nave = {
    id: formatarId('nave'),
    tipo, tier,
    dono: 'jogador',
    x: planetaOrigem.x, y: planetaOrigem.y,
    estado: 'orbitando',
    alvo: planetaOrigem,
    selecionado: false,
    origem: planetaOrigem,
    carga: criarCargaVazia(),
    configuracaoCarga: criarCargaVazia(),
    rotaManual: [],
    rotaCargueira: null,
    gfx: new Graphics(),
    rotaGfx: new Graphics(),
    _tipoAlvo: 'nave',
    orbita: null,
  };
  atualizarSelecaoNave(nave);
  nave.rotaGfx.eventMode = 'none';
  mundo.rotasContainer.addChild(nave.rotaGfx);
  mundo.navesContainer.addChild(nave.gfx);
  mundo.naves.push(nave);
  entrarEmOrbita(nave, planetaOrigem);
  return nave;
}

export function removerNave(mundo: Mundo, nave: Nave): void {
  if (nave.origem?.dados && nave.tipo === 'colonizadora') {
    nave.origem.dados.naves = Math.max(0, nave.origem.dados.naves - 1);
  }
  const idx = mundo.naves.indexOf(nave);
  if (idx >= 0) mundo.naves.splice(idx, 1);
  if (nave.rotaGfx) {
    mundo.rotasContainer.removeChild(nave.rotaGfx);
    nave.rotaGfx.destroy();
  }
  if (nave.gfx) {
    mundo.navesContainer.removeChild(nave.gfx);
    nave.gfx.destroy();
  }
}

export function atualizarNaves(mundo: Mundo, deltaMs: number): void {
  for (let i = mundo.naves.length - 1; i >= 0; i--) {
    const nave = mundo.naves[i];
    const alvo = nave.alvo;
    if (nave.estado === 'viajando' && alvo) {
      const dx = alvo.x - nave.x;
      const dy = alvo.y - nave.y;
      const dist = Math.hypot(dx, dy);
      const stopDist = obterRaioAlvo(alvo);
      const velReal = VELOCIDADE_NAVE * (cheats.velocidadeNave ? 10 : 1);
      if (dist <= stopDist + velReal * deltaMs) {
        const proximoPontoManual = alvo._tipoAlvo === 'ponto' ? nave.rotaManual.shift() ?? null : null;
        if (nave.tipo === 'colonizadora' && alvo._tipoAlvo === 'planeta' && alvo.dados.dono === 'neutro') {
          finalizarColonizacao(mundo, nave, alvo);
          continue;
        }
        if (nave.tipo === 'cargueira' && alvo._tipoAlvo === 'planeta' && alvo.dados.dono === 'jogador' && totalRecursos(nave.carga) > 0) {
          descarregarRecursosPlaneta(alvo, nave.carga);
          mostrarNotificacao(`Cargueira descarregou ${totalRecursos(nave.carga)} recursos.`, '#60ccff');
          nave.carga = criarCargaVazia();
          nave.origem = alvo;
        }
        if (alvo._tipoAlvo === 'ponto') {
          nave.x = alvo.x; nave.y = alvo.y;
          if (proximoPontoManual) {
            nave.estado = 'viajando';
            nave.alvo = proximoPontoManual;
            nave.orbita = null;
          } else {
            nave.estado = 'parado'; nave.alvo = null; nave.orbita = null;
          }
        } else {
          entrarEmOrbita(nave, alvo);
        }
      } else if (dist > 0) {
        nave.x += (dx / dist) * velReal * deltaMs;
        nave.y += (dy / dist) * velReal * deltaMs;
      }
    }
    if (nave.estado === 'orbitando' && nave.orbita && nave.alvo) {
      nave.orbita.angulo += nave.orbita.velocidade * deltaMs;
      nave.x = nave.alvo.x + Math.cos(nave.orbita.angulo) * nave.orbita.raio;
      nave.y = nave.alvo.y + Math.sin(nave.orbita.angulo) * nave.orbita.raio;
    }
    processarLoopCargueira(nave);
    desenharRotaNave(nave);
    nave.gfx.x = nave.x;
    nave.gfx.y = nave.y;
  }
}

function finalizarColonizacao(mundo: Mundo, nave: Nave, planeta: Planeta): void {
  planeta.dados.dono = 'jogador';
  planeta.dados.selecionado = false;
  removerNave(mundo, nave);
  notifColonizacao();
  somConquista();
}

export function encontrarNaveNoPonto(mundoX: number, mundoY: number, mundo: Mundo): Nave | null {
  for (let i = mundo.naves.length - 1; i >= 0; i--) {
    const nave = mundo.naves[i];
    const dx = nave.x - mundoX;
    const dy = nave.y - mundoY;
    if (dx * dx + dy * dy < 18 * 18) return nave;
  }
  return null;
}

export function obterNaveSelecionada(mundo: Mundo): Nave | null {
  return mundo.naves.find((n: Nave) => n.selecionado) || null;
}

export function selecionarNave(mundo: Mundo, nave: Nave | null): void {
  // Note: limparSelecoes is called from mundo.ts before this
  if (nave) {
    nave.selecionado = true;
    atualizarSelecaoNave(nave);
  }
}

export function enviarNaveParaAlvo(mundo: Mundo, nave: Nave, alvo: Planeta | Sol | AlvoPonto): boolean {
  if (!nave || !alvo) return false;
  nave.rotaManual = [];
  nave.estado = 'viajando';
  nave.alvo = alvo;
  nave.orbita = null;
  return true;
}

export function enviarNaveParaPosicao(mundo: Mundo, nave: Nave, wx: number, wy: number): boolean {
  if (!nave || nave.dono !== 'jogador') return false;
  nave.rotaManual = [];
  nave.estado = 'viajando';
  nave.alvo = { _tipoAlvo: 'ponto', x: wx, y: wy };
  nave.orbita = null;
  return true;
}

export function definirRotaManualNave(nave: Nave, pontos: AlvoPonto[]): boolean {
  if (!nave || nave.dono !== 'jogador' || pontos.length <= 0) return false;
  nave.rotaManual = pontos.map((p) => ({ _tipoAlvo: 'ponto', x: p.x, y: p.y }));
  nave.estado = 'viajando';
  nave.alvo = nave.rotaManual.shift() ?? null;
  nave.orbita = null;
  return !!nave.alvo;
}

export function cancelarMovimentoNave(nave: Nave): void {
  nave.rotaManual = [];
  nave.estado = 'parado';
  nave.alvo = null;
  nave.orbita = null;
}

export function parseAcaoNave(acao: string): AcaoNaveParsed | null {
  if (acao === 'nave_colonizadora') return { tipo: 'colonizadora', tier: 1 };
  const m = acao.match(/^nave_(cargueira|batedora|torreta)_([1-5])$/);
  if (m) return { tipo: m[1], tier: Number(m[2]) };
  return null;
}
