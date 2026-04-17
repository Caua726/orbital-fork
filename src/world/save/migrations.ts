import type { MundoDTO } from './dto';
import { CURRENT_SCHEMA_VERSION } from './dto';

export const CURRENT_VERSION = CURRENT_SCHEMA_VERSION;

export interface MigrationResult {
  dto: MundoDTO;
  /** The schemaVersion that was on disk before any migration. */
  versaoOriginal: number;
  /** Labels describing each transform applied, in order. */
  transforms: string[];
}

/**
 * Each migration takes a mutable DTO blob and returns it after bumping
 * fields. Push a descriptive label into `transforms` for each non-trivial
 * change so the reconciler / UI can report what happened.
 */
type Migration = (dto: any, transforms: string[]) => any;

/**
 * v1 → v2: introduces optional fields for full runtime state capture.
 * All new fields are optional — leaving them undefined lets the
 * reconstruction path treat them as "start empty".
 *
 * Also normalizes a couple of known quirks that existed in pre-v2 saves:
 *   - older ship DTOs sometimes lacked `rotaManual` (pre-manual-route era)
 *   - older personality DTOs never had a `lore` field
 */
const v1ToV2: Migration = (dto, transforms) => {
  transforms.push('v1→v2 bump');
  // Backfill required arrays that older dumps sometimes omit.
  if (Array.isArray(dto.naves)) {
    let naviosComRotaFaltando = 0;
    for (const n of dto.naves) {
      if (!Array.isArray(n.rotaManual)) {
        n.rotaManual = [];
        naviosComRotaFaltando++;
      }
    }
    if (naviosComRotaFaltando > 0) {
      transforms.push(`v1→v2 backfill: rotaManual=[] em ${naviosComRotaFaltando} nave(s)`);
    }
  }
  dto.schemaVersion = 2;
  return dto;
};

const migrations: Migration[] = [
  v1ToV2, // index 0: v1 → v2
];

/**
 * Full migration with structured report. Preferred entry point — the
 * legacy `migrarDto` wrapper below preserves the older call signature.
 */
export function migrarDtoComRelatorio(raw: any): MigrationResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Save inválido: payload não é um objeto.');
  }
  let current = raw;
  const versaoOriginal = typeof current.schemaVersion === 'number' ? current.schemaVersion : 1;
  if (versaoOriginal > CURRENT_VERSION) {
    throw new Error(
      `Save é de versão ${versaoOriginal}, mais nova que a atual (${CURRENT_VERSION}). Atualize o jogo.`,
    );
  }
  const transforms: string[] = [];
  if (versaoOriginal < CURRENT_VERSION) {
    transforms.push(`migração v${versaoOriginal} → v${CURRENT_VERSION}`);
  }
  for (let v = versaoOriginal; v < CURRENT_VERSION; v++) {
    const migrate = migrations[v - 1];
    if (!migrate) throw new Error(`Sem migration pra v${v}→v${v + 1}`);
    current = migrate(current, transforms);
    current.schemaVersion = v + 1;
  }
  return {
    dto: current as MundoDTO,
    versaoOriginal,
    transforms,
  };
}

/** Legacy signature — some callers / tests import this directly. */
export function migrarDto(raw: any): MundoDTO {
  return migrarDtoComRelatorio(raw).dto;
}
