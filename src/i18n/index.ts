import en from './en.json';
import ms from './ms.json';

export type Lang = 'en' | 'ms';
export type Key = keyof typeof en;

const dictionaries: Record<Lang, Record<Key, string>> = { en, ms };

/** Look up a UI string. scripts/check-i18n.mjs fails the build if the two files differ in keys. */
export function t(lang: Lang, key: Key): string {
  return dictionaries[lang][key];
}

/** Address of a page in a given language. `path` has no language prefix, e.g. "" or "states/kelantan/". */
export function pathFor(lang: Lang, path: string): string {
  return lang === 'ms' ? `/ms/${path}` : `/${path}`;
}

export const ROLES = [
  'default',
  'journalist',
  'researcher',
  'parent',
  'policymaker',
  'teacher',
] as const;
