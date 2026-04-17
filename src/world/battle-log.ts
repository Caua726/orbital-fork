/**
 * Recent battles summary — captures aggregate outcomes so the future
 * "battle replay" UI has something to show. Cap ~50.
 */

import type { BattleDTO } from './save/dto';

const CAP_BATTLES = 50;
let _battles: BattleDTO[] = [];

export function registrarBattle(b: BattleDTO): void {
  _battles.push({ ...b });
  if (_battles.length > CAP_BATTLES) {
    _battles.splice(0, _battles.length - CAP_BATTLES);
  }
}

export function getBattles(): readonly BattleDTO[] {
  return _battles;
}

export function getBattlesSerializaveis(): BattleDTO[] {
  return _battles.map((b) => ({ ...b }));
}

export function restaurarBattles(dtos: BattleDTO[]): void {
  _battles = dtos.slice(-CAP_BATTLES).map((b) => ({ ...b }));
}

export function resetBattles(): void {
  _battles = [];
}
