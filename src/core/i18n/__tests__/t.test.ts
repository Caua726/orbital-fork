import { describe, it, expect, beforeEach } from 'vitest';

const fakeStorage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => fakeStorage[k] ?? null,
  setItem: (k: string, v: string) => { fakeStorage[k] = v; },
  removeItem: (k: string) => { delete fakeStorage[k]; },
  clear: () => { for (const k of Object.keys(fakeStorage)) delete fakeStorage[k]; },
};

import { setConfig, resetConfigForTest } from '../../config';
import { t } from '../t';

describe('t()', () => {
  beforeEach(() => {
    (global.localStorage as any).clear();
    resetConfigForTest();
  });

  it('returns PT text by default', () => {
    expect(t('menu.novo_jogo')).toBe('Novo Jogo');
  });

  it('returns EN text when language is en', () => {
    setConfig({ language: 'en' });
    expect(t('menu.novo_jogo')).toBe('New Game');
  });

  it('interpolates params', () => {
    expect(t('loading.carregando', { nome: 'Alpha' })).toBe('Carregando mundo: Alpha');
  });

  it('returns key for missing entry', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });
});
