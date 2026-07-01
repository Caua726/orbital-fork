import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  registrarPlanetaVisto,
  jaViuPlaneta,
  registrarBaixa,
  registrarInvasao,
  observarForca,
  getForcaPercebida,
  marcarAtaque,
  getRancor,
  tempoDesdeUltimoAtaque,
  decairMemorias,
  resetMemoriasIa,
  getMemoriasIaSerializadas,
  restaurarMemoriasIa,
} from '../ia-memoria';

// The module keeps a single module-level Map of AI memories; reset before
// every test so cases don't bleed into each other.
beforeEach(() => resetMemoriasIa());

describe('ia-memoria: rancor (grudge from kills + invasions)', () => {
  it('registrarBaixa accrues 1.5 rancor per ship lost', () => {
    registrarBaixa('ia1', 'jogador');
    expect(getRancor('ia1', 'jogador')).toBeCloseTo(1.5);
    registrarBaixa('ia1', 'jogador');
    expect(getRancor('ia1', 'jogador')).toBeCloseTo(3.0);
  });

  it('getRancor returns 0 for an unknown/never-wronged faction', () => {
    expect(getRancor('ia1', 'jogador')).toBe(0);
    expect(getRancor('ninguem', 'ninguem')).toBe(0);
  });

  it('registrarBaixa ignores self-inflicted losses (donoIa === causador)', () => {
    registrarBaixa('ia1', 'ia1');
    expect(getRancor('ia1', 'ia1')).toBe(0);
  });

  it('registrarInvasao adds the default per-event amount (4.0) when no amount given', () => {
    registrarInvasao('ia1', 'jogador');
    expect(getRancor('ia1', 'jogador')).toBeCloseTo(4.0);
  });

  it('registrarInvasao adds a custom (small per-tick) amount when given', () => {
    registrarInvasao('ia1', 'jogador', 0.3);
    registrarInvasao('ia1', 'jogador', 0.3);
    expect(getRancor('ia1', 'jogador')).toBeCloseTo(0.6);
  });

  it('registrarInvasao ignores self (donoIa === invasor)', () => {
    registrarInvasao('ia1', 'ia1', 5);
    expect(getRancor('ia1', 'ia1')).toBe(0);
  });

  it('kills and invasions stack into the same rancor bucket', () => {
    registrarBaixa('ia1', 'jogador');       // +1.5
    registrarInvasao('ia1', 'jogador', 0.5); // +0.5
    expect(getRancor('ia1', 'jogador')).toBeCloseTo(2.0);
  });
});

describe('ia-memoria: perceived strength', () => {
  it('first observation records the fleet size exactly (weighted avg vs itself)', () => {
    observarForca('ia1', 'jogador', 10);
    expect(getForcaPercebida('ia1', 'jogador')).toBeCloseTo(10);
  });

  it('subsequent observations are a 70/30 weighted average toward the new value', () => {
    observarForca('ia1', 'jogador', 10); // -> 10
    observarForca('ia1', 'jogador', 20); // -> 10*0.7 + 20*0.3 = 13
    expect(getForcaPercebida('ia1', 'jogador')).toBeCloseTo(13);
    observarForca('ia1', 'jogador', 20); // -> 13*0.7 + 20*0.3 = 15.1
    expect(getForcaPercebida('ia1', 'jogador')).toBeCloseTo(15.1);
  });

  it('getForcaPercebida returns 0 for an unobserved faction', () => {
    expect(getForcaPercebida('ia1', 'jogador')).toBe(0);
  });
});

describe('ia-memoria: attack cooldown timestamps', () => {
  afterEach(() => vi.useRealTimers());

  it('tempoDesdeUltimoAtaque is Infinity before any attack is recorded', () => {
    expect(tempoDesdeUltimoAtaque('ia1', 'jogador')).toBe(Infinity);
  });

  it('marcarAtaque records now; tempoDesdeUltimoAtaque measures elapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    marcarAtaque('ia1', 'jogador');
    expect(tempoDesdeUltimoAtaque('ia1', 'jogador')).toBe(0);
    vi.setSystemTime(1_008_000);
    expect(tempoDesdeUltimoAtaque('ia1', 'jogador')).toBe(8000);
  });
});

