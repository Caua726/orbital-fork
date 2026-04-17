/**
 * Circular event log — records notable moments (combats, conquests,
 * research completions, first contacts) so the future notification
 * panel / replay feature has something to read.
 *
 * Capped at 200 entries FIFO. Persisted in the save.
 */

import type { EventoHistoricoDTO, EventoTipo } from './save/dto';

const CAP_EVENTOS = 200;
let _eventos: EventoHistoricoDTO[] = [];

export function registrarEvento(
  tipo: EventoTipo,
  texto: string,
  tempoMs: number,
  payload?: Record<string, string | number>,
): void {
  _eventos.push({ tipo, texto, tempoMs, payload });
  if (_eventos.length > CAP_EVENTOS) {
    _eventos.splice(0, _eventos.length - CAP_EVENTOS);
  }
}

export function getEventos(): readonly EventoHistoricoDTO[] {
  return _eventos;
}

export function getEventosSerializaveis(): EventoHistoricoDTO[] {
  return _eventos.map((e) => ({ ...e, payload: e.payload ? { ...e.payload } : undefined }));
}

export function restaurarEventos(dtos: EventoHistoricoDTO[]): void {
  _eventos = dtos.slice(-CAP_EVENTOS).map((e) => ({ ...e, payload: e.payload ? { ...e.payload } : undefined }));
}

export function resetEventos(): void {
  _eventos = [];
}
