// Unit tests for the one-off date repair (scripts/observation-dates.ts): what an
// entry's anchors say the date was, and whether the date in its prose can be
// swapped for that without damaging the sentence. Run: bun test.
//
// Timestamps here are built from local calendar fields rather than a fixed
// epoch, so the expectations hold in whatever zone the suite runs in — the
// script dates evidence on the reader's own clock, and a test that hardcoded
// UTC+8 would only be testing this machine.

import { expect, test } from "bun:test";
import {
  anchorDates,
  dateLiterals,
  occurrences,
  planEntry,
  replaceDateLiteral,
  rewriteEntryFile,
  rewriteIndexLine,
  type EntryFacts,
} from "../scripts/observation-dates";

function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m - 1, d, h, 30).getTime();
}

const AUG_2 = at(2026, 8, 2);
const AUG_4 = at(2026, 8, 4);

// --- the anchors ---

test("one anchor is one day", () => {
  expect(anchorDates([`thread-1:${AUG_2}`])).toEqual({ first: "2026-08-02", last: "2026-08-02" });
});

test("several anchors give the span they cover, in order or not", () => {
  const ids = [`t:${AUG_4}`, `t:${AUG_2}`, `t:${at(2026, 8, 3)}`];
  expect(anchorDates(ids)).toEqual({ first: "2026-08-02", last: "2026-08-04" });
});

test("a thread id with colons in it still yields its timestamp", () => {
  expect(anchorDates([`a:b:c:${AUG_2}`])).toEqual({ first: "2026-08-02", last: "2026-08-02" });
});

test("anchors that carry no usable stamp are dropped, not formatted into 1970", () => {
  expect(anchorDates([])).toBeNull();
  expect(anchorDates(["thread-1"])).toBeNull();
  expect(anchorDates(["thread-1:", "thread-2:0", "thread-3:nope", "thread-4:-5"])).toBeNull();
  // One good stamp among the junk is still an answer.
  expect(anchorDates(["thread-1:0", `thread-2:${AUG_2}`])).toEqual({
    first: "2026-08-02",
    last: "2026-08-02",
  });
});

test("late-evening reading is dated by the reader's clock, not UTC", () => {
  // 23:30 local is the next UTC day at any positive offset and the previous one
  // at any negative offset; either way the answer is the day the reader read.
  const ts = new Date(2026, 7, 2, 23, 30).getTime();
  expect(anchorDates([`t:${ts}`])).toEqual({ first: "2026-08-02", last: "2026-08-02" });
});

// --- what may be replaced ---

test("dates in prose are collected once each", () => {
  expect(dateLiterals("2026-08-12: on 2026-08-12 they asked about 2026-07-30")).toEqual([
    "2026-08-12",
    "2026-07-30",
  ]);
  expect(dateLiterals("no dates here")).toEqual([]);
});

test("a date between punctuation, CJK or nothing at all is a whole token", () => {
  for (const text of [
    "2026-08-12",
    "On 2026-08-12 the reader asked",
    "2026-08-12: after §III-C",
    "2026-08-12，读者提出",
    "（2026-08-12）",
    "asked on 2026-08-12.",
  ]) {
    expect(occurrences(text, "2026-08-12").every((h) => h.safe)).toBe(true);
  }
});

test("a date inside a compound is not a whole token", () => {
  expect(occurrences("2026-08-12/13 they swung to", "2026-08-12")[0].safe).toBe(false);
  expect(occurrences("2026-07-19/20", "2026-07-19")[0].safe).toBe(false);
  expect(occurrences("v2026-08-12", "2026-08-12")[0].safe).toBe(false);
  expect(occurrences("2026-08-12-b", "2026-08-12")[0].safe).toBe(false);
});

test("replacing is all occurrences or none of them", () => {
  expect(replaceDateLiteral("on 2026-08-12; again 2026-08-12.", "2026-08-12", "2026-08-02")).toEqual({
    text: "on 2026-08-02; again 2026-08-02.",
    count: 2,
  });
  // Nothing to do is not a failure.
  expect(replaceDateLiteral("no date", "2026-08-12", "2026-08-02")).toEqual({
    text: "no date",
    count: 0,
  });
  // One unsafe occurrence disqualifies the safe ones with it.
  expect(
    replaceDateLiteral("on 2026-08-12, and 2026-08-12/13", "2026-08-12", "2026-08-02"),
  ).toBeNull();
});

// --- the decision ---

function facts(over: Partial<EntryFacts> = {}): EntryFacts {
  return {
    id: "m-1a2b3c4d",
    created: "2026-08-12",
    updated: "2026-08-12",
    summary: "2026-08-12: reader restated latent space in their own words",
    body: "On 2026-08-12 they asked three questions.",
    messageIds: [`t:${AUG_2}`],
    ...over,
  };
}

