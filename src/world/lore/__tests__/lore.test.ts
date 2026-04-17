/**
 * Tests for the deep lore generators.
 *
 * Focus is determinism (same seed → same output) and coverage (all
 * required fields populate with sensible content).
 */

import { describe, it, expect } from 'vitest';
import { gerarPlanetaLore, formatarPlanetaLore } from '../planeta-lore';
import { gerarImperioLore, formatarImperioLore } from '../imperio-lore';

describe('gerarPlanetaLore', () => {
  it('is deterministic for the same inputs', () => {
    const ctx = {
      planetaId: 'pla-0-0',
      galaxySeed: 12345,
      tipo: 'comum',
      dono: 'inimigo1',
      nomePlaneta: 'Kyra',
      tamanho: 200,
      donoNome: 'Ordem Kiv Rak',
      donoArquetipo: 'warlord' as const,
    };
    const a = gerarPlanetaLore(ctx);
    const b = gerarPlanetaLore(ctx);
    expect(a).toEqual(b);
  });

  it('produces different lore across a range of seeds', () => {
    const base = {
      planetaId: 'pla-0-0',
      tipo: 'comum',
      dono: 'inimigo1',
      nomePlaneta: 'Kyra',
      tamanho: 200,
    };
    // Any two specific seeds might collide on a single field; check that
    // across several seeds, the full biographies as a whole aren't all
    // identical. Determinism per seed is covered by the previous test.
    const variants = [1, 42, 99, 1234, 999999].map((s) =>
      JSON.stringify(gerarPlanetaLore({ ...base, galaxySeed: s })),
    );
    const unique = new Set(variants);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('always fills required fields', () => {
    const lore = gerarPlanetaLore({
      planetaId: 'pla-1-1',
      galaxySeed: 42,
      tipo: 'marte',
      dono: 'neutro',
      nomePlaneta: 'Ryx',
      tamanho: 180,
    });
    expect(lore.slogan).toBeTruthy();
    expect(lore.geologia).toBeTruthy();
    expect(lore.biomas).toBeTruthy();
    expect(lore.costumes).toBeTruthy();
    expect(lore.religiao).toBeTruthy();
    expect(lore.economia).toBeTruthy();
    expect(lore.nota).toBeTruthy();
  });

  it('has no colonizacao for neutro planets', () => {
    const lore = gerarPlanetaLore({
      planetaId: 'pla-2-0',
      galaxySeed: 99,
      tipo: 'gasoso',
      dono: 'neutro',
      nomePlaneta: 'Zorath',
      tamanho: 300,
    });
    expect(lore.colonizacao).toBeNull();
  });

  it('includes owner name in colonizacao for AI planets', () => {
    const lore = gerarPlanetaLore({
      planetaId: 'pla-3-0',
      galaxySeed: 7,
      tipo: 'comum',
      dono: 'inimigo2',
      donoNome: 'Confederação Aelith',
      donoArquetipo: 'trader',
      nomePlaneta: 'Mael',
      tamanho: 210,
    });
    expect(lore.colonizacao).not.toBeNull();
    expect(lore.colonizacao!.fundador).toBe('Confederação Aelith');
  });

  it('formats as multi-section chronicle', () => {
    const lore = gerarPlanetaLore({
      planetaId: 'pla-4-1',
      galaxySeed: 88,
      tipo: 'comum',
      dono: 'jogador',
      nomePlaneta: 'Elaria',
      tamanho: 200,
    });
    const formatted = formatarPlanetaLore(lore, 'Elaria');
    expect(formatted).toContain('Geologia:');
    expect(formatted).toContain('Costumes:');
    expect(formatted).toContain('Religião:');
    expect(formatted).toContain('Economia:');
  });
});

import type { PersonalidadeIA } from '../../personalidade-ia';

function mockPersonalidade(over: Partial<PersonalidadeIA> = {}): PersonalidadeIA {
  return {
    id: 'inimigo1',
    nome: 'Ordem Kiv Rak',
    cor: 0xff5555,
    arquetipo: 'warlord',
    pesos: { agressao: 1.4, expansao: 0.9, economia: 0.7, ciencia: 0.6, defesa: 0.5, vinganca: 1.2 },
    naveFavorita: 'fragata',
    frotaMinAtaque: 4,
    paciencia: 1,
    frotaMax: 30,
    forca: 1.0,
    ...over,
  } as PersonalidadeIA;
}

describe('gerarImperioLore', () => {
  it('is deterministic', () => {
    const ctx = {
      empireId: 'inimigo1',
      galaxySeed: 12345,
      personalidade: mockPersonalidade(),
      nomeImperio: 'Ordem Kiv Rak',
    };
    const a = gerarImperioLore(ctx);
    const b = gerarImperioLore(ctx);
    expect(a).toEqual(b);
  });

  it('populates every section with real prose content', () => {
    const lore = gerarImperioLore({
      empireId: 'inimigo1',
      galaxySeed: 99,
      personalidade: mockPersonalidade({ arquetipo: 'scientist' }),
      nomeImperio: 'Academia Okhar',
    });
    expect(lore.titulo).toBe('Academia Okhar');
    // Subtitle must contain an archetype-specific adjective, not just non-empty.
    expect(lore.subtitulo).toMatch(/tecnocracia|império|confederação|liga|povo/i);
    // Profile must use the allowed vocabulary, not arbitrary strings.
    expect(['baixa', 'moderada', 'alta', 'extrema']).toContain(lore.perfil.agressao);
    expect(['contida', 'regular', 'agressiva']).toContain(lore.perfil.expansao);
    // Must have the five canonical sections.
    const titulos = lore.secoes.map((s) => s.titulo);
    expect(titulos).toEqual(expect.arrayContaining([
      'Origem', 'Governo e propósito', 'Cultura e cotidiano', 'Doutrina militar', 'O presente',
    ]));
    // Each paragraph must be a real sentence (contain a verb-like pattern
    // and end with punctuation) — not just >20 chars of junk.
    for (const sec of lore.secoes) {
      for (const p of sec.paragrafos) {
        expect(p).toMatch(/^[A-ZÁÂÃÀÇÉÊÍÓÔÕÚÑ]/);        // starts capitalized
        expect(p).toMatch(/[.!?]$/);                      // ends with punctuation
        expect(p).not.toContain('undefined');
        expect(p).not.toContain('NaN');
        expect(p).not.toContain('[object');
      }
    }
    // Proverbs must be quoted or real sentences.
    for (const prov of lore.proverbios) {
      expect(prov.length).toBeGreaterThan(10);
      expect(prov).not.toContain('undefined');
    }
    expect(lore.proverbios.length).toBeGreaterThanOrEqual(3);
  });

  it('weight-driven: specific fields change when personality genome changes', () => {
    const extremo = gerarImperioLore({
      empireId: 'e1', galaxySeed: 1,
      personalidade: mockPersonalidade({
        pesos: { agressao: 1.6, expansao: 1.2, economia: 0.4, ciencia: 0.3, defesa: 0.4, vinganca: 1.5 },
        paciencia: 1, frotaMax: 34, frotaMinAtaque: 2, naveFavorita: 'fragata',
      }),
      nomeImperio: 'X',
    });
    const moderado = gerarImperioLore({
      empireId: 'e1', galaxySeed: 1,
      personalidade: mockPersonalidade({
        pesos: { agressao: 1.0, expansao: 0.9, economia: 1.0, ciencia: 0.8, defesa: 0.9, vinganca: 0.7 },
        paciencia: 6, frotaMax: 20, frotaMinAtaque: 6, naveFavorita: 'torreta',
      }),
      nomeImperio: 'X',
    });
    // Profile intensity must differ across several axes — this is
    // derived directly from pesos.* thresholds, not from RNG.
    expect(extremo.perfil.agressao).toBe('extrema');
    expect(moderado.perfil.agressao).toBe('moderada');
    expect(extremo.perfil.vinganca).toBe('implacável');
    expect(moderado.perfil.vinganca).toBe('esquecida');

    // Military section must cite the specific naveFavorita by its
    // translated label.
    const militarExtr = extremo.secoes.find((s) => s.titulo === 'Doutrina militar')!;
    const militarMod = moderado.secoes.find((s) => s.titulo === 'Doutrina militar')!;
    const proseExtr = militarExtr.paragrafos.join(' ');
    const proseMod = militarMod.paragrafos.join(' ');
    expect(proseExtr).toContain('fragatas de combate');          // from naveFavorita='fragata'
    expect(proseMod).toContain('torres orbitais fortificadas');   // from naveFavorita='torreta'
    expect(proseExtr).not.toBe(proseMod);

    // Paciência shapes filosofia-de-combate branch: 1 → "primeiro sinal",
    // 6 → "décadas de preparação".
    expect(proseExtr.toLowerCase()).toContain('primeiro sinal');
    expect(proseMod.toLowerCase()).toContain('décadas de preparação');

    // frotaMax shapes size language: 34 → "massivas", 20 → "compactas".
    expect(proseExtr).toContain('massivas');
    expect(proseMod).toContain('compactas');
  });

  it('tone varies by archetype', () => {
    const warlord = gerarImperioLore({
      empireId: 'e1', galaxySeed: 1,
      personalidade: mockPersonalidade({ arquetipo: 'warlord' }),
      nomeImperio: 'X',
    });
    const trader = gerarImperioLore({
      empireId: 'e1', galaxySeed: 1,
      personalidade: mockPersonalidade({ arquetipo: 'trader' }),
      nomeImperio: 'X',
    });
    expect(warlord.subtitulo).not.toBe(trader.subtitulo);
  });

  it('plain formatter emits no box-drawing ASCII', () => {
    const lore = gerarImperioLore({
      empireId: 'e1', galaxySeed: 1,
      personalidade: mockPersonalidade({ arquetipo: 'defender' }),
      nomeImperio: 'Liga das Muralhas',
    });
    const formatted = formatarImperioLore(lore, 'Liga das Muralhas');
    expect(formatted).not.toContain('──');
    expect(formatted).not.toContain('══');
  });
});
