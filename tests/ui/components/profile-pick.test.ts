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

// The shape the file on disk actually has: a title, then prose paragraphs
// hard-wrapped at about 80 characters with a blank line between them. A
// physical line is half a sentence, and half a sentence is not a claim about
// anybody.
const WRAPPED_PROFILE = [
  "# Reading profile",
  "",
  "I want hard technical substance: papers, methods, real results, concrete",
  "numbers. Summaries that stay at the level of what a field is about are of no",
  "use to me, and I would rather be sent the primary source than a write-up of",
  "it.",
  "",
  "When something is explained I want the derivation in full, not a diagram",
  "standing in for one. A term that turns up for the first time should be opened",
  "up on the spot rather than assumed.",
  "",
  "I read across fields and expect the connections to be drawn out: what a",
  "result here means for the argument somewhere else. Most of what I keep is the",
  "cross-field link rather than the result on its own.",
].join("\n");

test("hard-wrapped paragraphs are one entry each, and the title is not a prefix", () => {
  const lines = declaredLines(WRAPPED_PROFILE);
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe(
    "I want hard technical substance: papers, methods, real results, concrete " +
      "numbers. Summaries that stay at the level of what a field is about are of no " +
      "use to me, and I would rather be sent the primary source than a write-up of it.",
  );
  expect(lines[1]).toBe(
    "When something is explained I want the derivation in full, not a diagram " +
      "standing in for one. A term that turns up for the first time should be opened " +
      "up on the spot rather than assumed.",
  );
  expect(lines[2]).toBe(
    "I read across fields and expect the connections to be drawn out: what a " +
      "result here means for the argument somewhere else. Most of what I keep is the " +
      "cross-field link rather than the result on its own.",
  );
  expect(lines.some((l) => l.startsWith("Reading profile"))).toBe(false);
});

test("a paragraph is offered whole however long it is", () => {
  const long = "word ".repeat(120).trim();
  const wrapped = long.replace(/((?:\S+ ){12})/g, "$1\n");
  expect(declaredLines(wrapped)).toEqual([long]);
  expect(declaredLines(wrapped)[0].length).toBeGreaterThan(400);
});

// A word broken across the wrap is one word, so that join takes no space.
test("a line ending in a hyphen joins straight onto the next", () => {
  expect(declaredLines("keeps the cross-\nchannel link\n")).toEqual([
    "keeps the cross-channel link",
  ]);
});

test("a blank line is what separates two entries", () => {
  expect(declaredLines("Robotics and macro.\n\nAllergic to vendor PR.\n")).toEqual([
    "Robotics and macro.",
    "Allergic to vendor PR.",
  ]);
});

// The one place a single line is still a single entry.
test("a markdown list is one entry per item, continuations folded in", () => {
  const declared = [
    "## Interests",
    "",
    "- robotics",
    "- macro, especially the capital-flow side of it and where",
    "  that shows up in policy",
    "1. and numbered items too",
  ].join("\n");
  expect(declaredLines(declared)).toEqual([
    "robotics",
    "macro, especially the capital-flow side of it and where that shows up in policy",
    "and numbered items too",
  ]);
});

// Nothing is a heading any more except a "#" line, and that one is dropped
// rather than promoted onto what follows it.
test("a colon line and a bold line are entries, not labels for what follows", () => {
  expect(declaredLines("Interests:\n\n**Taste**\n\nplain text\n")).toEqual([
    "Interests:",
    "Taste",
    "plain text",
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
    declared: "Interests: robotics.\n\nTaste: allergic to vendor PR.\n",
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
    declared: "Interests: robotics.\n\nTaste: allergic to vendor PR.\n",
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
