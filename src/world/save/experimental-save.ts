import type { StorageBackend, SaveMetadata } from './storage-backend';
import { extrairMetadata } from './storage-backend';
import type { MundoDTO, PlanetaDTO, SistemaDTO, SolDTO, NaveDTO } from './dto';
import { abrirDb, getAllByMundo, listMundos, deleteByMundo, patchMundoAtomically, replaceMundoAtomically } from './indexed-db';
import type { StoreName } from './indexed-db';

// The header stores the ENTIRE MundoDTO minus the four entity arrays
// (which live in their own object stores), plus the list metadata. Using
// Omit + spread instead of cherry-picking fields means every non-entity
// field — imperioJogador, personalidadesIa, dificuldade, camera, gameSpeed,
// iaTickState/Memoria, eventosHistorico, statsAmostragem, firstContact,
// battleHistory, lastSeenInimigos, procNamesUsados, seedMusical, etc. —
// round-trips, and any field added to MundoDTO later auto-persists. (The
// previous version dropped all of those on both save and load.)
type MundoRecord = Omit<MundoDTO, 'sistemas' | 'sois' | 'planetas' | 'naves'> & {
  metadata: SaveMetadata;
};

interface Entry<T> {
  mundoNome: string;
  id: string;
  data: T;
}

interface EntityCache {
  sistemas: Map<string, string>;
  sois: Map<string, string>;
  planetas: Map<string, string>;
  naves: Map<string, string>;
}

function hashEntities<T extends { id: string }>(entities: T[]): Map<string, string> {
  return new Map(entities.map((entity) => [entity.id, JSON.stringify(entity)]));
}

function cacheFromDto(dto: MundoDTO): EntityCache {
  return {
    sistemas: hashEntities(dto.sistemas),
    sois: hashEntities(dto.sois),
    planetas: hashEntities(dto.planetas),
    naves: hashEntities(dto.naves),
  };
}

export class ExperimentalBackend implements StorageBackend {
  private readonly entityCaches = new Map<string, EntityCache>();

  async listarMundos(): Promise<SaveMetadata[]> {
    const records = (await listMundos()) as MundoRecord[];
    return records.map((r) => r.metadata).sort((a, b) => b.salvoEm - a.salvoEm);
  }

  async carregar(nome: string): Promise<MundoDTO | null> {
    const db = await abrirDb();
    const tx = db.transaction('mundos', 'readonly');
    const headerReq = tx.objectStore('mundos').get(nome);
    const header = await new Promise<MundoRecord | undefined>((res, rej) => {
      headerReq.onsuccess = () => res(headerReq.result);
      headerReq.onerror = () => rej(headerReq.error);
    });
    if (!header) return null;

    const [sistemas, sois, planetas, naves] = await Promise.all([
      getAllByMundo<Entry<SistemaDTO>>('sistemas', nome),
      getAllByMundo<Entry<SolDTO>>('sois', nome),
      getAllByMundo<Entry<PlanetaDTO>>('planetas', nome),
      getAllByMundo<Entry<NaveDTO>>('naves', nome),
    ]);

    // Spread every non-entity field back from the header, then attach the
    // entity arrays from their stores. `metadata` is list-only — drop it.
    const { metadata: _metadata, ...campos } = header;
    const dto: MundoDTO = {
      ...campos,
      sistemas: sistemas.map((e) => e.data),
      sois: sois.map((e) => e.data),
      planetas: planetas.map((e) => e.data),
      naves: naves.map((e) => e.data),
    };
    this.entityCaches.set(nome, cacheFromDto(dto));
    return dto;
  }

  async salvar(dto: MundoDTO): Promise<void> {
    // Strip the entity arrays (they go to their own stores) and persist
    // EVERYTHING else in the header so no top-level field is lost.
    const { sistemas: _s, sois: _so, planetas: _p, naves: _n, ...campos } = dto;
    const header: MundoRecord = {
      ...campos,
      metadata: extrairMetadata(dto),
    };
    const nextCache = cacheFromDto(dto);
    const previousCache = this.entityCaches.get(dto.nome);
    const allEntityWrites: Array<{ store: StoreName; value: any }> = [
      ...dto.sistemas.map((data) => ({ store: 'sistemas' as StoreName, value: { mundoNome: dto.nome, id: data.id, data } })),
      ...dto.sois.map((data) => ({ store: 'sois' as StoreName, value: { mundoNome: dto.nome, id: data.id, data } })),
      ...dto.planetas.map((data) => ({ store: 'planetas' as StoreName, value: { mundoNome: dto.nome, id: data.id, data } })),
      ...dto.naves.map((data) => ({ store: 'naves' as StoreName, value: { mundoNome: dto.nome, id: data.id, data } })),
    ];

    if (!previousCache) {
      await replaceMundoAtomically(dto.nome, [{ store: 'mundos', value: header }, ...allEntityWrites]);
      this.entityCaches.set(dto.nome, nextCache);
      return;
    }

    const writes: Array<{ store: StoreName; value: any }> = [{ store: 'mundos', value: header }];
    const deletes: Array<{ store: Exclude<StoreName, 'mundos'>; mundoNome: string; id: string }> = [];
    const groups = [
      ['sistemas', dto.sistemas], ['sois', dto.sois],
      ['planetas', dto.planetas], ['naves', dto.naves],
    ] as const;
    for (const [store, entities] of groups) {
      const previous = previousCache[store];
      const next = nextCache[store];
      for (const data of entities) {
        if (previous.get(data.id) !== next.get(data.id)) {
          writes.push({ store, value: { mundoNome: dto.nome, id: data.id, data } });
        }
      }
      for (const id of previous.keys()) {
        if (!next.has(id)) deletes.push({ store, mundoNome: dto.nome, id });
      }
    }
    await patchMundoAtomically(writes, deletes);
    this.entityCaches.set(dto.nome, nextCache);
  }

  async apagar(nome: string): Promise<void> {
    await deleteByMundo(nome);
    this.entityCaches.delete(nome);
  }

  async existe(nome: string): Promise<boolean> {
    const records = await listMundos();
    return records.some((r: any) => r.nome === nome);
  }

  async exportar(nome: string): Promise<string | null> {
    const dto = await this.carregar(nome);
    return dto ? JSON.stringify(dto, null, 2) : null;
  }
}
