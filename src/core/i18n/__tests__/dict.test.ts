import { describe, it, expect } from 'vitest';
import { DICT } from '../dict';

describe('dict', () => {
  it('every entry has both pt and en', () => {
    for (const [key, entry] of Object.entries(DICT)) {
      expect(entry.pt, `${key} missing pt`).toBeTruthy();
      expect(entry.en, `${key} missing en`).toBeTruthy();
    }
  });

  it('no duplicate keys', () => {
    const keys = Object.keys(DICT);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });

  it('placeholders in pt have matching placeholders in en', () => {
    for (const [key, entry] of Object.entries(DICT)) {
      const ptPlaceholders = (entry.pt.match(/\{(\w+)\}/g) ?? []).sort();
      const enPlaceholders = (entry.en.match(/\{(\w+)\}/g) ?? []).sort();
      expect(ptPlaceholders, `${key} placeholder mismatch`).toEqual(enPlaceholders);
    }
  });
});
