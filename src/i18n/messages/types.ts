// The shapes a message catalog is written in (docs/ui/81).
//
// An area's English file is the source: a plain object of strings, `as const`
// so the placeholders in each string are visible to the type of t(). Every other
// locale's file for that area is typed with Translation<typeof en>, so a missing
// or an extra key fails the typecheck.

import type { AiLanguage } from "../../platform/app/settings";

// A language there is a UI catalog for: every value of the language setting
// except "auto".
export type Locale = Exclude<AiLanguage, "auto">;

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

// A message that varies with a count, one form per plural category the locale
// has (Intl.PluralRules). "other" is required because every locale has it.
export type Plural = { readonly other: string } & {
  readonly [C in Exclude<PluralCategory, "other">]?: string;
};

export type Message = string | Plural;

export type AreaMessages = { readonly [key: string]: Message };

// Another locale's copy of an English area: the same keys, any wording, and a
// plural where English has one.
export type Translation<T extends AreaMessages> = {
  readonly [K in keyof T]: T[K] extends string ? string : Plural;
};

// An area as the registry holds it: English plus every other locale.
export type Area<T extends AreaMessages> = { readonly en: T } & {
  readonly [L in Exclude<Locale, "en">]: Translation<T>;
};
