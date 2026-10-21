/**
 * Minimal i18n: data and engine store message KEYS only; this module turns a
 * key into text for the current language. Thai only for now (design doc
 * section 15); English is added later as en.json with the same keys.
 *
 * Why not a library (i18next, react-intl)? We need key lookup + {param}
 * replacement. That is ~20 lines; a library is worth it only when we need
 * plurals, lazy-loaded languages, or translator tooling.
 */

import th from './th.json';

export type Messages = Record<string, string>;

const MESSAGES: Messages = th;

const reportedMissing = new Set<string>();

/**
 * Translates a key, replacing {name} placeholders with params.
 * A missing key returns the key itself, so the UI shows something visibly
 * wrong ("stat.foo") instead of crashing or showing an empty string.
 */
export function t(key: string, params: Record<string, string | number> = {}, messages: Messages = MESSAGES): string {
  const template = messages[key];
  if (template === undefined) {
    if (!reportedMissing.has(key)) {
      reportedMissing.add(key);
      console.warn(`[i18n] Missing message key: ${key}`);
    }
    return key;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function hasMessage(key: string, messages: Messages = MESSAGES): boolean {
  return messages[key] !== undefined;
}
