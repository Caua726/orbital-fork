import { defineConfig, loadEnv } from 'vite';
import wasm from 'vite-plugin-wasm';
import wgsl from '@weydra/vite-plugin-wgsl';

// Vite 8+ suporta top-level await nativamente quando target é esnext.
// Plugin vite-plugin-top-level-await removido (incompat com Vite 8 +
// pulled vulnerable uuid transitively).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
  base: env.VITE_BASE_PATH || '/orbital-fork/',
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Bundle all of Pixi into a single chunk. Pixi v8's auto-imported
        // `scene/graphics/init.mjs` runs `extensions.add(GraphicsContextSystem)`
        // at module load, where `GraphicsContextSystem` lives in the main
        // shared file. Rolldown's default chunker puts that init file in
        // the lazy CanvasRenderer chunk and keeps `GraphicsContextSystem`
        // in the index chunk, creating a circular import: index statically
        // imports `Graphics` from CanvasRenderer, CanvasRenderer statically
        // imports `GraphicsContextSystem` from index. The browser evaluates
        // CanvasRenderer first, reads `GraphicsContextSystem` before index
        // has initialised it, and crashes with "Invalid extension type"
        // (undefined). One vendor chunk eliminates the cross-chunk cycle.
        manualChunks: (id) => {
          if (id.includes('/pixi.js/')) return 'pixi';
          return undefined;
        },
      },
    },
  },
  // Workaround pro bug do Vite 8 onde __BUNDLED_DEV__ não é substituído
  // em @vite/client em alguns casos de cache. Force explícito pra false.
  define: {
    __BUNDLED_DEV__: 'false',
  },
  plugins: [
    wasm(),
    wgsl(),
  ],
  };
});
