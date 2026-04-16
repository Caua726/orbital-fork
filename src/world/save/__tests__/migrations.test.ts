import { describe, it, expect } from 'vitest';
import { migrarDto, CURRENT_VERSION } from '../migrations';

describe('migrarDto', () => {
  it('identity when version matches current', () => {
    const input = { schemaVersion: CURRENT_VERSION, nome: 'x' } as any;
    const out = migrarDto(input);
    expect(out.schemaVersion).toBe(CURRENT_VERSION);
    expect(out.nome).toBe('x');
  });

  it('rejects future versions', () => {
    const input = { schemaVersion: CURRENT_VERSION + 1 } as any;
    expect(() => migrarDto(input)).toThrow(/mais nova/);
  });

  it('treats missing version as v1', () => {
    const input = { nome: 'x' } as any;
    const out = migrarDto(input);
    expect(out.nome).toBe('x');
  });
});
