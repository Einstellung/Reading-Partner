// The figure-index cache on disk (src/reading/figures/store.ts) against an
// in-memory AppData and a stub pdf.js. store.test.ts covers the pure version
// gate; this file is for what ends up in the file, and the mocked filesystem has
// to be installed before the module is imported.
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

import { beforeEach, expect, mock, test } from "bun:test";
import { FIGURES_VERSION } from "../../../src/reading/figures/types";
import { makeAppData } from "../../support/appdata";

const app = makeAppData();
const { files, unreadable } = app;
mock.module("@tauri-apps/plugin-fs", () => app.pluginFs);
mock.module("@tauri-apps/api/core", () => app.core);
mock.module("../../../src/platform/app/atomic-fs", () => app.atomicFs);

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

// Everything else in the module is kept: mock.module replaces it for the whole
// run, and loadPdfjs is the only export that needs a browser.
const realFulltextExtract = await import("../../../src/fulltext/extract");
mock.module("../../../src/fulltext/extract", () => ({
  ...realFulltextExtract,
  loadPdfjs: async () => stubPdfjs,
}));

const { ensureFigures, getFigures, FIGURES_RETRY_AFTER_MS } = await import(
  "../../../src/reading/figures/store"
);

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
  app.reset();
  opens = true;
  openCalls = 0;
});

test("a document that opens is indexed and cached as an answer about the document", async () => {
  const index = await ensureFigures(KEY, BYTES, () => T0);
  expect(index.status).toBe("ok");
  expect(JSON.parse(files.get(FILE) ?? "null")).toEqual({
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
  expect(JSON.parse(files.get(FILE) ?? "null").status).toBe("failed");

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
  expect(JSON.parse(files.get(FILE) ?? "null")).toEqual({
    version: FIGURES_VERSION,
    status: "ok",
    figures: [],
  });
});

test("a stale failure reads as a miss, so nothing serves it as the book's figures", async () => {
  files.set(
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
  files.set(FILE, GOOD);
  unreadable.add(FILE);

  // The extraction fails as well — the pairing that used to file a good index
  // as an empty one.
  opens = false;
  expect((await ensureFigures(KEY, BYTES, () => T0)).status).toBe("failed");
  expect(files.get(FILE)).toBe(GOOD);

  // And it does not land when the extraction succeeds either: a fresh index is
  // still a guess about a file this run never read.
  opens = true;
  expect((await ensureFigures(KEY, BYTES, () => T0)).status).toBe("ok");
  expect(files.get(FILE)).toBe(GOOD);

  // The next launch reads the file, and the figures are all still there.
  unreadable.clear();
  const back = await getFigures(KEY, T0);
  expect(back?.figures.map((f) => f.id)).toEqual(["3"]);
});

// Deliberately the other way round: an index is derived from the PDF, so bytes
// that will not parse cost one extraction and nothing else. No quarantine file,
// no sentence shown to the reader — that is for data nothing can rebuild
// (platform/app/atomic-fs.ts readGuardedJson).
test("cache bytes that will not parse are replaced by a fresh extraction", async () => {
  files.set(FILE, "{ half an ind");
  expect((await ensureFigures(KEY, BYTES, () => T0)).status).toBe("ok");
  expect(JSON.parse(files.get(FILE) ?? "null").status).toBe("ok");
  expect([...files.keys()]).toEqual([FILE]);
});
