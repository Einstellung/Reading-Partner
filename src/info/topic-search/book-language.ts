// The language a brief book is written in (docs/info/88 「简报书」): the
// reader's explicit language setting, else the UI language the system gives.
// `languageInstruction("auto")` is empty on purpose for chat, which mirrors the
// reader's words; a book has no reader words in its prompt, so left to itself
// the model picked a language at random (docs/pitfall/647). Everything that
// ends up in an issue — the write-up, the doubts, Lumen's opening, the
// program's own labels — goes through here and agrees.

import { localeForSetting, type Locale } from "../../i18n/locale";
import { languageInstruction, type AiLanguage } from "../../platform/app/settings";

/** The locale the book is written in; `system` is the device's language list (injected in tests). */
export function bookLocale(aiLanguage: AiLanguage, system?: readonly string[]): Locale {
  return localeForSetting(aiLanguage, system);
}

/** The language directive for the models that write for the book: never empty. */
export function bookLanguageInstruction(aiLanguage: AiLanguage, system?: readonly string[]): string {
  return languageInstruction(bookLocale(aiLanguage, system));
}
