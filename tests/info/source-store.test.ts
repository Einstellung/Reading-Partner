// Source list parsing (src/info/sources/source-store.ts, pure parts). The fs
// read/write paths need the Tauri plugin; only the pure helpers run here.
// Run: bun test.

import { expect, test } from "bun:test";
import { parseSources } from "../../src/info/sources/source-store";
import { BUILTIN_SOURCES } from "../../src/info/sources/builtins";

test("parseSources sorts entries into what this build understands and what it does not", () => {
  const parsed = parseSources([
    BUILTIN_SOURCES[0],
    // An id and nothing else this build recognises: a descriptor a newer build
    // on another device wrote reads like this. It is still the reader's
    // subscription and it still has the id the sync merge keys on, so it is
    // carried, not dropped.
    { id: "from-the-future", kind: "something-new" },
    { ...BUILTIN_SOURCES[1], enabled: true },
  ]);
  expect(parsed?.sources.map((s) => s.id)).toEqual([BUILTIN_SOURCES[0].id, BUILTIN_SOURCES[1].id]);
  expect(parsed?.foreign).toEqual([{ id: "from-the-future", kind: "something-new" }]);
  expect(parsed?.repaired).toBe(false);
});

test("parseSources reports the entries it cannot carry", () => {
  // No id, and a second entry under an id already taken: the sync merge turns
  // down a whole file holding either, so neither can be written back.
  const parsed = parseSources([BUILTIN_SOURCES[0], { name: "no id" }, BUILTIN_SOURCES[0], null]);
  expect(parsed?.sources.map((s) => s.id)).toEqual([BUILTIN_SOURCES[0].id]);
  expect(parsed?.repaired).toBe(true);
});

test("parseSources turns down anything that is not a list of entries", () => {
  expect(parseSources({})).toBeNull();
  expect(parseSources("not a list")).toBeNull();
  expect(parseSources([])).toEqual({ sources: [], foreign: [], repaired: false });
});

test("every builtin descriptor is structurally valid", () => {
  // parseSources runs validateDescriptor on each; all builtins must survive.
  const round = parseSources(JSON.parse(JSON.stringify(BUILTIN_SOURCES)) as unknown);
  expect(round?.sources.length).toBe(BUILTIN_SOURCES.length);
  expect(round?.foreign).toEqual([]);
});
