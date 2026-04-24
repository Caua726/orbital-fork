import type { UniformStruct, UniformField } from './reflect';

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
    lines.push(`export const ${s.structName}_LAYOUT = {`);
    lines.push(`  byteSize: ${s.byteSize},`);
    lines.push(`  bindGroup: ${s.bindGroup},`);
    lines.push(`  binding: ${s.binding},`);
    lines.push(`  fields: {`);
    for (const f of s.fields) {
      lines.push(`    ${f.name}: { offset: ${f.offset}, byteSize: ${f.byteSize}, type: ${JSON.stringify(f.typeName)} },`);
    }
    lines.push(`  },`);
    lines.push(`} as const;`);
    lines.push('');

    // Typed accessor class. Integer fields (i32/u32) need separate Int32Array /
    // Uint32Array views over the SAME ArrayBuffer, else writing an integer
    // through a Float32Array stores it as IEEE-754 float bits.
    lines.push(`export class ${s.structName} {`);
    lines.push(`  private readonly i32: Int32Array;`);
    lines.push(`  private readonly u32: Uint32Array;`);
    lines.push(`  constructor(private buffer: Float32Array, private base: number) {`);
    lines.push(`    this.i32 = new Int32Array(buffer.buffer, buffer.byteOffset, buffer.length);`);
    lines.push(`    this.u32 = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.length);`);
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
  // Typed array indices silently truncate fractional values — guard any
  // non-4-byte-aligned offset (possible in std430 / misreflected structs).
  if (!Number.isInteger(offsetF32)) {
    return `set ${f.name}(_v: unknown) { /* offset ${f.offset} not 4-byte aligned — skipped */ }`;
  }
  switch (f.typeName) {
    case 'f32':
      return `set ${f.name}(v: number) { this.buffer[this.base + ${offsetF32}] = v; }`;
    case 'i32':
      return `set ${f.name}(v: number) { this.i32[this.base + ${offsetF32}] = v; }`;
    case 'u32':
      return `set ${f.name}(v: number) { this.u32[this.base + ${offsetF32}] = v; }`;
    case 'vec2<f32>':
    case 'vec2f':
      return `set ${f.name}(v: [number, number]) { this.buffer[this.base + ${offsetF32}] = v[0]; this.buffer[this.base + ${offsetF32 + 1}] = v[1]; }`;
    case 'vec3<f32>':
    case 'vec3f':
      return `set ${f.name}(v: [number, number, number]) { for (let i=0;i<3;i++) this.buffer[this.base + ${offsetF32} + i] = v[i]; }`;
    case 'vec4<f32>':
    case 'vec4f':
      return `set ${f.name}(v: [number, number, number, number]) { for (let i=0;i<4;i++) this.buffer[this.base + ${offsetF32} + i] = v[i]; }`;
    default:
      return `set ${f.name}(_v: unknown) { /* unsupported WGSL type ${f.typeName} — edit codegen.ts */ }`;
  }
}
