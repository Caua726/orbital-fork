import type { Mundo } from '../../types';
import type { MundoDTO } from './dto';
import type { StorageBackend, SaveMetadata } from './storage-backend';
import { PeriodicBackend } from './periodic-save';
import { serializarMundo } from './serializar';
import { reconstruirMundo } from './reconstruir';
import { migrarDto } from './migrations';
import { getConfig } from '../../core/config';

export type { SaveMetadata } from './storage-backend';
export type { MundoDTO } from './dto';
export { reconstruirMundo } from './reconstruir';
export { serializarMundo } from './serializar';
export { migrarDto } from './migrations';

let _backend: StorageBackend = new PeriodicBackend();
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

export function instalarListenersCicloDeVida(): void {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') salvarAgora();
  });
  window.addEventListener('beforeunload', () => {
    salvarAgora();
  });
}

export async function lerEMigrar(nome: string): Promise<MundoDTO | null> {
  const raw = await _backend.carregar(nome);
  if (!raw) return null;
  return migrarDto(raw);
}
