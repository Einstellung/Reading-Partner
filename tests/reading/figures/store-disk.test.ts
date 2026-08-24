// The figure-index cache on disk (src/reading/figures/store.ts) against an
// in-memory AppData and a stub pdf.js. store.test.ts covers the pure version
// gate; this file is for what ends up in the file.
//
// Both cases here are the same shape: an empty index that says nothing about
// where it came from.
//
//   pdf.js failing to open a document wrote the same empty index a document
//   with no figures writes, and it was consulted forever after — the figure
//   catalog stayed empty and view_figure was never offered to the AI for that
//   book again (tools.ts).
//
//   A cache file that could not be read looked exactly like one that was not
//   there, so the re-extraction wrote its result over bytes nobody had read.
//
// Run: bun test.

import { beforeEach, expect, spyOn, test } from "bun:test";
import * as extract from "../../../src/fulltext/extract";
import {
  FIGURES_RETRY_AFTER_MS,
  createFiguresStore,
  ensureFigures,
  getFigures,
  type FiguresIo,
} from "../../../src/reading/figures/store";
import { FIGURES_VERSION } from "../../../src/reading/figures/types";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

// A document with one blank page: enough for the extractor to walk and come back
// with an honest, empty, "ok" index. `opens` is the switch the failure cases
// throw — a corrupt or encrypted file, or pdf.js itself failing to load.
let opens = true;
let openCalls = 0;
const stubPdfjs = {
  OPS: {},
  getDocument: () => {
    openCalls++;
    if (!opens) return { promise: Promise.reject(new Error("bad pdf")) };
    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 600, height: 800 }),
          getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
          getTextContent: async () => ({ items: [] }),
        }),
        destroy: async () => {},
      }),
    };
  },
};

const KEY = "deadbeef";
const FILE = `figures-${KEY}.json`;
const BYTES = new ArrayBuffer(8);
const T0 = 1_700_000_000_000;

// A real index, extracted back when the document opened.
const GOOD = JSON.stringify({
  version: FIGURES_VERSION,
  status: "ok",
  figures: [{ id: "3", page: 2, caption: "Figure 3: ganglion density", bbox: null }],
});

beforeEach(() => {
  disk = installAppData();
  opens = true;
  openCalls = 0;
  // loadPdfjs is the one export in that module that needs a browser; a spy on
  // it leaves the rest of the extractor real, and the preload puts it back
  // between cases (docs/pitfall/122).
  spyOn(extract, "loadPdfjs").mockImplementation(
    (async () => stubPdfjs) as unknown as typeof extract.loadPdfjs,
  );
});

test("a document that opens is indexed and cached as an answer about the document", async () => {
  const index = await ensureFigures(KEY, BYTES, () => T0);
  expect(index.status).toBe("ok");
  expect(JSON.parse(disk.files.get(FILE) ?? "null")).toEqual({
    version: FIGURES_VERSION,
    status: "ok",
    figures: [],
  });

  // Cached: the second open does not go near pdf.js.
  openCalls = 0;
  expect((await ensureFigures(KEY, BYTES, () => T0)).status).toBe("ok");
  expect(openCalls).toBe(0);
});

// An extraction that failed is not a document without figures. It is written
// down so the next open does not repeat it, and it expires so one bad day does
// not file the book as pictureless for good.
test("a failed extraction is recorded as a failure and tried again a day later", async () => {
  opens = false;
  const index = await ensureFigures(KEY, BYTES, () => T0);
  expect(index).toEqual({ version: FIGURES_VERSION, status: "failed", figures: [], failedAt: T0 });
  expect(JSON.parse(disk.files.get(FILE) ?? "null").status).toBe("failed");

  // Within the day it stands, so every open of the book does not re-run a
  // failing extraction.
  openCalls = 0;
  await ensureFigures(KEY, BYTES, () => T0 + FIGURES_RETRY_AFTER_MS - 1);
  expect(openCalls).toBe(0);

  // After it, the document is read again — and this time it opens.
  opens = true;
  const retried = await ensureFigures(KEY, BYTES, () => T0 + FIGURES_RETRY_AFTER_MS);
  expect(openCalls).toBe(1);
  expect(retried.status).toBe("ok");
  expect(JSON.parse(disk.files.get(FILE) ?? "null")).toEqual({
    version: FIGURES_VERSION,
    status: "ok",
    figures: [],
  });
});

