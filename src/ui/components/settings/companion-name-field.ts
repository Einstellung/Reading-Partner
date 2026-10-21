// The companion-name field in Settings, without React: what a keystroke may
// leave in the box, and what is written when the field is left.

import { COMPANION_NAME_CAP } from "../../../platform/app/settings";

// What the box holds while typing: cut to the cap in characters (not UTF-16
// units, so an emoji or a CJK extension character counts once), spaces left as
// typed so "Mary Ann" can be entered one key at a time.
export function companionNameInput(raw: string): string {
  return Array.from(raw).slice(0, COMPANION_NAME_CAP).join("");
}

// What is stored once the field is left: whitespace folded and trimmed, and ""
// for nothing, which means the default name. Not the default's own text, so a
// later change of the default reaches a reader who never chose a name.
export function companionNameToStore(raw: string): string {
  return companionNameInput(raw.replace(/\s+/g, " ").trim()).trim();
}
