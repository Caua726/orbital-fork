/**
 * First-contact log — remembers tempoJogadoMs at which the player first
 * saw each enemy faction. Feeds narrative/tooltip data like "descoberto
 * há X min".
 */

const _log: Record<string, number> = {};
let _count = 0;

export function marcarPrimeiroContato(donoIa: string, tempoJogadoMs: number): void {
  if (_log[donoIa] !== undefined) return;
  _log[donoIa] = tempoJogadoMs;
  _count++;
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
  _count = Object.keys(_log).length;
}

export function resetFirstContact(): void {
  for (const k of Object.keys(_log)) delete _log[k];
  _count = 0;
}

export function getFirstContactCount(): number {
  return _count;
}
