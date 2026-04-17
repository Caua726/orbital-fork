/**
 * Prints sample lore for eyeballing. Unskip the describe to see output
 * in test logs — useful when tweaking the banks.
 */

import { describe, it } from 'vitest';
import { gerarImperioLore, formatarImperioLore } from '../imperio-lore';
import { gerarPlanetaLore, formatarPlanetaLore } from '../planeta-lore';
import type { PersonalidadeIA } from '../../personalidade-ia';

const extremo: PersonalidadeIA = {
  id: 'inimigo1', nome: 'Ordem Kharos', cor: 0xff5555, arquetipo: 'warlord',
  pesos: { agressao: 1.6, expansao: 1.2, economia: 0.4, ciencia: 0.3, defesa: 0.4, vinganca: 1.5 },
  naveFavorita: 'fragata', frotaMinAtaque: 2, paciencia: 1, frotaMax: 34, forca: 2.0,
};

const moderado: PersonalidadeIA = {
  id: 'inimigo1', nome: 'Legião Vyrien', cor: 0xaa66ff, arquetipo: 'warlord',
  pesos: { agressao: 1.0, expansao: 0.9, economia: 1.0, ciencia: 0.9, defesa: 0.9, vinganca: 0.6 },
  naveFavorita: 'torreta', frotaMinAtaque: 7, paciencia: 6, frotaMax: 20, forca: 1.0,
};

const cientista: PersonalidadeIA = {
  id: 'inimigo2', nome: 'Academia Okhar', cor: 0x55ffaa, arquetipo: 'scientist',
  pesos: { agressao: 0.5, expansao: 0.9, economia: 0.9, ciencia: 1.7, defesa: 1.0, vinganca: 0.7 },
  naveFavorita: 'fragata', frotaMinAtaque: 7, paciencia: 5, frotaMax: 22, forca: 1.0,
};

describe.skip('SAMPLE OUTPUT (unskip to eyeball)', () => {
  it('prints three empires and a planet', () => {
    for (const [label, p] of [['WARLORD EXTREMO', extremo], ['WARLORD MODERADO', moderado], ['CIENTISTA', cientista]] as const) {
      console.log(`\n\n═════════════ ${label} ═════════════`);
      const lore = gerarImperioLore({
        empireId: p.id, galaxySeed: 8273, personalidade: p, nomeImperio: p.nome,
      });
      console.log(formatarImperioLore(lore, p.nome));
    }
    console.log('\n\n═════════════ PLANETA ═════════════');
    const pla = gerarPlanetaLore({
      planetaId: 'pla-4-2', galaxySeed: 8273, tipo: 'marte', dono: 'inimigo1',
      nomePlaneta: 'Kivos', tamanho: 210,
      donoNome: extremo.nome, donoArquetipo: 'warlord',
      sistemaNome: 'Thael-Kyras',
    });
    console.log(formatarPlanetaLore(pla, 'Kivos'));
  });
});
