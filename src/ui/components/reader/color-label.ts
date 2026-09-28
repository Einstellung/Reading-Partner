// A pen colour's name in the reader's language. platform/app/annotations.ts
// names the colours in English and cannot reach the catalogs, so the word is
// looked up here by that English name; one the table does not know is shown
// as it is.

import type { Translate } from "../../../i18n";

const COLOR_KEYS = {
  Yellow: "reader.color.yellow",
  Red: "reader.color.red",
  Green: "reader.color.green",
  Blue: "reader.color.blue",
  Purple: "reader.color.purple",
  Magenta: "reader.color.magenta",
  Orange: "reader.color.orange",
  Gray: "reader.color.gray",
} as const;

export function colorLabel(t: Translate, name: string): string {
  const key = COLOR_KEYS[name as keyof typeof COLOR_KEYS];
  return key ? t(key) : name;
}
