// The old profile, turned into a list the reader can keep. Everything the card
// (ProfileLinesCard.tsx) does apart from drawing it is here: the two documents
// become lines, a line becomes the text of a statement, and the lines already
// kept drop out.
//
// Two sources, and they are shown apart because they are not the same kind of
// thing. The declared half of user-profile.md is what the reader dictated
// through an update_profile card; the guess entries are what the AI inferred on
// its own and never asked about (memory/profile/guess.ts). Both stop being read
// at 0.13 and neither is deleted — this screen is the one chance to carry what
// still holds across to a statement the reader owns (docs/48).
//
// Text is the identity here, not a position. Lines are de-duplicated by it, a
// pick is keyed by it, and "already kept" is exact text equality against the
// reader's own statements — so pressing the button twice writes nothing twice,
// and so a line that was kept on another device does not reappear here.

import { GUESS_HEADING, parseGuessLine, type ProfileGuess } from "../../../memory/profile/guess";
import type { Statement, StatementKind } from "../../../memory/statements/types";

export type ProfileLineSource = "declared" | "guess";

export interface ProfileLine {
  source: ProfileLineSource;
  // What the list shows and what the statement would say, the same string:
  // nothing is composed at write time that the reader did not read first.
  text: string;
}

export interface ProfilePick {
  checked: boolean;
  kind: StatementKind;
}

// --- the declared half ---

const HEADING = /^#{1,6}\s+(.*)$/;
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const COMMENT = /^<!--.*$/;
// A whole line wrapped in emphasis, which is how a heading is written when
// nobody used a "#".
const WRAPPED = /^(\*\*|__|\*|_)(.+?)\1$/;

function unwrap(line: string): string {
  const m = WRAPPED.exec(line.trim());
  return m ? m[2].trim() : line.trim();
}

function sectionOf(text: string): string | null {
  return text.trim().replace(/:$/, "").trim() || null;
}

// A section name, or null when this line is an entry. Three forms, because the
// profile skeleton's four sections (memory/profile/profile.ts) get written all
// three ways: a markdown heading, a whole line in bold, and a bare "Interests:"
// label with the entries under it.
function sectionName(line: string): string | null {
  const trimmed = line.trim();
  const heading = HEADING.exec(trimmed);
  if (heading) return sectionOf(heading[1]);
  // An entry stays an entry however it is decorated.
  if (LIST_MARKER.test(trimmed)) return null;
  const wrapped = WRAPPED.exec(trimmed);
  // A sentence someone emphasised is not a heading; a heading has no full stop.
  if (wrapped && !wrapped[2].trim().endsWith(".")) return sectionOf(wrapped[2]);
  if (trimmed.endsWith(":")) return sectionOf(trimmed);
  return null;
}

// The section is carried onto its items because a bare "robotics" is not a
// claim about anybody. Skipped when the item already opens with the section
// name, so a document that repeats it does not get it twice.
function withSection(section: string | null, item: string): string {
  if (!section) return item;
  if (item.toLowerCase().startsWith(section.toLowerCase())) return item;
  return `${section}: ${item}`;
}

// The declared half of user-profile.md, one entry per line. Free-text markdown
// (memory/profile/profile.ts, PROFILE_SKELETON_GUIDANCE), so the markers come
// off, blanks and rules and comments go, and headings become the prefix of what
// follows them rather than entries of their own.
export function declaredLines(declared: string): string[] {
  const out: string[] = [];
  let section: string | null = null;
  for (const raw of declared.split("\n")) {
    const line = raw.trim();
    if (line === "" || RULE.test(line) || COMMENT.test(line)) continue;
    // The guess section, when its markers did not parse: splitProfile then hands
    // the whole document back as declared, which is the safe reading for a
    // writer and would otherwise show the AI's entries here twice over — once
    // mangled with their basis and date, once properly under "The AI guessed".
    if (line === GUESS_HEADING) {
      section = null;
      continue;
    }
    if (parseGuessLine(line)) continue;
    const name = sectionName(line);
    if (name !== null) {
      section = name;
      continue;
    }
    const item = unwrap(line.replace(LIST_MARKER, "")).replace(/^>\s*/, "").trim();
    if (item.length < 2) continue;
    out.push(withSection(section, item));
  }
  return out;
}

// The guess entries, text only. `basis` and `since` are the pass's own
// bookkeeping about a guess it may revise; a statement the reader keeps is
// theirs, and carrying the AI's reasoning into it would make it read as the
// AI's again.
export function guessLines(guesses: readonly ProfileGuess[]): string[] {
  return guesses.map((g) => g.text.trim()).filter((t) => t.length >= 2);
}

