// Unit tests for the observation file formats (src/memory/observations/files.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  buildIndex,
  isoDate,
  localDate,
  oneLine,
  parseIndex,
  parseIndexLine,
  parseObservation,
  serializeIndexLine,
  serializeObservation,
} from "../../src/memory/observations/files";
import { mergeFile } from "../../src/platform/sync/merge";
import type { Observation } from "../../src/memory/observations/types";

const ENTRY: Observation = {
  id: "m-1a2b3c4d",
  type: "stuck-point",
  summary: "Stuck on why attention scales quadratically",
  body: "Asked twice why self-attention is O(n^2); the length-squared pairing didn't click.",
  created: "2026-07-17",
  updated: "2026-07-17",
  anchors: { annotationIds: ["ann-1", "ann-2"], messageIds: ["t1:100"] },
};

test("an observation file round-trips through serialize/parse", () => {
  const parsed = parseObservation(serializeObservation(ENTRY));
  expect(parsed).toEqual(ENTRY);
});

test("empty anchors are omitted from the frontmatter and parse back empty", () => {
  const entry = { ...ENTRY, anchors: { annotationIds: [], messageIds: [] } };
  const text = serializeObservation(entry);
  expect(text).not.toContain("annotations:");
  expect(text).not.toContain("messages:");
  expect(parseObservation(text)).toEqual(entry);
});

// docs/09: which book an observation is about, stamped at write time. Absent on
// every file written before it existed, and absent rather than "" so a reader
// asking "is this about the open book" has one thing to check.
test("the book id round-trips, and an older file without one parses as before", () => {
  const stamped = { ...ENTRY, bookId: "book-hash" };
  const text = serializeObservation(stamped);
  expect(text).toContain("book: book-hash");
  expect(parseObservation(text)).toEqual(stamped);

  expect(serializeObservation(ENTRY)).not.toContain("book:");
  expect(parseObservation(serializeObservation(ENTRY))?.bookId).toBeUndefined();
});

test("a multi-line summary is collapsed to one line on write", () => {
  const text = serializeObservation({ ...ENTRY, summary: "line one\nline  two" });
  expect(parseObservation(text)?.summary).toBe("line one line two");
});

// --- frontmatter keys this build has no field for ---

// The gate on every field this format may still grow. Two devices sync these
// files and neither can upgrade or detect the other; a build that drops a key
// it cannot name deletes it everywhere, and the prose merge cannot tell that
// from an ordinary edit.
test("unknown frontmatter keys round-trip byte-identically", () => {
  const text = [
    "---",
    "id: m-1a2b3c4d",
    "type: stuck-point",
    "created: 2026-07-17",
    "updated: 2026-07-17",
    "summary: Stuck on why attention scales quadratically",
    "layer: durable",
    "valid-until: 2027-01-01",
    "---",
    "",
    "Asked twice.",
    "",
  ].join("\n");
  const parsed = parseObservation(text);
  expect(parsed?.extra).toEqual([
    ["layer", "durable"],
    ["valid-until", "2027-01-01"],
  ]);
  expect(serializeObservation(parsed as Observation)).toBe(text);
});

// Sorted, not in file order: two devices holding the same pairs have to write
// the same bytes or each would rewrite the other's file on every pass.
test("unknown keys are written sorted, and a repeated key keeps its last value", () => {
  const parsed = parseObservation("---\nid: m-1\ntype: belief\nzeta: 2\nalpha: 1\nzeta: 3\n---\n\nb\n");
  expect(parsed?.extra).toEqual([
    ["zeta", "3"],
    ["alpha", "1"],
  ]);
  expect(serializeObservation(parsed as Observation)).toContain("alpha: 1\nzeta: 3\n---");
});

