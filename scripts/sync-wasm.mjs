#!/usr/bin/env node
/**
 * sync-wasm.mjs — copia o `pkg` do adapter WASM do Weydra para o
 * `node_modules` do workspace `@weydra/renderer` (ts-bridge), de onde o
 * bundler resolve `weydra-renderer-wasm`.
 *
 * Existe como script Node, e não como `npm run --prefix ../../..`, porque os
 * scripts do package.json rodam sob o shell do Bun no CI: `bun run` não aceita
 * `--prefix` e interpretava o caminho como módulo (`Module not found "../../.."`),
 * quebrando `bun run build:renderer:release` e `bun run build`. Resolver o
 * destino por `import.meta.dirname` funciona sob npm, Bun e de qualquer cwd.
 *
 * Uso: node scripts/sync-wasm.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const from = path.join(root, 'weydra-renderer/adapters/wasm/pkg');
const candidates = [
  path.join(root, 'weydra-renderer/ts-bridge/node_modules/weydra-renderer-wasm'),
  // Layout hoisted (bun install --linker=hoisted) mantém o dep `file:` na raiz.
  path.join(root, 'node_modules/weydra-renderer-wasm'),
];

if (!fs.existsSync(from)) {
  console.error(`[sync-wasm] pkg ausente: ${from} — rode wasm-pack build antes.`);
  process.exit(1);
}

const dest = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];

if (fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink()) {
  // Alguns package managers linkam o dep `file:` direto no pkg: nada a copiar.
  console.log(`[sync-wasm] ${path.relative(root, dest)} é symlink — nada a sincronizar.`);
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });

let copied = 0;
for (const entry of fs.readdirSync(from)) {
  // `cp pkg/*` nunca copiou dotfiles; mantenha o `.gitignore` do destino.
  if (entry.startsWith('.')) continue;
  fs.copyFileSync(path.join(from, entry), path.join(dest, entry));
  copied++;
}

console.log(`[sync-wasm] ${copied} arquivos → ${path.relative(root, dest)}`);
