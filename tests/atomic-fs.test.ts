// The load-side half of durable storage (src/platform/app/atomic-fs.ts).
//
// readGuardedJson is for a data file the app cannot rebuild: it is never
// silently replaced by defaults. Unparseable content is quarantined first; a
// file that could not be read at all is left in place and reported so callers
// can refuse to overwrite it.
//
// readJson/readJsonOr are the other case — a cache, a pool, a published copy —
// where a bad file costs a round of work and nothing else. They quarantine
// nothing and never throw, so the distinction that matters is missing (silent)
// against unreadable (warned).
//
// The atomic write itself is a Rust command, covered by the tests in
// src-tauri/src/atomic_fs.rs.
// Run: bun test.

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  readGuardedJson,
  readJson,
  readJsonOr,
} from "../src/platform/app/atomic-fs";
import { onStoreError } from "../src/platform/app/store-errors";
import { installAppData, type FakeDisk } from "./support/appdata-fake";

let disk: FakeDisk;

interface Marks {
  version: number;
  marks: Record<string, number>;
}

interface Store {
  books: Record<string, string>;
}
const validate = (raw: unknown): Store | null => {
  const s = raw as Store | null;
  return s && typeof s === "object" && s.books ? s : null;
};

// validate may normalize as well as accept, so what readJson returns is not
// always the object it parsed: this one fills in an absent `marks`.
const normalize = (raw: unknown): Marks | null => {
  const m = raw as Partial<Marks> | null;
  if (!m || typeof m !== "object" || typeof m.version !== "number") return null;
  return { version: m.version, marks: m.marks ?? {} };
};

// The quarantine report arrives as a store error now, with the sentence the
// shells show already chosen (platform/app/store-errors.ts).
const reports: { file: string; savedAs: string | null }[] = [];
const messages: (string | null)[] = [];

const warnings: unknown[][] = [];
const realWarn = console.warn;

// The subscription goes up and comes down around each case. onStoreError is a
// process-wide registry and mock.restore() knows nothing about it, so a
// listener added at module scope would still be collecting every other file's
// reports for the rest of the run.
let unsubscribe: () => void = () => {};

beforeEach(() => {
  disk = installAppData();
  reports.length = 0;
  messages.length = 0;
  warnings.length = 0;
  console.warn = (...args: unknown[]) => warnings.push(args);
  unsubscribe = onStoreError((e) => {
    if (e.scope !== "corrupt-file") return;
    reports.push(e.error as { file: string; savedAs: string | null });
    messages.push(e.message);
  });
});

afterEach(() => {
  unsubscribe();
  console.warn = realWarn;
});

test("a missing file reads as missing, with no report", async () => {
  expect(await readGuardedJson("library.json", validate)).toEqual({ status: "missing" });
  expect(reports).toEqual([]);
});

test("a valid file reads through", async () => {
  disk.files.set("library.json", JSON.stringify({ books: { h1: "Paper" } }));
  const read = await readGuardedJson("library.json", validate);
  expect(read).toEqual({ status: "ok", value: { books: { h1: "Paper" } } });
  expect(reports).toEqual([]);
});

test("a half-written file is moved aside and reported", async () => {
  disk.files.set("library.json", '{"books":{"h1":"Pap');
  const read = await readGuardedJson("library.json", validate);
  expect(read.status).toBe("corrupt");
  expect(read).toMatchObject({ savedAs: "library.json.corrupt-1700000000000" });
  // The bytes are kept: the shelf is not rebuildable from anywhere else.
  expect(disk.files.get("library.json.corrupt-1700000000000")).toBe('{"books":{"h1":"Pap');
  expect(disk.files.has("library.json")).toBe(false);
  expect(reports).toEqual([{ file: "library.json", savedAs: "library.json.corrupt-1700000000000" }]);
});

test("content that parses but has the wrong shape counts as corrupt", async () => {
  disk.files.set("library.json", JSON.stringify({ nothing: true }));
  const read = await readGuardedJson("library.json", validate);
  expect(read.status).toBe("corrupt");
  expect(disk.files.has("library.json.corrupt-1700000000000")).toBe(true);
});

