import type { StorageBackend, SaveMetadata } from './storage-backend';
import { extrairMetadata } from './storage-backend';
import type { MundoDTO, PlanetaDTO, SistemaDTO, SolDTO, NaveDTO } from './dto';
import { abrirDb, putMany, getAllByMundo, listMundos, deleteByMundo } from './indexed-db';
import type { StoreName } from './indexed-db';

interface MundoRecord {
  nome: string;
  schemaVersion: number;
  criadoEm: number;
  salvoEm: number;
  tempoJogadoMs: number;
  tamanho: number;
  tipoJogador: MundoDTO['tipoJogador'];
  fontesVisao: MundoDTO['fontesVisao'];
  metadata: SaveMetadata;
}

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

    return {
      schemaVersion: header.schemaVersion,
      nome: header.nome,
      criadoEm: header.criadoEm,
      salvoEm: header.salvoEm,
      tempoJogadoMs: header.tempoJogadoMs,
      tamanho: header.tamanho,
      tipoJogador: header.tipoJogador,
      fontesVisao: header.fontesVisao,
      sistemas: sistemas.map((e) => e.data),
      sois: sois.map((e) => e.data),
      planetas: planetas.map((e) => e.data),
      naves: naves.map((e) => e.data),
    };
  }

  async salvar(dto: MundoDTO): Promise<void> {
    const header: MundoRecord = {
      nome: dto.nome,
      schemaVersion: dto.schemaVersion,
      criadoEm: dto.criadoEm,
      salvoEm: dto.salvoEm,
      tempoJogadoMs: dto.tempoJogadoMs,
      tamanho: dto.tamanho,
      tipoJogador: dto.tipoJogador,
      fontesVisao: dto.fontesVisao,
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
