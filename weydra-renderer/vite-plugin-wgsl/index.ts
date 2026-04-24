import type { Plugin } from 'vite';
import { basename, extname } from 'node:path';
import { reflectWgsl } from './reflect.ts';
import { generateTsModule } from './codegen.ts';

/**
 * Vite plugin that handles `.wgsl` imports.
 *
 * Uses `code` (already read + cached by Vite) — reading disk bypasses Vite's
 * module graph and breaks HMR.
 *
 * Output: a virtual TS module exporting the raw `wgslSource` string (default
 * export stays compatible with existing `?raw`-style imports) plus typed
 * accessor classes for every non-engine uniform struct (group >= 1) reflected
 * via wgsl_reflect.
 */
export default function wgslPlugin(): Plugin {
  return {
    name: 'weydra-vite-plugin-wgsl',
    transform(code, id) {
      if (!id.endsWith('.wgsl')) return null;
      const moduleName = basename(id, extname(id));
      let structs: ReturnType<typeof reflectWgsl> = [];
      try {
        structs = reflectWgsl(code);
      } catch (err) {
        // wgsl_reflect occasionally rejects corner-case syntax. Fall back to
        // raw-source export so the build never hard-fails.
        this.warn(`wgsl_reflect failed on ${id}: ${String(err)} — emitting raw source only`);
      }
      const tsModule = generateTsModule(code, structs, moduleName);
      return { code: tsModule, map: null };
    },
  };
}
