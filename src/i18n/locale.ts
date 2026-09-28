// Which language the UI is drawn in, held once for the whole app (docs/ui/81).
//
// The setting behind it is `aiLanguage` (platform/app/settings.ts): one choice
// drives both what the AI writes in and what the UI is drawn in. "auto" leaves
// the AI mirroring the reader and draws the UI in the system language, matched
// onto the languages there are catalogs for.
//
// A module-level store rather than a React context, so .ts code that produces a
// user-facing string (an error, a toast) reads the same locale a component does.

import type { AiLanguage } from "../platform/app/settings";
import type { Locale } from "./messages/types";

export type { Locale };

// Every locale there is a catalog for. English first: it is the source every
// other catalog is typed against, and the fallback for anything unmatched.
export const LOCALES: readonly Locale[] = ["en", "zh-CN", "ja", "ko", "es", "fr", "de", "pt", "ru"];

export const SOURCE_LOCALE: Locale = "en";

const PRIMARY: Record<string, Locale> = {
  en: "en",
  zh: "zh-CN",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  pt: "pt",
  ru: "ru",
};

// The first BCP-47 tag in preference order that names a supported language.
// Chinese of any script lands on zh-CN: there is no Traditional catalog, and
// Simplified is closer for a Traditional reader than English is.
export function matchLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const primary = tag.toLowerCase().split(/[-_]/)[0];
    const hit = PRIMARY[primary];
    if (hit) return hit;
  }
  return SOURCE_LOCALE;
}

// The system's preferred languages as the webview reports them. Empty with no
// navigator (a headless test), which matches to English.
export function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

// The UI locale a value of the language setting means.
export function localeForSetting(
  aiLanguage: AiLanguage,
  system: readonly string[] = systemLanguages(),
): Locale {
  return aiLanguage === "auto" ? matchLocale(system) : aiLanguage;
}

let current: Locale = matchLocale(systemLanguages());
const listeners = new Set<() => void>();

// <html lang> picks the CJK glyph variant for text the UI did not write (book
// text, AI replies). It stays "zh", as index.html always had it, unless the UI
// itself is Japanese or Korean.
function markDocument(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "ja" || locale === "ko" ? locale : "zh";
}
markDocument(current);

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  markDocument(next);
  for (const fn of listeners) fn();
}

// What the shell calls whenever the language setting is read or changed.
export function applyLanguageSetting(aiLanguage: AiLanguage): void {
  setLocale(localeForSetting(aiLanguage));
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
