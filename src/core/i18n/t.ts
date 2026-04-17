import { DICT } from './dict';
import { getConfig } from '../config';

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = DICT[key];
  if (!entry) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  const lang = getConfig().language ?? 'pt';
  let text = entry[lang] ?? entry.pt;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}