// The known field is the one the app acts on; a second line with the same key
// would win the reparse and replace it.
test("an unknown pair naming a known key is dropped rather than written twice", () => {
  const text = serializeObservation({
    ...ENTRY,
    extra: [
      ["summary", "the other one"],
      ["layer", "durable"],
    ],
  });
  expect(text.match(/^summary: /gm)).toHaveLength(1);
  expect(parseObservation(text)?.summary).toBe(ENTRY.summary);
  expect(parseObservation(text)?.extra).toEqual([["layer", "durable"]]);
});

// An empty known field is omitted because it reparses to "" either way; an
// omitted unknown key is gone.
test("an unknown key with no value keeps its key", () => {
  const text = "---\nid: m-1\ntype: belief\nlayer:\n---\n\nb\n";
  expect(parseObservation(text)?.extra).toEqual([["layer", ""]]);
  expect(serializeObservation(parseObservation(text) as Observation)).toBe(text);
});

test("a file with only known keys carries no extra", () => {
  expect(parseObservation(serializeObservation(ENTRY))?.extra).toBeUndefined();
});

// What the shape rests on, checked against the merge that actually runs rather
// than against a description of it: an unknown key is an ordinary frontmatter
// line in a fixed place, so a device that rewrote something else leaves it
// byte-identical to base and chunk3 puts it in a stable chunk.
test("unknown keys survive the merge two devices run on these files", () => {
  const base = serializeObservation({ ...ENTRY, extra: [["layer", "durable"]] });
  const read = () => parseObservation(base) as Observation;
  // One device rewrites the body, the other the summary. Neither knows `layer`.
  const local = serializeObservation({ ...read(), body: "Asked a third time." });
  const remote = serializeObservation({ ...read(), summary: "Still stuck on the quadratic cost" });

  const bytes = (t: string) => new TextEncoder().encode(t);
  const merged = mergeFile({
    path: "memory-topic-1/m-1a2b3c4d.md",
    base: bytes(base),
    local: bytes(local),
    remote: bytes(remote),
  });

  expect(merged.contested).toBe(false);
  expect(merged.copies).toEqual([]);
  const entry = parseObservation(new TextDecoder().decode(merged.merged));
  expect(entry?.extra).toEqual([["layer", "durable"]]);
  expect(entry?.body).toBe("Asked a third time.");
  expect(entry?.summary).toBe("Still stuck on the quadratic cost");
});

test("malformed file or unknown type parses as null", () => {
  expect(parseObservation("no frontmatter here")).toBeNull();
  expect(parseObservation("---\nid: m-1\ntype: nonsense\n---\nbody")).toBeNull();
});

test("index line round-trips, including a summary with brackets and colons", () => {
  const e = {
    id: "m-1a2b3c4d",
    type: "belief" as const,
    summary: "Thinks [CLS] pooling: overrated (see 3.2)",
    updated: "2026-07-17",
  };
  expect(parseIndexLine(serializeIndexLine(e))).toEqual(e);
});

test("buildIndex sorts newest-updated first and parseIndex skips junk lines", () => {
  const text = buildIndex([
    { id: "m-aaaaaaaa", type: "belief", summary: "old", updated: "2026-07-01" },
    { id: "m-bbbbbbbb", type: "stuck-point", summary: "new", updated: "2026-07-17" },
  ]);
  const entries = parseIndex(text + "junk line\n");
  expect(entries.map((e) => e.id)).toEqual(["m-bbbbbbbb", "m-aaaaaaaa"]);
});

test("isoDate and oneLine", () => {
  expect(isoDate(new Date("2026-07-17T23:59:00Z").getTime())).toBe("2026-07-17");
  expect(oneLine("  a\n b\tc ")).toBe("a b c");
});

test("localDate reads the device's own clock, not UTC", () => {
  // Whatever zone the test machine is in, the local date is the one the reader
  // would name — which is what an observation about a conversation is dated by.
  const at = new Date(2026, 6, 17, 0, 30, 0);
  expect(localDate(at.getTime())).toBe("2026-07-17");
  expect(localDate(new Date(2026, 0, 5, 23, 59, 59).getTime())).toBe("2026-01-05");
});
