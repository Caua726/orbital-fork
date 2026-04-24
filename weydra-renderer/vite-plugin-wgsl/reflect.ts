import { WgslReflect } from 'wgsl_reflect';

export interface UniformField {
  name: string;
  offset: number;
  byteSize: number;
  typeName: string;
}

export interface UniformStruct {
  structName: string;
  byteSize: number;
  fields: UniformField[];
  bindGroup: number;
  binding: number;
}

/**
 * wgsl_reflect exposes uniforms as VariableInfo with TypeInfo. The shape
 * varies across versions — read fields defensively. Group 0 is engine-owned
 * (CameraUniforms) and skipped; only custom shader uniforms are emitted.
 */
export function reflectWgsl(source: string): UniformStruct[] {
  const reflect = new WgslReflect(source);
  const result: UniformStruct[] = [];

  for (const u of (reflect.uniforms ?? [])) {
    const group = (u as any).group ?? 0;
    if (group === 0) continue;
    const struct: any = (u as any).type;
    const members = struct?.members;
    if (!Array.isArray(members)) continue;

    result.push({
      structName: String(struct.name ?? `Uniforms_${group}_${(u as any).binding}`),
      byteSize: Number(struct.size ?? 0),
      bindGroup: Number(group),
      binding: Number((u as any).binding ?? 0),
      fields: members.map((m: any) => ({
        name: String(m.name),
        offset: Number(m.offset ?? 0),
        byteSize: Number(m.size ?? 0),
        typeName: resolveTypeName(m),
      })),
    });
  }

  return result;
}

function resolveTypeName(m: any): string {
  // Defensive: wgsl_reflect may put the type name in several places.
  if (typeof m.type === 'string') return m.type;
  const n = m.type?.name ?? m.type?.format?.name ?? m.type?.format;
  if (typeof n === 'string') return n;
  return 'unknown';
}
