// Unit tests for the memory file formats (src/memory/files.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  buildIndex,
  isoDate,
  oneLine,
  parseIndex,
  parseIndexLine,
  parseMemory,
  serializeIndexLine,
  serializeMemory,
} from "../../src/memory/files";
import type { MemoryEntry } from "../../src/memory/types";

const ENTRY: MemoryEntry = {
  id: "m-1a2b3c4d",
  type: "stuck-point",
  summary: "Stuck on why attention scales quadratically",
  body: "Asked twice why self-attention is O(n^2); the length-squared pairing didn't click.",
  created: "2026-07-17",
  updated: "2026-07-17",
  anchors: { annotationIds: ["ann-1", "ann-2"], messageIds: ["t1:100"] },
};

test("memory file round-trips through serialize/parse", () => {
  const parsed = parseMemory(serializeMemory(ENTRY));
  expect(parsed).toEqual(ENTRY);
});

test("empty anchors are omitted from the frontmatter and parse back empty", () => {
  const entry = { ...ENTRY, anchors: { annotationIds: [], messageIds: [] } };
  const text = serializeMemory(entry);
  expect(text).not.toContain("annotations:");
  expect(text).not.toContain("messages:");
  expect(parseMemory(text)).toEqual(entry);
});

test("a multi-line summary is collapsed to one line on write", () => {
  const text = serializeMemory({ ...ENTRY, summary: "line one\nline  two" });
  expect(parseMemory(text)?.summary).toBe("line one line two");
});

test("malformed file or unknown type parses as null", () => {
  expect(parseMemory("no frontmatter here")).toBeNull();
  expect(parseMemory("---\nid: m-1\ntype: nonsense\n---\nbody")).toBeNull();
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
