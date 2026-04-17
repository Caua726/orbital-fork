import type { Mundo } from '../../types';
import type { MundoDTO } from './dto';
import type { StorageBackend, SaveMetadata } from './storage-backend';
import { PeriodicBackend } from './periodic-save';
import { ExperimentalBackend } from './experimental-save';
import { serializarMundo } from './serializar';
import { reconstruirMundo } from './reconstruir';
import { migrarDto, migrarDtoComRelatorio, type MigrationResult } from './migrations';
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

// --- Dirty tracking (experimental mode) ---

interface DirtyState {
  header: boolean;
  sistemas: Set<string>;
  sois: Set<string>;
  planetas: Set<string>;
  naves: Set<string>;
}

let _dirty: DirtyState = {
  header: false,
  sistemas: new Set(),
  sois: new Set(),
  planetas: new Set(),
  naves: new Set(),
};

export function marcarTudoDirty(mundo: Mundo): void {
  _dirty.header = true;
  for (const s of mundo.sistemas) _dirty.sistemas.add(s.id);
  for (const s of mundo.sois) _dirty.sois.add(s.id);
  for (const p of mundo.planetas) _dirty.planetas.add(p.id);
  for (const n of mundo.naves) _dirty.naves.add(n.id);
}

function limparDirty(): void {
  _dirty.header = false;
  _dirty.sistemas.clear();
  _dirty.sois.clear();
  _dirty.planetas.clear();
  _dirty.naves.clear();
}

function temDirty(): boolean {
  return (
    _dirty.header ||
    _dirty.sistemas.size > 0 ||
    _dirty.sois.size > 0 ||
    _dirty.planetas.size > 0 ||
    _dirty.naves.size > 0
  );
}

// --- FlushController (experimental mode) ---

let _flushTimer: number | null = null;
let _flushInflight = false;

export function iniciarFlushController(): void {
  if (_flushTimer !== null) return;
  _flushTimer = window.setInterval(() => {
    void flushSeDirty();
  }, 500);
  // TODO: add requestIdleCallback scheduling per spec §5.4 for better
  // responsiveness — flush during browser idle periods instead of
  // competing with rendering on the setInterval tick.
}

export function pararFlushController(): void {
  if (_flushTimer !== null) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
}

async function flushSeDirty(): Promise<void> {
  if (!temDirty()) return;
  if (_flushInflight) return;
  if (!_mundoAtivo || !_nomeAtivo) return;
  _flushInflight = true;
  try {
    const dto = serializarMundo(_mundoAtivo, _nomeAtivo, {
      criadoEm: _criadoEm,
      tempoJogadoMs: _tempoJogadoMs,
    });
    await _backend.salvar(dto);
    limparDirty();
    _ultimoSaveAt = Date.now();
    _ultimoErro = null;
  } catch (err) {
    _ultimoErro = err instanceof Error ? err : new Error(String(err));
    console.error('[save] flush failed:', err);
  } finally {
    _flushInflight = false;
  }
}

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
  const cfg = getConfig();
  if (cfg.saveMode === 'experimental') {
    iniciarFlushController();
  } else {
    reagendarTimer();
  }
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
  pararFlushController();
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
    const result = _backend.salvar(dto);
    _ultimoSaveAt = now;
    _ultimoErro = null;
    // Handle async backends (ExperimentalBackend returns a Promise)
    if (result instanceof Promise) {
      result.catch((err) => {
        _ultimoErro = err instanceof Error ? err : new Error(String(err));
        console.error('[save] autosave failed (async):', err);
      });
    }
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
  _ultimoSaveAt = 0; // bypass throttle for drain-save
  salvarAgora();
  // Stop both controllers before switching
  if (_timerId !== null) { clearInterval(_timerId); _timerId = null; }
  pararFlushController();
  _backend = criarBackend();
  if (_mundoAtivo) {
    const cfg = getConfig();
    if (cfg.saveMode === 'experimental') {
      iniciarFlushController();
    } else {
      reagendarTimer();
    }
  }
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
  let dto: MundoDTO;
  try {
    dto = JSON.parse(raw) as MundoDTO;
  } catch (err) {
    console.error('[save] emergency blob corrupt:', err);
    localStorage.removeItem(key);
    return null;
  }
  try {
    await _backend.salvar(dto);
    localStorage.removeItem(key); // only remove after backend save succeeds
    return dto;
  } catch (err) {
    console.error('[save] emergency recovery backend write failed:', err);
    // Keep the blob in localStorage for next attempt
    return dto; // still return it so the game can load
  }
}

export async function lerEMigrar(nome: string): Promise<MundoDTO | null> {
  const raw = await _backend.carregar(nome);
  if (!raw) return null;
  return migrarDto(raw);
}

/**
 * Like lerEMigrar but returns the full migration report so callers can
 * log which legacy version was loaded and which transforms ran.
 */
export async function lerEMigrarComRelatorio(nome: string): Promise<MigrationResult | null> {
  const raw = await _backend.carregar(nome);
  if (!raw) return null;
  return migrarDtoComRelatorio(raw);
}
