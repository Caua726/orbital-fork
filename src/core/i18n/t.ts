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
    // String.split+join is faster than RegExp for simple placeholder
    // substitution and — critically — allocates no regex, no JIT path.
    // t() is called per-frame from the fog / memory layer for dozens
    // of ghost planets; a fresh `new RegExp(...)` every call was one
    // of the jank sources flagged by profiling.
    for (const k in params) {
      const needle = `{${k}}`;
      if (text.indexOf(needle) === -1) continue;
      text = text.split(needle).join(String(params[k]));
    }
  }
  return text;
}
