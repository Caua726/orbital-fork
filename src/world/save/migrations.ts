import type { MundoDTO } from './dto';
import { CURRENT_SCHEMA_VERSION } from './dto';

export const CURRENT_VERSION = CURRENT_SCHEMA_VERSION;

const migrations: Array<(dto: any) => any> = [];

export function migrarDto(raw: any): MundoDTO {
  let current = raw;
  const from = current.schemaVersion ?? 1;
  if (from > CURRENT_VERSION) {
    throw new Error(
      `Save é de versão ${from}, mais nova que a atual (${CURRENT_VERSION}). Atualize o jogo.`,
    );
  }
  for (let v = from; v < CURRENT_VERSION; v++) {
    const migrate = migrations[v - 1];
    if (!migrate) throw new Error(`Sem migration pra v${v}→v${v + 1}`);
    current = migrate(current);
    current.schemaVersion = v + 1;
  }
  return current as MundoDTO;
}
