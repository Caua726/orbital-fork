import { ACTIONS } from './actions';
import { getConfig } from '../config';

export type KeyBindings = Record<string, string[]>;

export function getActiveKeymap(): KeyBindings {
  const custom = getConfig().input?.bindings ?? {};
  const result: KeyBindings = {};
  for (const action of ACTIONS) {
    result[action.id] = custom[action.id] ?? action.defaultKeys;
  }
  return result;
}

export function resolveKeyToAction(code: string): string | null {
  const keymap = getActiveKeymap();
  for (const [actionId, keys] of Object.entries(keymap)) {
    if (keys.includes(code)) return actionId;
  }
  return null;
}

export function detectarConflito(code: string, ignorarAction?: string): string | null {
  const keymap = getActiveKeymap();
  for (const [actionId, keys] of Object.entries(keymap)) {
    if (actionId === ignorarAction) continue;
    if (keys.includes(code)) return actionId;
  }
  return null;
}
