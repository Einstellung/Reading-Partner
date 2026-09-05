// The profile carry-over list (src/ui/components/settings/profile-pick.ts):
// turning the old user-profile.md and the AI's guesses into lines the reader can
// keep, and the state the card drives. Run: bun test.

import { expect, test } from "bun:test";
import type { ProfileGuess } from "../../../src/memory/profile/guess";
import type { Statement, StatementKind } from "../../../src/memory/statements/types";
import {
  checkedWrites,
  declaredLines,
  groupLines,
  guessLines,
  initialProfileLinesState,
  keptTexts,
  profileLines,
  profileLinesReducer,
  writtenNote,
  type ProfileLinesAction,
  type ProfileLinesState,
} from "../../../src/ui/components/settings/profile-pick";

function guess(text: string, over: Partial<ProfileGuess> = {}): ProfileGuess {
  return { text, basis: "Marked capital-flow passages", since: "2026-08-01", ...over };
}

function statement(text: string, over: Partial<Statement> = {}): Statement {
  return {
    id: "s-0000000000000001",
    kind: "profile",
    text,
    author: "reader",
    evidence: [],
    contradictedBy: [],
    established: "2026-09-05",
    lastSupported: "2026-09-05",
    ...over,
  };
}

// --- the declared half ---

test("the flat form of the profile is one entry per line", () => {
  expect(declaredLines("Interests: robotics, macro.\nTaste: allergic to vendor PR.\n")).toEqual([
    "Interests: robotics, macro.",
    "Taste: allergic to vendor PR.",
  ]);
});

// A bare "robotics" is not a claim about anybody, so the heading it sits under
// travels with it.
test("headings become the prefix of the entries under them, not entries", () => {
  const declared = [
    "# Profile",
    "",
    "## Interests",
    "- robotics",
    "* macro, especially capital flows",
    "",
    "**Taste**",
    "1. allergic to vendor PR",
    "",
    "---",
    "Now:",
    "- trends.pdf (2026-08)",
  ].join("\n");
  expect(declaredLines(declared)).toEqual([
    "Interests: robotics",
    "Interests: macro, especially capital flows",
    "Taste: allergic to vendor PR",
    "Now: trends.pdf (2026-08)",
  ]);
});

test("an entry that already opens with its section is not prefixed twice", () => {
  expect(declaredLines("## Interests\n- Interests in robotics\n")).toEqual([
    "Interests in robotics",
  ]);
});

// The bold-line rule has to stop somewhere, or an emphasised sentence would
// swallow everything after it as its section.
test("an emphasised sentence is an entry, not a heading", () => {
  expect(declaredLines("*Wants the derivation.*\n- and the diagram after it\n")).toEqual([
    "Wants the derivation.",
    "and the diagram after it",
  ]);
});

test("blank lines, rules, comments and lone markers drop out", () => {
  const declared = "\n\n<!-- ai-guess:begin -->\n***\n-\n- x\n- a real line\n";
  expect(declaredLines(declared)).toEqual(["a real line"]);
});

test("guesses come across as their text alone, without the basis or the date", () => {
  expect(guessLines([guess("Reads for the era, not the method"), guess("  ")])).toEqual([
    "Reads for the era, not the method",
  ]);
});

// --- the list ---

test("a line the reader already kept is not offered again", () => {
  const lines = profileLines({
    declared: "Interests: robotics.\nTaste: allergic to vendor PR.\n",
    guesses: [guess("Reads for the era")],
    statements: [
      statement("Taste: allergic to vendor PR."),
      // A dream's statement is not the reader saying it, so it hides nothing.
      statement("Reads for the era", { author: "dream", id: "s-0000000000000002" }),
    ],
  });
  expect(lines).toEqual([
    { source: "declared", text: "Interests: robotics." },
    { source: "guess", text: "Reads for the era" },
  ]);
});