// --- the list ---

// What the reader has already kept: statement text, theirs only. A dream's
// statement never hides a line — it is not the reader saying it, which is the
// whole difference this screen exists to record.
export function keptTexts(statements: readonly Statement[]): Set<string> {
  return new Set(statements.filter((s) => s.author === "reader").map((s) => s.text.trim()));
}

export function profileLines(input: {
  declared: string;
  guesses: readonly ProfileGuess[];
  statements: readonly Statement[];
}): ProfileLine[] {
  const kept = keptTexts(input.statements);
  const seen = new Set<string>();
  const out: ProfileLine[] = [];
  const add = (source: ProfileLineSource, texts: readonly string[]) => {
    for (const text of texts) {
      if (kept.has(text) || seen.has(text)) continue;
      seen.add(text);
      out.push({ source, text });
    }
  };
  add("declared", declaredLines(input.declared));
  add("guess", guessLines(input.guesses));
  return out;
}

export function groupLines(lines: readonly ProfileLine[]): {
  declared: ProfileLine[];
  guessed: ProfileLine[];
} {
  return {
    declared: lines.filter((l) => l.source === "declared"),
    guessed: lines.filter((l) => l.source === "guess"),
  };
}

// --- the card's state ---

export interface ProfileLinesState {
  // False until both documents have been read. The card draws nothing before
  // that, so an empty profile never flashes a card that is about to vanish.
  loaded: boolean;
  lines: ProfileLine[];
  picks: Record<string, ProfilePick>;
  writing: boolean;
  // How many statements the last press wrote. Null before the first one.
  wrote: number | null;
  error: string | null;
}

export type ProfileLinesAction =
  | {
      type: "load";
      declared: string;
      guesses: readonly ProfileGuess[];
      statements: readonly Statement[];
    }
  | { type: "toggle"; text: string }
  | { type: "kind"; text: string; kind: StatementKind }
  | { type: "write" }
  | { type: "wrote"; texts: readonly string[] }
  | { type: "fail"; message: string };

export const initialProfileLinesState: ProfileLinesState = {
  loaded: false,
  lines: [],
  picks: {},
  writing: false,
  wrote: null,
  error: null,
};

// Nothing is checked to start with. A default of "keep everything" would make
// the button mean "I did not read this", and profile is the default kind
// because a concern is a claim about right now that only the reader can make.
function freshPicks(lines: readonly ProfileLine[]): Record<string, ProfilePick> {
  const picks: Record<string, ProfilePick> = {};
  for (const line of lines) picks[line.text] = { checked: false, kind: "profile" };
  return picks;
}

export function profileLinesReducer(
  state: ProfileLinesState,
  action: ProfileLinesAction,
): ProfileLinesState {
  switch (action.type) {
    case "load": {
      const lines = profileLines(action);
      return { ...state, loaded: true, lines, picks: freshPicks(lines) };
    }
    case "toggle": {
      const pick = state.picks[action.text];
      if (!pick || state.writing) return state;
      return {
        ...state,
        picks: { ...state.picks, [action.text]: { ...pick, checked: !pick.checked } },
      };
    }
    case "kind": {
      const pick = state.picks[action.text];
      if (!pick || state.writing) return state;
      return { ...state, picks: { ...state.picks, [action.text]: { ...pick, kind: action.kind } } };
    }
    case "write":
      // Nothing checked writes nothing, and a second press while the first is
      // in flight is the way to write a line twice.
      if (state.writing || checkedWrites(state).length === 0) return state;
      return { ...state, writing: true, error: null, wrote: null };
    case "wrote": {
      // Only what was actually written leaves the list. A press that failed
      // halfway reports the failure and keeps the rest on screen to try again.
      const written = new Set(action.texts);
      const lines = state.lines.filter((l) => !written.has(l.text));
      const picks: Record<string, ProfilePick> = {};
      for (const line of lines) picks[line.text] = state.picks[line.text];
      return { ...state, writing: false, lines, picks, wrote: action.texts.length };
    }
    case "fail":
      return { ...state, writing: false, error: action.message };
  }
}

// What the button would write, in the order the list shows.
export function checkedWrites(state: ProfileLinesState): { text: string; kind: StatementKind }[] {
  return state.lines
    .filter((l) => state.picks[l.text]?.checked)
    .map((l) => ({ text: l.text, kind: state.picks[l.text].kind }));
}

export function writtenNote(count: number): string {
  return count === 1 ? "1 statement written" : `${count} statements written`;
}
