import { defineConfig } from 'vitest/config';
import wgsl from '@weydra/vite-plugin-wgsl';

// Mesmo plugin do vite.config.ts — transforma .wgsl em módulo tipado.
// Sem ele, vitest/rolldown tenta parsear o .wgsl como JS e explode
// quando tests importam módulos que consomem shaders via `import ... from
// './shader.wgsl'`.
export default defineConfig({
  plugins: [wgsl()],
  test: {
    // happy-dom provides `document`/`window` stubs — pixi.js faz GlProgram
    // lookups no import (getMaxFragmentPrecision), quebra em Node puro.
    environment: 'happy-dom',
    include: [
      'src/**/__tests__/**/*.test.ts',
      'weydra-renderer/**/__tests__/**/*.test.ts',
    ],
    globals: false,
  },
});
