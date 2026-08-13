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

import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
let readFails = false;

mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => files.has(path),
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async (path: string) => {
    if (readFails) throw new Error("EIO");
    const v = files.get(path);
    if (v === undefined) throw new Error(`no file: ${path}`);
    return v;
  },
  writeTextFile: async (path: string, content: string) => files.set(path, content),
}));

let quarantineFails = false;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { path: string; contents?: string }) => {
    if (cmd === "write_text_file_atomic") {
      files.set(args.path, args.contents ?? "");
      return null;
    }
    if (cmd === "quarantine_file") {
      if (quarantineFails) throw new Error("rename failed");
      const body = files.get(args.path);
      if (body === undefined) return null;
      const renamed = `${args.path}.corrupt-1700000000000`;
      files.set(renamed, body);
      files.delete(args.path);
      return renamed;
    }
    throw new Error(`unexpected command ${cmd}`);
  },
}));

const { onCorruptFile, readGuardedJson, readJson, readJsonOr } = await import(
  "../src/platform/app/atomic-fs"
);

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

const reports: { file: string; savedAs: string | null }[] = [];
onCorruptFile((r) => reports.push(r));

const warnings: unknown[][] = [];
const realWarn = console.warn;

beforeEach(() => {
  files.clear();
  reports.length = 0;
  warnings.length = 0;
  readFails = false;
  quarantineFails = false;
  console.warn = (...args: unknown[]) => warnings.push(args);
});

afterEach(() => {
  console.warn = realWarn;
});

test("a missing file reads as missing, with no report", async () => {
  expect(await readGuardedJson("library.json", validate)).toEqual({ status: "missing" });
  expect(reports).toEqual([]);
});

test("a valid file reads through", async () => {
  files.set("library.json", JSON.stringify({ books: { h1: "Paper" } }));
  const read = await readGuardedJson("library.json", validate);
  expect(read).toEqual({ status: "ok", value: { books: { h1: "Paper" } } });
  expect(reports).toEqual([]);
});

test("a half-written file is moved aside and reported", async () => {
  files.set("library.json", '{"books":{"h1":"Pap');
  const read = await readGuardedJson("library.json", validate);
  expect(read.status).toBe("corrupt");
  expect(read).toMatchObject({ savedAs: "library.json.corrupt-1700000000000" });
  // The bytes are kept: the shelf is not rebuildable from anywhere else.
  expect(files.get("library.json.corrupt-1700000000000")).toBe('{"books":{"h1":"Pap');
  expect(files.has("library.json")).toBe(false);
  expect(reports).toEqual([{ file: "library.json", savedAs: "library.json.corrupt-1700000000000" }]);
});

test("content that parses but has the wrong shape counts as corrupt", async () => {
  files.set("library.json", JSON.stringify({ nothing: true }));
  const read = await readGuardedJson("library.json", validate);
  expect(read.status).toBe("corrupt");
  expect(files.has("library.json.corrupt-1700000000000")).toBe(true);
});

test("a file that cannot be read is left in place and reported without a copy", async () => {
  files.set("library.json", JSON.stringify({ books: {} }));
  readFails = true;
  const read = await readGuardedJson("library.json", validate);
  expect(read).toEqual({ status: "corrupt", savedAs: null });
  // Nothing was moved: the caller must refuse to write over it.
  expect(files.has("library.json")).toBe(true);
  expect(reports).toEqual([{ file: "library.json", savedAs: null }]);
});

test("a failed quarantine reports without a copy rather than throwing", async () => {
  files.set("settings.json", "not json");
  quarantineFails = true;
  const read = await readGuardedJson("settings.json", validate);
  expect(read).toEqual({ status: "corrupt", savedAs: null });
  expect(reports).toEqual([{ file: "settings.json", savedAs: null }]);
});

// --- readJson / readJsonOr --------------------------------------------------

test("readJson returns the parsed value", async () => {
  files.set("info-pool-marks.json", JSON.stringify({ version: 1, marks: {} }));
  expect(await readJson<Marks>("info-pool-marks.json")).toEqual({ version: 1, marks: {} });
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
  files.set("info-briefing.json", '{"date":"2026-08-13"');
  expect(await readJson<Marks>("info-briefing.json")).toBeNull();
  expect(warnings.length).toBe(1);
  // The file stays exactly where it was.
  expect(files.get("info-briefing.json")).toBe('{"date":"2026-08-13"');
  expect(reports).toEqual([]);
});

test("readJson warns and reads as null when the read itself fails", async () => {
  files.set("info-briefing.json", JSON.stringify({ date: "2026-08-13" }));
  readFails = true;
  expect(await readJson<Marks>("info-briefing.json")).toBeNull();
  expect(warnings.length).toBe(1);
});

test("readJson warns when validate turns the shape down", async () => {
  files.set("library.json", JSON.stringify({ nothing: true }));
  expect(await readJson("library.json", validate)).toBeNull();
  expect(warnings.length).toBe(1);
});

test("readJsonOr falls back on every read that produces nothing", async () => {
  const empty: Marks = { version: 1, marks: {} };
  expect(await readJsonOr("info-pool-marks.json", empty)).toBe(empty);
  files.set("info-pool-marks.json", "not json");
  expect(await readJsonOr("info-pool-marks.json", empty)).toBe(empty);
  files.set("info-pool-marks.json", JSON.stringify({ version: 2, marks: { a: 1 } }));
  expect(await readJsonOr("info-pool-marks.json", empty)).toEqual({ version: 2, marks: { a: 1 } });
});
