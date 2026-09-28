// Every UI catalog against its English source (docs/ui/81). The types already
// reject a missing or extra key in a translation file; what they cannot see is
// the text itself: a translation that drops "{name}" or misspells it, and a
// plural that lacks a form its language needs. Run: bun test.

import { expect, test } from "bun:test";
import { AREAS } from "../../src/i18n/areas";
import { LOCALES, type Locale } from "../../src/i18n/locale";
import type { Message } from "../../src/i18n/messages/types";

type Catalog = Readonly<Record<string, Message>>;
const areas = AREAS as unknown as Record<string, Record<Locale, Catalog>>;

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(message: Message): Set<string> {
  const forms = typeof message === "string" ? [message] : Object.values(message);
  const out = new Set<string>();
  for (const form of forms) {
    for (const m of form!.matchAll(PLACEHOLDER)) out.add(m[1]);
  }
  return out;
}

// The plural categories a language actually picks for whole numbers. French,
// Spanish and Portuguese have a "many" that CLDR reserves for a million and
// up; falling back to "other" there reads right, so it is not demanded.
function neededCategories(locale: Locale): Set<string> {
  const rules = new Intl.PluralRules(locale);
  const out = new Set<string>();
  for (let n = 0; n <= 1000; n++) out.add(rules.select(n));
  return out;
}

test("every area has a catalog for every locale", () => {
  for (const [name, area] of Object.entries(areas)) {
    expect({ name, locales: Object.keys(area).sort() }).toEqual({
      name,
      locales: [...LOCALES].sort(),
    });
  }
});

test("every locale has exactly the English keys", () => {
  for (const [name, area] of Object.entries(areas)) {
    const source = Object.keys(area.en).sort();
    for (const locale of LOCALES) {
      expect({ area: name, locale, keys: Object.keys(area[locale]).sort() }).toEqual({
        area: name,
        locale,
        keys: source,
      });
    }
  }
});

test("a translation keeps every placeholder and invents none", () => {
  const wrong: string[] = [];
  for (const [name, area] of Object.entries(areas)) {
    for (const [key, source] of Object.entries(area.en)) {
      const want = [...placeholders(source)].sort().join(",");
      for (const locale of LOCALES) {
        const message = area[locale][key];
        const forms = typeof message === "string" ? [message] : Object.values(message);
        for (const form of forms) {
          const got = [...placeholders(form!)].sort().join(",");
          if (got !== want) wrong.push(`${locale} ${name}.${key}: {${got}} vs English {${want}}`);
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("a plural stays a plural and has every form its language uses", () => {
  const wrong: string[] = [];
  for (const [name, area] of Object.entries(areas)) {
    for (const [key, source] of Object.entries(area.en)) {
      for (const locale of LOCALES) {
        const message = area[locale][key];
        if (typeof source === "string") {
          if (typeof message !== "string") wrong.push(`${locale} ${name}.${key}: not a string`);
          continue;
        }
        if (typeof message === "string") {
          wrong.push(`${locale} ${name}.${key}: not a plural`);
          continue;
        }
        const has = new Set(Object.keys(message));
        for (const category of neededCategories(locale)) {
          if (!has.has(category)) wrong.push(`${locale} ${name}.${key}: no "${category}"`);
        }
        const all = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
        for (const category of has) {
          if (!all.has(category as Intl.LDMLPluralRule)) {
            wrong.push(`${locale} ${name}.${key}: "${category}" is not a category of ${locale}`);
          }
        }
      }
    }
  }
  expect(wrong).toEqual([]);
});

test("no message is empty", () => {
  const empty: string[] = [];
  for (const [name, area] of Object.entries(areas)) {
    for (const locale of LOCALES) {
      for (const [key, message] of Object.entries(area[locale])) {
        const forms = typeof message === "string" ? [message] : Object.values(message);
        if (forms.some((f) => !f || !f.trim())) empty.push(`${locale} ${name}.${key}`);
      }
    }
  }
  expect(empty).toEqual([]);
});
