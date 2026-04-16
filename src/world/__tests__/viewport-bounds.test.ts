import { describe, it, expect } from 'vitest';
import { calcularBoundsViewport } from '../viewport-bounds';

describe('calcularBoundsViewport', () => {
  it('camera at origin produces bounds centered on origin', () => {
    const b = calcularBoundsViewport(0, 0, 1, 1920, 1080);
    expect(b.esq).toBeLessThan(0);
    expect(b.dir).toBeGreaterThan(0);
    expect(b.esq + b.dir).toBeCloseTo(0);
    expect(b.cima + b.baixo).toBeCloseTo(0);
  });

  it('bounds include the full viewport plus margem on each side', () => {
    const b = calcularBoundsViewport(0, 0, 1, 1920, 1080);
    expect(b.dir - b.esq).toBeGreaterThanOrEqual(1920);
    expect(b.baixo - b.cima).toBeGreaterThanOrEqual(1080);
  });

  it('zoom out expands bounds proportionally', () => {
    const b1 = calcularBoundsViewport(0, 0, 1, 1920, 1080);
    const b2 = calcularBoundsViewport(0, 0, 0.5, 1920, 1080);
    expect(b2.dir - b2.esq).toBeGreaterThan(b1.dir - b1.esq);
  });

  it('camera offset shifts bounds without changing size', () => {
    const b0 = calcularBoundsViewport(0, 0, 1, 1920, 1080);
    const b1 = calcularBoundsViewport(1000, 500, 1, 1920, 1080);
    expect((b1.esq + b1.dir) / 2).toBeCloseTo(1000, -1);
    expect((b1.cima + b1.baixo) / 2).toBeCloseTo(500, -1);
    expect(b1.dir - b1.esq).toBeCloseTo(b0.dir - b0.esq);
  });

  it('minimum margem defaults to 600 world units', () => {
    const b = calcularBoundsViewport(0, 0, 10, 100, 100);
    expect(b.margem).toBeGreaterThanOrEqual(600);
  });

  it('custom margemMin parameter overrides the default', () => {
    const b = calcularBoundsViewport(0, 0, 10, 100, 100, 1500);
    expect(b.margem).toBeGreaterThanOrEqual(1500);
  });

  it('margemMultiplier produces zoom-scaled margem', () => {
    const b1 = calcularBoundsViewport(0, 0, 1, 1920, 1080, 0, 1500);
    const b2 = calcularBoundsViewport(0, 0, 0.5, 1920, 1080, 0, 1500);
    expect(b1.margem).toBeGreaterThanOrEqual(1500);
    expect(b2.margem).toBeGreaterThanOrEqual(3000);
  });
});
