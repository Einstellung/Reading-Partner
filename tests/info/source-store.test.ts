// Source list parse + migration policy (src/info/source-store.ts, pure parts).
// The fs read/write paths need the Tauri plugin; only the pure helpers run here.
// Run: bun test.

import { expect, test } from "bun:test";
import { migratedSources, parseSources } from "../../src/info/sources/source-store";
import { BUILTIN_SOURCES } from "../../src/info/sources/builtins";

test("migratedSources: existing user gets the two original builtins, enabled", () => {
  const list = migratedSources(true);
  expect(list.map((s) => s.id).sort()).toEqual(["jiqizhixin", "qbitai"]);
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
  expect(list.map((s) => s.id)).toEqual(["jiqizhixin", "qbitai"]);
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
