import type { Mundo } from '../../types';
import type { MundoDTO } from './dto';
import type { StorageBackend, SaveMetadata } from './storage-backend';
import { PeriodicBackend } from './periodic-save';
import { ExperimentalBackend } from './experimental-save';
import { serializarMundo } from './serializar';
import { reconstruirMundo } from './reconstruir';
import { migrarDto } from './migrations';
import { getConfig } from '../../core/config';

export type { SaveMetadata } from './storage-backend';
export type { MundoDTO } from './dto';
export { reconstruirMundo } from './reconstruir';
export { serializarMundo } from './serializar';
export { migrarDto } from './migrations';

function criarBackend(): StorageBackend {
  const cfg = getConfig();
  if (cfg.saveMode === 'experimental') {
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponível');
      return new ExperimentalBackend();
    } catch (err) {
      console.warn('[save] experimental mode unavailable, falling back to periodic:', err);
      return new PeriodicBackend();
    }
  }
  return new PeriodicBackend();
}

let _backend: StorageBackend = criarBackend();
let _mundoAtivo: Mundo | null = null;
let _nomeAtivo: string | null = null;
let _criadoEm: number = 0;
let _tempoJogadoMs: number = 0;
let _timerId: number | null = null;
let _ultimoSaveAt: number = 0;
let _ultimoErro: Error | null = null;

const THROTTLE_MS = 200;

export function getBackendAtivo(): StorageBackend {
  return _backend;
}

export function iniciarAutosave(params: {
  mundo: Mundo;
  nome: string;
  criadoEm: number;
  tempoJogadoMs: number;
}): void {
  _mundoAtivo = params.mundo;
  _nomeAtivo = params.nome;
  _criadoEm = params.criadoEm;
  _tempoJogadoMs = params.tempoJogadoMs;
  _ultimoErro = null;
  reagendarTimer();
}

export function acumularTempoJogado(deltaMs: number): void {
  _tempoJogadoMs += deltaMs;
}

export function getTempoJogadoMs(): number {
  return _tempoJogadoMs;
}

export function pararAutosave(): void {
  if (_timerId !== null) {
    clearInterval(_timerId);
    _timerId = null;
  }
  _mundoAtivo = null;
  _nomeAtivo = null;
}

export function salvarAgora(): void {
  if (!_mundoAtivo || !_nomeAtivo) return;
  const now = Date.now();
  if (now - _ultimoSaveAt < THROTTLE_MS) return;
  try {
    const dto = serializarMundo(_mundoAtivo, _nomeAtivo, {
      criadoEm: _criadoEm,
      tempoJogadoMs: _tempoJogadoMs,
    });
    _backend.salvar(dto);
    _ultimoSaveAt = now;
    _ultimoErro = null;
  } catch (err) {
    _ultimoErro = err instanceof Error ? err : new Error(String(err));
    console.error('[save] autosave failed:', err);
  }
}

export function getUltimoErro(): Error | null {
  return _ultimoErro;
}

function reagendarTimer(): void {
  if (_timerId !== null) clearInterval(_timerId);
  const interval = getConfig().autosaveIntervalMs;
  if (interval <= 0) return;
  _timerId = window.setInterval(() => salvarAgora(), interval);
}

export function notificarMudancaConfig(): void {
  if (_mundoAtivo) reagendarTimer();
}

export function trocarModoSave(): void {
  salvarAgora();
  _backend = criarBackend();
}

export function instalarListenersCicloDeVida(): void {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') salvarAgora();
  });
  window.addEventListener('beforeunload', () => {
    const cfg = getConfig();
    if (cfg.saveMode === 'experimental' && _mundoAtivo && _nomeAtivo) {
      try {
        const dto = serializarMundo(_mundoAtivo, _nomeAtivo, {
          criadoEm: _criadoEm,
          tempoJogadoMs: _tempoJogadoMs,
        });
        const key = `orbital_emergency:${_nomeAtivo}`;
        try {
          localStorage.removeItem(key);
          localStorage.setItem(key, JSON.stringify(dto));
        } catch {
          for (const k of Object.keys(localStorage)) {
            if (k.startsWith('orbital_emergency:')) localStorage.removeItem(k);
          }
          try { localStorage.setItem(key, JSON.stringify(dto)); } catch {
            console.error('[save] emergency blob write failed');
          }
        }
      } catch (e) {
        console.error('[save] emergency serialize failed:', e);
      }
    } else {
      salvarAgora();
    }
  });
}

export async function recuperarEmergency(nome: string): Promise<MundoDTO | null> {
  const key = `orbital_emergency:${nome}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const dto = JSON.parse(raw) as MundoDTO;
    localStorage.removeItem(key);
    await _backend.salvar(dto);
    return dto;
  } catch (err) {
    console.error('[save] emergency blob corrupt:', err);
    localStorage.removeItem(key);
    return null;
  }
}

export async function lerEMigrar(nome: string): Promise<MundoDTO | null> {
  const raw = await _backend.carregar(nome);
  if (!raw) return null;
  return migrarDto(raw);
}
