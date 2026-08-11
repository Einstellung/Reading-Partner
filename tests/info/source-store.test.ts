// Source list parse + migration policy (src/info/sources/source-store.ts, pure parts).
// The fs read/write paths need the Tauri plugin; only the pure helpers run here.
// Run: bun test.

import { expect, test } from "bun:test";
import { migratedSources, parseSources } from "../../src/info/sources/source-store";
import { BUILTIN_SOURCES } from "../../src/info/sources/builtins";

test("migratedSources: an existing user gets the source they were reading, enabled", () => {
  const list = migratedSources(true);
  // qbitai was the other half of this until it stopped being a builtin. The
  // migration can only write descriptors the table still has, which is the
  // point: it hands over a source that still exists, never an empty shell.
  expect(list.map((s) => s.id)).toEqual(["jiqizhixin"]);
  expect(list.every((s) => s.enabled)).toBe(true);
  expect(list.every((s) => s.builtin)).toBe(true);
});

test("migratedSources: new user starts with zero sources", () => {
  expect(migratedSources(false)).toEqual([]);
});

test("parseSources validates each entry and drops malformed ones", () => {
  const text = JSON.stringify([
    BUILTIN_SOURCES[0], // valid
    { id: "broken" }, // missing everything else
    { ...BUILTIN_SOURCES[1], enabled: true },
  ]);
  const list = parseSources(text);
  expect(list.length).toBe(2);
  expect(list.map((s) => s.id)).toEqual([BUILTIN_SOURCES[0].id, BUILTIN_SOURCES[1].id]);
});

test("parseSources tolerates garbage", () => {
  expect(parseSources("not json")).toEqual([]);
  expect(parseSources("{}")).toEqual([]);
  expect(parseSources("[]")).toEqual([]);
});

test("every builtin descriptor is structurally valid", () => {
  // parseSources runs validateDescriptor on each; all builtins must survive.
  const round = parseSources(JSON.stringify(BUILTIN_SOURCES));
  expect(round.length).toBe(BUILTIN_SOURCES.length);
});
