/**
 * Tracks procedural names already used in the current world so we can
 * avoid collisions over long games where many ships/factions spawn.
 */

const _usados = new Set<string>();

export function registrarNomeUsado(nome: string): void {
  _usados.add(nome);
}

export function foiUsado(nome: string): boolean {
  return _usados.has(nome);
}

export function getNomesUsadosSerializavel(): string[] {
  return Array.from(_usados);
}

export function restaurarNomesUsados(lista: string[]): void {
  _usados.clear();
  for (const n of lista) _usados.add(n);
}

export function resetNomesUsados(): void {
  _usados.clear();
}
