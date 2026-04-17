/**
 * Tracks last-known positions of enemy ships that have passed through
 * the player's vision but are no longer visible. Each entry decays
 * after a grace period.
 *
 * Persisted in save so load restores the intel picture the player had.
 */

import type { LastSeenDTO } from './save/dto';

const _map = new Map<string, LastSeenDTO>();

export function registrarLastSeen(nave: { id: string; dono: string; x: number; y: number }, tempoMs: number): void {
  _map.set(nave.id, { naveId: nave.id, dono: nave.dono, x: nave.x, y: nave.y, tempoMs });
}

export function esquecerLastSeen(naveId: string): void {
  _map.delete(naveId);
}

export function getLastSeen(): readonly LastSeenDTO[] {
  return Array.from(_map.values());
}

export function getLastSeenSerializavel(): LastSeenDTO[] {
  return Array.from(_map.values()).map((v) => ({ ...v }));
}

export function restaurarLastSeen(dtos: LastSeenDTO[]): void {
  _map.clear();
  for (const d of dtos) _map.set(d.naveId, { ...d });
}

export function resetLastSeen(): void {
  _map.clear();
}