test("a stale failure reads as a miss, so nothing serves it as the book's figures", async () => {
  disk.files.set(
    FILE,
    JSON.stringify({ version: FIGURES_VERSION, status: "failed", figures: [], failedAt: T0 }),
  );
  expect(await getFigures(KEY, T0 + 1)).toMatchObject({ status: "failed" });
  expect(await getFigures(KEY, T0 + FIGURES_RETRY_AFTER_MS)).toBeNull();
});

// The one that costs a real index. A cache file that will not open is not a
// cache file that is not there: nothing is known to be wrong with those bytes,
// so the extraction that runs instead must not land on top of them.
test("a cache that could not be read is not overwritten by the extraction that replaced it", async () => {
  disk.files.set(FILE, GOOD);
  disk.unreadable.add(FILE);

  // The extraction fails as well — the pairing that used to file a good index
  // as an empty one.
  opens = false;
  expect((await ensureFigures(KEY, BYTES, () => T0)).status).toBe("failed");
  expect(disk.files.get(FILE)).toBe(GOOD);

  // And it does not land when the extraction succeeds either: a fresh index is
  // still a guess about a file this run never read.
  opens = true;
  expect((await ensureFigures(KEY, BYTES, () => T0)).status).toBe("ok");
  expect(disk.files.get(FILE)).toBe(GOOD);

  // The next launch reads the file, and the figures are all still there.
  disk.unreadable.clear();
  const back = await getFigures(KEY, T0);
  expect(back?.figures.map((f) => f.id)).toEqual(["3"]);
});

// Deliberately the other way round: an index is derived from the PDF, so bytes
// that will not parse cost one extraction and nothing else. No quarantine file,
// no sentence shown to the reader — that is for data nothing can rebuild
// (platform/app/atomic-fs.ts readGuardedJson).
test("cache bytes that will not parse are replaced by a fresh extraction", async () => {
  disk.files.set(FILE, "{ half an ind");
  expect((await ensureFigures(KEY, BYTES, () => T0)).status).toBe("ok");
  expect(JSON.parse(disk.files.get(FILE) ?? "null").status).toBe("ok");
  expect([...disk.files.keys()]).toEqual([FILE]);
});

// --- the map of jobs belongs to a store, not to the module ------------------

// It was a module-level Map, and an entry only comes out in the `finally` of the
// call that put it in. A fire-and-forget ensureFigures whose job never settles —
// the shape open-book calls it in — leaves the key behind, and the next caller
// asking for that key, in whatever file, is handed a promise nothing is going to
// settle. Two stores over one disk is the smallest way to show it: everything
// else about them is shared, so only the map can couple them.

// A store over `files` whose pdf.js can be made to wait to be let go.
function storeOver(files: Map<string, string>, hold: boolean) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opens = 0;
  const io: FiguresIo = {
    read: async (file) => files.get(file) ?? null,
    write: async (file, contents) => {
      files.set(file, contents);
    },
    loadPdfjs: async () => {
      opens++;
      if (hold) await held;
      return stubPdfjs;
    },
    onError: () => {},
  };
  return { store: createFiguresStore(io), release, opens: () => opens };
}

test("a second store does not join the first store's in-flight extraction", async () => {
  const files = new Map<string, string>();
  const first = storeOver(files, true);
  const second = storeOver(files, false);

  const stuck = first.store.ensure(KEY, BYTES, () => T0);
  while (first.opens() === 0) await null;

  const landed = await Promise.race([
    second.store.ensure(KEY, BYTES, () => T0).then((index) => index.status),
    Bun.sleep(100).then(() => "still waiting on the other store's job"),
  ]);
  expect(landed).toBe("ok");
  expect(second.opens()).toBe(1);

  first.release();
  await stuck;
});
