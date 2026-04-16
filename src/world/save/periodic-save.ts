import type { MundoDTO } from './dto';
import type { StorageBackend, SaveMetadata } from './storage-backend';
import { extrairMetadata } from './storage-backend';

const SAVE_KEY_PREFIX = 'orbital_save:';
const INDEX_KEY = 'orbital_saves_index';

function saveKey(nome: string): string {
  return `${SAVE_KEY_PREFIX}${nome}`;
}

export class PeriodicBackend implements StorageBackend {
  listarMundos(): SaveMetadata[] {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  carregar(nome: string): MundoDTO | null {
    try {
      const raw = localStorage.getItem(saveKey(nome));
      if (!raw) return null;
      return JSON.parse(raw) as MundoDTO;
    } catch {
      return null;
    }
  }

  salvar(dto: MundoDTO): void {
    const json = JSON.stringify(dto);
    localStorage.setItem(saveKey(dto.nome), json);
    this.atualizarIndice(dto);
  }

  apagar(nome: string): void {
    localStorage.removeItem(saveKey(nome));
    const idx = this.listarMundos().filter((m) => m.nome !== nome);
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  }

  existe(nome: string): boolean {
    return localStorage.getItem(saveKey(nome)) !== null;
  }

  private atualizarIndice(dto: MundoDTO): void {
    const idx = this.listarMundos();
    const meta = extrairMetadata(dto);
    const existente = idx.findIndex((m) => m.nome === dto.nome);
    if (existente >= 0) {
      idx[existente] = meta;
    } else {
      idx.push(meta);
    }
    idx.sort((a, b) => b.salvoEm - a.salvoEm);
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  }
}
