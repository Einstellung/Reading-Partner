// Source list parsing (src/info/sources/source-store.ts, pure parts). The fs
// read/write paths need the Tauri plugin; only the pure helpers run here.
// Run: bun test.

import { expect, test } from "bun:test";
import { parseSources } from "../../src/info/sources/source-store";
import { BUILTIN_SOURCES } from "../../src/info/sources/builtins";

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
