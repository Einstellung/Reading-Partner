// Unit tests for the opening snapshot assembly (src/memory/snapshot.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import { buildMemorySnapshot, memoryPromptSection } from "../../src/memory/snapshot";
import type { MemoryIndexEntry, MemoryType } from "../../src/memory/types";

function e(type: MemoryType, summary: string, updated: string, id = "m-00000001"): MemoryIndexEntry {
  return { id, type, summary, updated };
}

test("snapshot orders sections position → stuck → understood and keeps newest first", () => {
  const snap = buildMemorySnapshot([
    e("understood-concept", "got residuals", "2026-07-10", "m-cccccccc"),
    e("stuck-point", "stuck on attention", "2026-07-12", "m-bbbbbbbb"),
    e("reading-position", "page 40 of the survey", "2026-07-15", "m-aaaaaaaa"),
    e("stuck-point", "stuck on layernorm", "2026-07-14", "m-dddddddd"),
  ]);
  const lines = snap.split("\n");
  expect(lines[0]).toContain("page 40");
  expect(lines[1]).toContain("layernorm"); // newer stuck-point first
  expect(lines[2]).toContain("attention");
  expect(lines[3]).toContain("residuals");
});

test("snapshot caps per type and overall", () => {
  const entries: MemoryIndexEntry[] = [];
  for (let i = 0; i < 10; i++) {
    entries.push(e("stuck-point", `stuck ${i}`, "2026-07-10", `m-0000000${i}`));
    entries.push(e("belief", `belief ${i}`, "2026-07-10", `m-1000000${i}`));
    entries.push(e("understood-concept", `got ${i}`, "2026-07-10", `m-2000000${i}`));
  }
  const lines = buildMemorySnapshot(entries).split("\n");
  expect(lines.filter((l) => l.includes("[stuck-point]"))).toHaveLength(4);
  expect(lines.length).toBeLessThanOrEqual(12);
});

test("empty entries yield an empty snapshot", () => {
  expect(buildMemorySnapshot([])).toBe("");
});

test("prompt section: snapshot text, recall discipline, and correction ownership", () => {
  const section = memoryPromptSection("- [stuck-point] x (updated 2026-07-17, id m-00000001)", true);
  expect(section).toContain("What you remember about this reader");
  expect(section).toContain("[stuck-point] x");
  expect(section).toContain("re-search with");
  expect(section).toContain("memory_update");
});

test("prompt section without tools carries only the snapshot; empty both is empty", () => {
  const s = memoryPromptSection("- line", false);
  expect(s).toContain("- line");
  expect(s).not.toContain("memory_search");
  expect(memoryPromptSection("", false)).toBe("");
});
