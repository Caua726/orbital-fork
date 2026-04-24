import type { UniformStruct, UniformField } from './reflect.ts';

/**
 * Emits a JavaScript module (not TypeScript) because Rollup parses the
 * plugin's returned `load` payload directly — Vite's TS → JS transform
 * only fires on `.ts` inputs, and our virtual module is served under the
 * original `.wgsl` id. Any TS-only syntax (`as const`, `private readonly`,
 * parameter types) would crash Rollup's JS parser.
 */
export function generateTsModule(
  wgslSource: string,
  structs: UniformStruct[],
  moduleName: string,
): string {
  const lines: string[] = [];
  lines.push(`// Auto-generated from ${moduleName}.wgsl — do not edit.`);
  lines.push(`export const wgslSource = ${JSON.stringify(wgslSource)};`);
  lines.push('export default wgslSource;');
  lines.push('');

  for (const s of structs) {
    lines.push(`export const ${s.structName}_LAYOUT = Object.freeze({`);
    lines.push(`  byteSize: ${s.byteSize},`);
    lines.push(`  bindGroup: ${s.bindGroup},`);
    lines.push(`  binding: ${s.binding},`);
    lines.push(`  fields: Object.freeze({`);
    for (const f of s.fields) {
      lines.push(`    ${f.name}: Object.freeze({ offset: ${f.offset}, byteSize: ${f.byteSize}, type: ${JSON.stringify(f.typeName)} }),`);
    }
    lines.push(`  }),`);
    lines.push(`});`);
    lines.push('');

    // JS class. Integer fields (i32/u32) use Int32/Uint32 views over the
    // same ArrayBuffer so writes store exact integer bits (writing via
    // Float32Array would serialise them as IEEE-754 floats).
    lines.push(`export class ${s.structName} {`);
    lines.push(`  constructor(buffer, base) {`);
    lines.push(`    this._f32 = buffer;`);
    lines.push(`    this._base = base;`);
    lines.push(`    this._i32 = new Int32Array(buffer.buffer, buffer.byteOffset, buffer.length);`);
    lines.push(`    this._u32 = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length);`);
    lines.push(`  }`);
    for (const f of s.fields) {
      lines.push(`  ${generateSetter(f)}`);
    }
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

function generateSetter(f: UniformField): string {
  const offsetF32 = f.offset / 4;
  if (!Number.isInteger(offsetF32)) {
    return `set ${f.name}(_v) { /* offset ${f.offset} not 4-byte aligned — skipped */ }`;
  }
  switch (f.typeName) {
    case 'f32':
      return `set ${f.name}(v) { this._f32[this._base + ${offsetF32}] = v; }`;
    case 'i32':
      return `set ${f.name}(v) { this._i32[this._base + ${offsetF32}] = v; }`;
    case 'u32':
      return `set ${f.name}(v) { this._u32[this._base + ${offsetF32}] = v; }`;
    case 'vec2<f32>':
    case 'vec2f':
      return `set ${f.name}(v) { this._f32[this._base + ${offsetF32}] = v[0]; this._f32[this._base + ${offsetF32 + 1}] = v[1]; }`;
    case 'vec3<f32>':
    case 'vec3f':
      return `set ${f.name}(v) { for (let i=0;i<3;i++) this._f32[this._base + ${offsetF32} + i] = v[i]; }`;
    case 'vec4<f32>':
    case 'vec4f':
      return `set ${f.name}(v) { for (let i=0;i<4;i++) this._f32[this._base + ${offsetF32} + i] = v[i]; }`;
    default:
      return `set ${f.name}(_v) { /* unsupported WGSL type ${f.typeName} — edit codegen.ts */ }`;
  }
}
