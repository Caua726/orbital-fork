/**
 * Vite plugin that handles `.wgsl` imports.
 *
 * M1 version: trivially returns the file source as a raw string export.
 * Later milestones will:
 *   - Parse uniforms via naga
 *   - Generate typed TypeScript accessors
 *   - Produce a virtual module with create() / setUniforms methods
 *
 * Usage in vite.config.ts:
 *   import wgsl from './weydra-renderer/vite-plugin-wgsl';
 *   export default defineConfig({ plugins: [wgsl()] });
 */

import type { Plugin } from 'vite';

export default function wgslPlugin(): Plugin {
  return {
    name: 'weydra-vite-plugin-wgsl',
    // Use `code` (Vite already read + cached it) instead of re-reading disk.
    // Reading disk bypasses Vite's module graph and breaks HMR.
    transform(code, id) {
      if (!id.endsWith('.wgsl')) return null;
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      };
    },
  };
}