describe('ia-memoria: recon memory (planetas vistos)', () => {
  it('registrarPlanetaVisto marks a planet as seen', () => {
    expect(jaViuPlaneta('ia1', 'pla-0-0')).toBe(false);
    registrarPlanetaVisto('ia1', 'pla-0-0');
    expect(jaViuPlaneta('ia1', 'pla-0-0')).toBe(true);
  });

  it('memory is per-AI — one AI seeing a planet does not reveal it to another', () => {
    registrarPlanetaVisto('ia1', 'pla-0-0');
    expect(jaViuPlaneta('ia2', 'pla-0-0')).toBe(false);
  });
});

describe('ia-memoria: decay', () => {
  it('rancor decays 5% per tick and is deleted once below 0.05', () => {
    registrarBaixa('ia1', 'jogador'); // 1.5
    decairMemorias('ia1');
    expect(getRancor('ia1', 'jogador')).toBeCloseTo(1.5 * 0.95);
    // Drive it below the 0.05 deletion floor.
    for (let i = 0; i < 100; i++) decairMemorias('ia1');
    expect(getRancor('ia1', 'jogador')).toBe(0);
  });

  it('forcaPercebida decays 2% per tick and is deleted once below 0.5', () => {
    observarForca('ia1', 'jogador', 10);
    decairMemorias('ia1');
    expect(getForcaPercebida('ia1', 'jogador')).toBeCloseTo(10 * 0.98);
    for (let i = 0; i < 500; i++) decairMemorias('ia1');
    expect(getForcaPercebida('ia1', 'jogador')).toBe(0);
  });

  it('prunes ultimoAtaque entries older than the 5-min TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    marcarAtaque('ia1', 'jogador');
    // Just under the TTL — kept.
    vi.setSystemTime(4 * 60 * 1000);
    decairMemorias('ia1');
    expect(tempoDesdeUltimoAtaque('ia1', 'jogador')).toBe(4 * 60 * 1000);
    // Past the TTL — pruned back to Infinity.
    vi.setSystemTime(6 * 60 * 1000);
    decairMemorias('ia1');
    expect(tempoDesdeUltimoAtaque('ia1', 'jogador')).toBe(Infinity);
    vi.useRealTimers();
  });

  it('caps planetasVistos at 200, keeping the most recent', () => {
    for (let i = 0; i < 205; i++) registrarPlanetaVisto('ia1', `pla-${i}`);
    decairMemorias('ia1');
    // Oldest 5 trimmed; newest kept.
    expect(jaViuPlaneta('ia1', 'pla-0')).toBe(false);
    expect(jaViuPlaneta('ia1', 'pla-4')).toBe(false);
    expect(jaViuPlaneta('ia1', 'pla-5')).toBe(true);
    expect(jaViuPlaneta('ia1', 'pla-204')).toBe(true);
  });
});

describe('ia-memoria: reset + save/load round-trip', () => {
  it('resetMemoriasIa wipes every AI memory', () => {
    registrarBaixa('ia1', 'jogador');
    registrarPlanetaVisto('ia1', 'pla-0-0');
    resetMemoriasIa();
    expect(getRancor('ia1', 'jogador')).toBe(0);
    expect(jaViuPlaneta('ia1', 'pla-0-0')).toBe(false);
  });

  it('serialize -> restore preserves rancor, força, ultimoAtaque and planetasVistos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5000);
    registrarBaixa('ia1', 'jogador');
    registrarInvasao('ia1', 'ia2', 2);
    observarForca('ia1', 'jogador', 7);
    marcarAtaque('ia1', 'jogador');
    registrarPlanetaVisto('ia1', 'pla-1-2');

    const dtos = getMemoriasIaSerializadas();
    expect(dtos).toHaveLength(1);
    // No Set instances leak into the DTO (planetasVistos is an array).
    expect(Array.isArray(dtos[0].planetasVistos)).toBe(true);

    resetMemoriasIa();
    expect(getRancor('ia1', 'jogador')).toBe(0);

    restaurarMemoriasIa(dtos);
    expect(getRancor('ia1', 'jogador')).toBeCloseTo(1.5);
    expect(getRancor('ia1', 'ia2')).toBeCloseTo(2);
    expect(getForcaPercebida('ia1', 'jogador')).toBeCloseTo(7);
    expect(jaViuPlaneta('ia1', 'pla-1-2')).toBe(true);
    expect(tempoDesdeUltimoAtaque('ia1', 'jogador')).toBe(0);
    vi.useRealTimers();
  });

  it('restaurarMemoriasIa replaces (does not merge) prior state', () => {
    registrarBaixa('ia9', 'jogador');
    restaurarMemoriasIa([]); // empty restore = wipe
    expect(getRancor('ia9', 'jogador')).toBe(0);
  });
});
