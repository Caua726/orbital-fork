import { getConfig } from '../core/config';

/**
 * Executa `onConfirm` se o usuário confirmar (ou direto se a config
 * `confirmarDestrutivo` estiver desabilitada). Usa `window.confirm` como
 * implementação mínima — pode ser trocado por um modal custom no futuro
 * sem mudar a API.
 */
export function confirmarAcao(msg: string, onConfirm: () => void): void {
  if (!getConfig().gameplay.confirmarDestrutivo) {
    onConfirm();
    return;
  }
  if (window.confirm(msg)) {
    onConfirm();
  }
}