test("the pass date, contradicted by a one-day anchor, is one substitution", () => {
  const plan = planEntry(facts());
  expect(plan).toMatchObject({ kind: "fix", mismatch: true, from: "2026-08-12", to: "2026-08-02" });
});

test("an entry whose pass date the anchors agree with is left alone", () => {
  const plan = planEntry(facts({ created: "2026-08-02", updated: "2026-08-02" }));
  expect(plan).toMatchObject({ kind: "agrees", mismatch: false });
});

test("a pass date inside the anchor span is not a contradiction", () => {
  const plan = planEntry(
    facts({
      created: "2026-08-03",
      updated: "2026-08-03",
      summary: "on 2026-08-03 the reader asked",
      body: "",
      messageIds: [`t:${AUG_2}`, `t:${AUG_4}`],
    }),
  );
  expect(plan).toMatchObject({ kind: "agrees" });
});

test("a date the conversation itself named is never touched", () => {
  // The only literal is neither `created` nor `updated`, so it is something the
  // reader or the material said, not the day the pass ran.
  const plan = planEntry(
    facts({ summary: "the survey's cutoff was 2025-09-30", body: "no other date" }),
  );
  expect(plan).toMatchObject({ kind: "agrees", mismatch: false });
});

test("no anchor carrying a timestamp means no comparison to make", () => {
  const plan = planEntry(facts({ messageIds: [] }));
  expect(plan).toMatchObject({ kind: "no-anchor", mismatch: false });
});

test("two passes wrote it, so its prose dates cannot be told apart", () => {
  const plan = planEntry(facts({ updated: "2026-08-14", body: "and again on 2026-08-14." }));
  expect(plan.kind).toBe("manual");
  expect(plan.mismatch).toBe(true);
});

test("an anchor span of several days does not say which day a sentence means", () => {
  const plan = planEntry(facts({ messageIds: [`t:${AUG_2}`, `t:${AUG_4}`] }));
  expect(plan).toMatchObject({ kind: "manual", mismatch: true });
  expect((plan as { reason: string }).reason).toContain("2026-08-02 to 2026-08-04");
});

test("a compound date disqualifies the entry rather than being half-rewritten", () => {
  const plan = planEntry(facts({ body: "on 2026-08-12/13 they swung the other way." }));
  expect(plan).toMatchObject({ kind: "manual", mismatch: true });
});

// --- the rewrite ---

const FILE = `---
id: m-1a2b3c4d
type: stuck-point
created: 2026-08-12
updated: 2026-08-12
summary: 2026-08-12: three §III-C stuck points
messages: t:1
---

2026-08-12: after §III-C the reader flagged three things.

Resolved the same 2026-08-12 session.
`;

test("the rewrite touches the summary and the body, and no other frontmatter", () => {
  const out = rewriteEntryFile(FILE, "2026-08-12", "2026-08-02")!;
  expect(out).toContain("created: 2026-08-12");
  expect(out).toContain("updated: 2026-08-12");
  expect(out).toContain("summary: 2026-08-02: three §III-C stuck points");
  expect(out).toContain("2026-08-02: after §III-C");
  expect(out).toContain("Resolved the same 2026-08-02 session.");
  expect(out).not.toContain("summary: 2026-08-12");
  // Byte for byte the same file apart from the three dates.
  expect(out.split("2026-08-02")).toHaveLength(4);
});

test("a file with no frontmatter is not rewritten", () => {
  expect(rewriteEntryFile("just prose about 2026-08-12", "2026-08-12", "2026-08-02")).toBeNull();
});

test("an unsafe occurrence stops the whole file", () => {
  const text = FILE.replace("Resolved the same 2026-08-12", "Resolved the same 2026-08-12/13");
  expect(rewriteEntryFile(text, "2026-08-12", "2026-08-02")).toBeNull();
});

test("the index line is re-serialized from the new summary, stamp untouched", () => {
  const index =
    "- [belief] something else (updated 2026-08-12, id m-99999999)\n" +
    "- [stuck-point] 2026-08-12: three §III-C stuck points (updated 2026-08-12, id m-1a2b3c4d)\n";
  const out = rewriteIndexLine(index, "m-1a2b3c4d", "2026-08-02: three §III-C stuck points")!;
  expect(out).toContain(
    "- [stuck-point] 2026-08-02: three §III-C stuck points (updated 2026-08-12, id m-1a2b3c4d)",
  );
  expect(out).toContain("- [belief] something else (updated 2026-08-12, id m-99999999)");
});

test("an index with no line for the entry says so instead of guessing", () => {
  expect(rewriteIndexLine("- [belief] x (updated 2026-08-12, id m-99999999)\n", "m-1a2b3c4d", "y")).toBeNull();
});
