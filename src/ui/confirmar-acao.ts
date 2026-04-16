import { getConfig } from '../core/config';
import { confirmar } from './confirm-dialog';

/**
 * Executa `onConfirm` se o usuário confirmar via modal custom (ou direto
 * se a config `confirmarDestrutivo` estiver desabilitada).
 */
export function confirmarAcao(msg: string, onConfirm: () => void): void {
  if (!getConfig().gameplay.confirmarDestrutivo) {
    onConfirm();
    return;
  }
  void confirmar({
    title: 'Confirmar',
    message: msg,
    confirmLabel: 'Sim',
    cancelLabel: 'Cancelar',
    danger: true,
  }).then((ok) => {
    if (ok) onConfirm();
  });
}
