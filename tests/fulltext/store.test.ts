// The full-text cache's coalescing (src/fulltext/store.ts): a double open of the
// same document parses once, and the map that arranges it belongs to a store.
//
// It was a module-level Map, so every test file sharing the worker shared one.
// An entry only comes out in the `finally` of the call that put it in, so a
// fire-and-forget ensureFulltext whose job never settles — the shape open-book
// calls it in — leaves the key behind. The next caller asking for that key, in
// whatever file, is handed a promise nothing is going to settle.
//
// Nothing here touches disk: the store's whole outside world is passed in.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  createFulltextStore,
  type FulltextIo,
  type FulltextStore,
} from "../../src/fulltext/store";
import { FULLTEXT_VERSION, type Fulltext } from "../../src/fulltext/types";

const KEY = "deadbeef";
const BYTES = new ArrayBuffer(8);

interface Rig {
  store: FulltextStore;
  /** Let the extraction this store is holding open finish. Free when unheld. */
  release: () => void;
  /** How many times this store's extractor has been asked to run. */
  extractions: () => number;
}

// A store over `files`, whose extractor answers with `page`. `hold` makes the
// extraction wait to be let go, so a job can be left in flight.
function makeStore(page: string, files: Map<string, string>, hold = false): Rig {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let extractions = 0;
  const io: FulltextIo = {
    read: async (file) => files.get(file) ?? null,
    write: async (file, contents) => {
      files.set(file, contents);
    },
    extract: async () => {
      extractions++;
      if (hold) await held;
      return { status: "ok", pages: [page], outline: [] };
    },
    onError: () => {},
  };
  return { store: createFulltextStore(io), release, extractions: () => extractions };
}

// The feature the map is there for, so the test below is about where the map
// lives rather than about whether it exists at all.
test("two opens of one document inside a store parse once", async () => {
  const rig = makeStore("the only parse", new Map(), true);

  const a = rig.store.ensure(KEY, BYTES);
  const b = rig.store.ensure(KEY, BYTES);
  while (rig.extractions() === 0) await null;
  rig.release();

  expect((await a).pages).toEqual(["the only parse"]);
  expect((await b).pages).toEqual(["the only parse"]);
  expect(rig.extractions()).toBe(1);
});

test("a second store does not join the first store's in-flight extraction", async () => {
  // One shared disk, so the only thing that could couple the two stores is the
  // map of jobs.
  const files = new Map<string, string>();
  const first = makeStore("from the first store", files, true);
  const second = makeStore("from the second store", files);

  // Left in flight, the way open-book calls it: started and not awaited.
  const stuck = first.store.ensure(KEY, BYTES);
  while (first.extractions() === 0) await null;

  const landed = await Promise.race([
    second.store.ensure(KEY, BYTES).then((ft) => ft.pages[0]),
    Bun.sleep(100).then(() => "still waiting on the other store's job"),
  ]);
  expect(landed).toBe("from the second store");
  expect(second.extractions()).toBe(1);

  first.release();
  await stuck;
});

test("a cache of the current version is served without extracting", async () => {
  const files = new Map<string, string>();
  const cached: Fulltext = {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: ["already on disk"],
    outline: [],
  };
  files.set(`fulltext-${KEY}.json`, JSON.stringify(cached));
  const rig = makeStore("never reached", files);

  expect((await rig.store.ensure(KEY, BYTES)).pages).toEqual(["already on disk"]);
  expect(rig.extractions()).toBe(0);
});
