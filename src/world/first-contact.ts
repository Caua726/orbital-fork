/**
 * First-contact log — remembers tempoJogadoMs at which the player first
 * saw each enemy faction. Feeds narrative/tooltip data like "descoberto
 * há X min".
 */

const _log: Record<string, number> = {};

export function marcarPrimeiroContato(donoIa: string, tempoJogadoMs: number): void {
  if (_log[donoIa] !== undefined) return;
  _log[donoIa] = tempoJogadoMs;
}

export function getPrimeiroContato(donoIa: string): number | undefined {
  return _log[donoIa];
}

export function getFirstContactMap(): Record<string, number> {
  return { ..._log };
}

export function restaurarFirstContact(map: Record<string, number>): void {
  for (const k of Object.keys(_log)) delete _log[k];
  Object.assign(_log, map);
}

export function resetFirstContact(): void {
  for (const k of Object.keys(_log)) delete _log[k];
}
