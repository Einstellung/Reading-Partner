// Unit tests for the opening snapshot assembly (src/observation/snapshot.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  buildObservationSnapshot,
  observationPromptSection,
  trimObservations,
} from "../../src/observation/snapshot";
import type { ObservationIndexEntry, ObservationType } from "../../src/observation/types";

function e(type: ObservationType, summary: string, updated: string, id = "m-00000001"): ObservationIndexEntry {
  return { id, type, summary, updated };
}

test("snapshot orders sections position → stuck → understood and keeps newest first", () => {
  const snap = buildObservationSnapshot([
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
  const entries: ObservationIndexEntry[] = [];
  for (let i = 0; i < 10; i++) {
    entries.push(e("stuck-point", `stuck ${i}`, "2026-07-10", `m-0000000${i}`));
    entries.push(e("belief", `belief ${i}`, "2026-07-10", `m-1000000${i}`));
    entries.push(e("understood-concept", `got ${i}`, "2026-07-10", `m-2000000${i}`));
  }
  const lines = buildObservationSnapshot(entries).split("\n");
  expect(lines.filter((l) => l.includes("[stuck-point]"))).toHaveLength(4);
  expect(lines.length).toBeLessThanOrEqual(12);
});

test("empty entries yield an empty snapshot", () => {
  expect(buildObservationSnapshot([])).toBe("");
});

// The rehearsal asks its first question about whatever the reader got stuck on,
// so a trim by recency alone can take away the line that rule runs on: the two
// beliefs below are newer than every stuck-point.
test("a trim keeps the types the caller leads with, newest first inside a type", () => {
  const entries = [
    e("belief", "free will", "2026-07-20", "m-b1"),
    e("belief", "rl background", "2026-07-19", "m-b2"),
    e("stuck-point", "active inference", "2026-07-10", "m-s1"),
    e("stuck-point", "predictive coding", "2026-07-12", "m-s2"),
    e("reading-position", "p.204", "2026-07-21", "m-r1"),
  ];
  const kept = trimObservations(entries, 3, ["stuck-point", "belief"]);
  expect(kept.map((k) => k.id)).toEqual(["m-s2", "m-s1", "m-b1"]);
});

// An order that names only some types is a preference, not a filter: a topic
// with nothing of the named types still gets a snapshot.
test("a trim falls through to the unnamed types and stops at the limit", () => {
  const entries = [
    e("reading-position", "p.204", "2026-07-21", "m-r1"),
    e("correction", "not Hebbian", "2026-07-18", "m-c1"),
  ];
  expect(trimObservations(entries, 3, ["stuck-point"]).map((k) => k.id)).toEqual(["m-r1", "m-c1"]);
  expect(trimObservations(entries, 1, ["stuck-point"]).map((k) => k.id)).toEqual(["m-r1"]);
  expect(trimObservations([], 3)).toEqual([]);
});

test("prompt section: snapshot text, recall discipline, and correction ownership", () => {
  const section = observationPromptSection("- [stuck-point] x (updated 2026-07-17, id m-00000001)", true);
  expect(section).toContain("Your observations of this reader");
  expect(section).toContain("[stuck-point] x");
  expect(section).toContain("re-search with");
  expect(section).toContain("observation_update");
});

test("prompt section without tools carries only the snapshot; empty both is empty", () => {
  const s = observationPromptSection("- line", false);
  expect(s).toContain("- line");
  expect(s).not.toContain("observation_search");
  expect(observationPromptSection("", false)).toBe("");
});
