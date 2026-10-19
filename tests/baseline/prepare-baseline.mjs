#!/usr/bin/env node
/**
 * Builds the PRE-WEYDRA baseline (default d51623e) with the render-matrix
 * hooks, so tests/render-matrix.mjs can capture it as the true reference.
 *
 *   node tests/baseline/prepare-baseline.mjs [commit] [dir]
 *   (cd <dir> && npx vite preview --port 4174 --host 127.0.0.1)
 *   ORBITAL_BASELINE_URL=http://127.0.0.1:4174/orbital-fork/ node tests/render-matrix.mjs
 *
 * The worktree is disposable: the patch only adds hooks (layer mask via
 * `renderable`, fixed-step sim, virtual clock, starfield clock pin) and
 * never changes what the baseline draws.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const COMMIT = process.argv[2] ?? 'd51623e';
const DIR = path.resolve(process.argv[3] ?? '/tmp/orbital-baseline');
const REPO = path.resolve(import.meta.dirname, '..', '..');
const run = (cmd, args, cwd = REPO) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

if (fs.existsSync(DIR)) run('git', ['worktree', 'remove', '--force', DIR]);
run('git', ['worktree', 'add', '--force', '--detach', DIR, COMMIT]);

const src = (f) => path.join(DIR, 'src', f);
fs.copyFileSync(path.join(REPO, 'src/core/relogio.ts'), src('core/relogio.ts'));
fs.copyFileSync(path.join(import.meta.dirname, 'render-matrix-baseline.ts'), src('world/render-matrix.ts'));

function patch(file, pairs) {
  let s = fs.readFileSync(src(file), 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`${file}: trecho não encontrado: ${from.slice(0, 80)}`);
    s = s.replace(from, to);
  }
  fs.writeFileSync(src(file), s);
}

patch('main.ts', [
  ["import { getCombateMemoryBytes } from './world/combate-resolucao';",
    "import { getCombateMemoryBytes } from './world/combate-resolucao';\nimport { instalarRenderMatrixHooks, passoFixoRenderMatrix } from './world/render-matrix';"],
  ['  (window as any)._app = app;\n',
    '  (window as any)._app = app;\n  instalarRenderMatrixHooks(app, () => _mundo);\n'],
  ['    app.ticker.speed = getDebugState().gameSpeed;\n',
    '    app.ticker.speed = getDebugState().gameSpeed;\n    const _passo = passoFixoRenderMatrix();\n    if (_passo !== null) (app.ticker as { deltaMS: number }).deltaMS = _passo;\n'],
]);
patch('world/fundo.ts', [
  ['  fundo._tempoAcumMs += 16.67;', '  fundo._tempoAcumMs = _tempoFixoMs ?? fundo._tempoAcumMs + 16.67;'],
  ['export function criarFundo(', 'let _tempoFixoMs: number | null = null;\nexport function fixarTempoFundo(ms: number | null): void { _tempoFixoMs = ms; }\n\nexport function criarFundo('],
]);
patch('world/nevoa.ts', [
  ['    timestamp: performance.now(),', '    timestamp: agoraMs(),'],
  ['    const agora = performance.now();', '    const agora = agoraMs();'],
  ["import ", "import { agoraMs } from '../core/relogio';\nimport "],
]);
patch('world/naves.ts', [
  ['  const now = performance.now();\n\n  if (nave.estado', '  const now = agoraMs();\n\n  if (nave.estado'],
  ["import ", "import { agoraMs } from '../core/relogio';\nimport "],
]);

run('bun', ['install'], DIR);
run('npx', ['vite', 'build'], DIR);
console.log(`\nBaseline ${COMMIT} pronta em ${DIR}/dist — sirva com:\n  (cd ${DIR} && npx vite preview --port 4174 --host 127.0.0.1)`);
