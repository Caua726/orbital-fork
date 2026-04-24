import type { Plugin } from 'vite';
import { basename, extname } from 'node:path';
import { readFileSync } from 'node:fs';
import { reflectWgsl } from './reflect.ts';
import { generateTsModule } from './codegen.ts';

/**
 * Vite plugin that handles `.wgsl` imports.
 *
 * Uses the `load` hook (not `transform`) to avoid Rollup's default JS parser
 * choking on raw WGSL before other plugins get a chance to rewrite it. Reads
 * the file once via fs at load time; Vite's module graph handles invalidation
 * on save, so HMR keeps working.
 *
 * Output: a virtual TS module exporting the raw `wgslSource` string (default
 * export stays compatible with existing `?raw`-style imports) plus typed
 * accessor classes for every non-engine uniform struct (group >= 1) reflected
 * via wgsl_reflect.
 */
export default function wgslPlugin(): Plugin {
  return {
    name: 'weydra-vite-plugin-wgsl',
    enforce: 'pre',
    load(id) {
      const cleanId = id.split('?')[0];
      if (!cleanId.endsWith('.wgsl')) return null;
      console.log('[wgsl] load called for', id);
      const source = readFileSync(cleanId, 'utf8');
      const moduleName = basename(cleanId, extname(cleanId));
      let structs: ReturnType<typeof reflectWgsl> = [];
      try {
        structs = reflectWgsl(source);
      } catch (err) {
        this.warn(`wgsl_reflect failed on ${id}: ${String(err)} — emitting raw source only`);
      }
      return generateTsModule(source, structs, moduleName);
    },
  };
}
