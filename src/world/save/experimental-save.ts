import type { StorageBackend, SaveMetadata } from './storage-backend';
import { extrairMetadata } from './storage-backend';
import type { MundoDTO, PlanetaDTO, SistemaDTO, SolDTO, NaveDTO } from './dto';
import { abrirDb, putMany, getAllByMundo, listMundos, deleteByMundo } from './indexed-db';
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

export class ExperimentalBackend implements StorageBackend {
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
    return {
      ...campos,
      sistemas: sistemas.map((e) => e.data),
      sois: sois.map((e) => e.data),
      planetas: planetas.map((e) => e.data),
      naves: naves.map((e) => e.data),
    };
  }

  async salvar(dto: MundoDTO): Promise<void> {
    // Strip the entity arrays (they go to their own stores) and persist
    // EVERYTHING else in the header so no top-level field is lost.
    const { sistemas: _s, sois: _so, planetas: _p, naves: _n, ...campos } = dto;
    const header: MundoRecord = {
      ...campos,
      metadata: extrairMetadata(dto),
    };
    const writes: Array<{ store: StoreName; value: any }> = [
      { store: 'mundos', value: header },
      ...dto.sistemas.map((s) => ({
        store: 'sistemas' as StoreName,
        value: { mundoNome: dto.nome, id: s.id, data: s },
      })),
      ...dto.sois.map((s) => ({
        store: 'sois' as StoreName,
        value: { mundoNome: dto.nome, id: s.id, data: s },
      })),
      ...dto.planetas.map((p) => ({
        store: 'planetas' as StoreName,
        value: { mundoNome: dto.nome, id: p.id, data: p },
      })),
      ...dto.naves.map((n) => ({
        store: 'naves' as StoreName,
        value: { mundoNome: dto.nome, id: n.id, data: n },
      })),
    ];
    // Clear stale entities first — if the world previously had more
    // naves/planetas than it does now, orphans would persist and be
    // loaded back on the next carregar.
    await deleteByMundo(dto.nome);
    await putMany(writes);
  }

  async apagar(nome: string): Promise<void> {
    await deleteByMundo(nome);
  }

  async existe(nome: string): Promise<boolean> {
    const records = await listMundos();
    return records.some((r: any) => r.nome === nome);
  }
}
