// The book-level chat's posture (docs/09, docs/31). Three of them, and only ever
// one at a time: companion (the reader drives), classroom (the AI teaches), and
// rehearsal (the AI questions). Pure, because the mutual exclusion is the whole
// content of this file and it has to be the same rule in the toggle, in the
// persisted flags and in the turn assembly.
//
// Two booleans rather than one enum on disk: reading-state.json already carries
// `classroom` on every book the reader ever switched it on for, and a stored
// enum would have to be migrated out of it. The enum lives here instead.

export type ReadingMode = "companion" | "classroom" | "rehearsal";

// The persisted pair, as reading-state.json holds it.
export interface ModeFlags {
  classroom: boolean;
  rehearsal: boolean;
}

// A pressable mode: the two buttons, not the resting state.
export type ModeButton = Exclude<ReadingMode, "companion">;

// Read the pair back as a mode. A file with both set cannot be written by this
// build, but an older one plus a hand edit could; rehearsal wins, because it is
// the mode that carries a decision file the reader would otherwise think dead.
export function modeOf(flags: Partial<ModeFlags> | null | undefined): ReadingMode {
  if (flags?.rehearsal) return "rehearsal";
  if (flags?.classroom) return "classroom";
  return "companion";
}

export function flagsOf(mode: ReadingMode): ModeFlags {
  return { classroom: mode === "classroom", rehearsal: mode === "rehearsal" };
}

// What pressing a mode button does: it turns its own mode on, or off if it was
// already on. Pressing one while the other is on switches — no press ever leaves
// both on, and none of them needs the caller to remember to turn the other off.
export function pressMode(current: ReadingMode, pressed: ModeButton): ReadingMode {
  return current === pressed ? "companion" : pressed;
}