test("a file that cannot be read is left in place and reported without a copy", async () => {
  disk.files.set("library.json", JSON.stringify({ books: {} }));
  disk.readFails = true;
  const read = await readGuardedJson("library.json", validate);
  expect(read).toEqual({ status: "corrupt", savedAs: null });
  // Nothing was moved: the caller must refuse to write over it.
  expect(disk.files.has("library.json")).toBe(true);
  expect(reports).toEqual([{ file: "library.json", savedAs: null }]);
});

test("a failed quarantine reports without a copy rather than throwing", async () => {
  disk.files.set("settings.json", "not json");
  disk.quarantineFails = true;
  const read = await readGuardedJson("settings.json", validate);
  expect(read).toEqual({ status: "corrupt", savedAs: null });
  expect(reports).toEqual([{ file: "settings.json", savedAs: null }]);
});

// --- readJson / readJsonOr --------------------------------------------------

test("readJson returns the parsed value", async () => {
  disk.files.set("info-pool-marks.json", JSON.stringify({ version: 1, marks: {} }));
  expect(await readJson<Marks>("info-pool-marks.json")).toEqual({ version: 1, marks: {} });
  expect(warnings).toEqual([]);
});

test("readJson hands back what validate returned, not what it was given", async () => {
  disk.files.set("info-pool-marks.json", JSON.stringify({ version: 3 }));
  expect(await readJson("info-pool-marks.json", normalize)).toEqual({ version: 3, marks: {} });
  expect(warnings).toEqual([]);
});

test("readJson reads a missing file as null without warning", async () => {
  expect(await readJson<Marks>("info-pool-marks.json")).toBeNull();
  expect(warnings).toEqual([]);
  // Nothing is quarantined either: the file is rebuildable, so there is no bad
  // copy worth keeping.
  expect(reports).toEqual([]);
});

test("readJson warns and reads as null when the bytes will not parse", async () => {
  disk.files.set("info-briefing.json", '{"date":"2026-08-13"');
  expect(await readJson<Marks>("info-briefing.json")).toBeNull();
  expect(warnings.length).toBe(1);
  // The file stays exactly where it was.
  expect(disk.files.get("info-briefing.json")).toBe('{"date":"2026-08-13"');
  expect(reports).toEqual([]);
});

test("readJson warns and reads as null when the read itself fails", async () => {
  disk.files.set("info-briefing.json", JSON.stringify({ date: "2026-08-13" }));
  disk.readFails = true;
  expect(await readJson<Marks>("info-briefing.json")).toBeNull();
  expect(warnings.length).toBe(1);
});

test("readJson warns when validate turns the shape down", async () => {
  disk.files.set("library.json", JSON.stringify({ nothing: true }));
  expect(await readJson("library.json", validate)).toBeNull();
  expect(warnings.length).toBe(1);
});

test("readJsonOr falls back on every read that produces nothing", async () => {
  const empty: Marks = { version: 1, marks: {} };
  expect(await readJsonOr("info-pool-marks.json", empty)).toEqual(empty);
  disk.files.set("info-pool-marks.json", "not json");
  expect(await readJsonOr("info-pool-marks.json", empty)).toEqual(empty);
  disk.files.set("info-pool-marks.json", JSON.stringify({ version: 2, marks: { a: 1 } }));
  expect(await readJsonOr("info-pool-marks.json", empty)).toEqual({ version: 2, marks: { a: 1 } });
});

test("the fallback is copied, so one caller's edits cannot reach the next", async () => {
  const empty: Marks = { version: 1, marks: {} };
  const first = await readJsonOr("info-pool-marks.json", empty);
  expect(first).not.toBe(empty);
  first.marks.a = 1;
  expect(await readJsonOr("info-pool-marks.json", empty)).toEqual({ version: 1, marks: {} });
});