test("the same text from both halves is listed once, as the declared one", () => {
  const lines = profileLines({
    declared: "Reads for the era\n",
    guesses: [guess("Reads for the era")],
    statements: [],
  });
  expect(lines).toEqual([{ source: "declared", text: "Reads for the era" }]);
  expect(groupLines(lines)).toEqual({ declared: lines, guessed: [] });
});

test("kept text is the reader's own, trimmed", () => {
  expect(keptTexts([statement("  spaced  "), statement("x", { author: "dream" })])).toEqual(
    new Set(["spaced"]),
  );
});

test("two empty documents make no lines, which is what stops the card drawing", () => {
  expect(profileLines({ declared: "", guesses: [], statements: [] })).toEqual([]);
});

// --- the card's state ---

function loaded(): ProfileLinesState {
  return profileLinesReducer(initialProfileLinesState, {
    type: "load",
    declared: "Interests: robotics.\nTaste: allergic to vendor PR.\n",
    guesses: [guess("Reads for the era")],
    statements: [],
  });
}

function run(state: ProfileLinesState, ...actions: ProfileLinesAction[]): ProfileLinesState {
  return actions.reduce(profileLinesReducer, state);
}

test("nothing is checked to start with, and the kind starts at profile", () => {
  const state = loaded();
  expect(state.loaded).toBe(true);
  expect(state.lines).toHaveLength(3);
  expect(Object.values(state.picks).every((p) => !p.checked && p.kind === "profile")).toBe(true);
  expect(checkedWrites(state)).toEqual([]);
});

test("checking and re-kinding a line is what the button writes, in list order", () => {
  const state = run(
    loaded(),
    { type: "toggle", text: "Reads for the era" },
    { type: "toggle", text: "Interests: robotics." },
    { type: "kind", text: "Reads for the era", kind: "concern" satisfies StatementKind },
  );
  expect(checkedWrites(state)).toEqual([
    { text: "Interests: robotics.", kind: "profile" },
    { text: "Reads for the era", kind: "concern" },
  ]);
  // Unchecking puts it back to nothing happening.
  expect(checkedWrites(run(state, { type: "toggle", text: "Reads for the era" }))).toEqual([
    { text: "Interests: robotics.", kind: "profile" },
  ]);
});

test("a press with nothing checked does not start a write", () => {
  expect(run(loaded(), { type: "write" })).toEqual(loaded());
});

test("a second press while the first is in flight changes nothing", () => {
  const writing = run(
    loaded(),
    { type: "toggle", text: "Interests: robotics." },
    { type: "write" },
  );
  expect(writing.writing).toBe(true);
  expect(run(writing, { type: "write" })).toEqual(writing);
  // Nor can the list be edited underneath a write in flight.
  expect(run(writing, { type: "toggle", text: "Reads for the era" })).toEqual(writing);
});

test("written lines leave the list and the rest stay checked", () => {
  const after = run(
    loaded(),
    { type: "toggle", text: "Interests: robotics." },
    { type: "toggle", text: "Reads for the era" },
    { type: "write" },
    { type: "wrote", texts: ["Interests: robotics."] },
  );
  expect(after.writing).toBe(false);
  expect(after.wrote).toBe(1);
  expect(after.lines.map((l) => l.text)).toEqual([
    "Taste: allergic to vendor PR.",
    "Reads for the era",
  ]);
  expect(Object.keys(after.picks)).toEqual(["Taste: allergic to vendor PR.", "Reads for the era"]);
  expect(checkedWrites(after)).toEqual([{ text: "Reads for the era", kind: "profile" }]);
});

test("a failure keeps the lines on screen and says what happened", () => {
  const after = run(
    loaded(),
    { type: "toggle", text: "Interests: robotics." },
    { type: "write" },
    { type: "fail", message: "disk full" },
  );
  expect(after.writing).toBe(false);
  expect(after.error).toBe("disk full");
  expect(after.lines).toHaveLength(3);
  expect(checkedWrites(after)).toHaveLength(1);
});

test("the count reads as a sentence at one", () => {
  expect(writtenNote(1)).toBe("1 statement written");
  expect(writtenNote(3)).toBe("3 statements written");
});
