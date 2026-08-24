// The one door to the filesystem (src/platform/app/appdata.ts), against a spied
// @tauri-apps/plugin-fs.
//
// What this is for. "Every filesystem call carries the AppData base directory"
// was never asserted anywhere: it used to be an argument repeated at 120 call
// sites, and every fs stub in the suite ignores its second argument, so an
// omission would have reached a device before it reached a test. The port says
// it once. One line deserves one test.
//
// The rest is the translation the port does on the way through — recursive on
// mkdir, append on the event log's write, the plugin's `mtime: Date | null`
// flattened to a number, a stat that cannot be taken answering null instead of
// throwing, and a directory listing rebuilt into the port's own DirEntry so no
// caller ever holds a type from a host package.
//
// This file and appdata-contract.test.ts are the two that legitimately reach for
// a host package: they are what the port is checked against.
//
// Run: bun test.

import { beforeEach, expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as fs from "@tauri-apps/plugin-fs";
import { appData } from "../../../src/platform/app/appdata";

const APPDATA = fs.BaseDirectory.AppData;

// A plugin DirEntry carries exactly these four; a plugin FileInfo carries
// seventeen, of which the port keeps two and converts one.
const ENTRY: fs.DirEntry = { name: "x", isFile: true, isDirectory: false, isSymlink: false };
const INFO: fs.FileInfo = {
  isFile: true,
  isDirectory: false,
  isSymlink: false,
  size: 12,
  mtime: new Date(1_700_000_000_123),
  atime: null,
  birthtime: null,
  readonly: false,
  fileAttributes: null,
  dev: null,
  ino: null,
  mode: null,
  nlink: null,
  uid: null,
  gid: null,
  rdev: null,
  blksize: null,
  blocks: null,
};

// Spies go up in beforeEach, never at module scope: the preload restores every
// spy before each test, so a module-scope one is silently gone by the second
// (docs/pitfall/171).
beforeEach(() => {
  spyOn(fs, "exists").mockImplementation(async () => false);
  spyOn(fs, "readTextFile").mockImplementation(async () => "contents");
  spyOn(fs, "readFile").mockImplementation(async () => new Uint8Array([1, 2]));
  spyOn(fs, "writeFile").mockImplementation(async () => {});
  spyOn(fs, "writeTextFile").mockImplementation(async () => {});
  spyOn(fs, "readDir").mockImplementation(async () => [{ ...ENTRY }]);
  spyOn(fs, "mkdir").mockImplementation(async () => {});
  spyOn(fs, "stat").mockImplementation(async () => ({ ...INFO }));
  spyOn(fs, "remove").mockImplementation(async () => {});
  spyOn(fs, "rename").mockImplementation(async () => {});
  spyOn(core, "invoke").mockImplementation((async () => null) as typeof core.invoke);
});

function argsOf(name: keyof typeof fs): unknown[] {
  const fn = fs[name] as unknown as { mock?: { calls: unknown[][] } };
  const calls = fn.mock?.calls ?? [];
  expect(calls.length).toBe(1);
  return calls[0];
}

// Every port method that addresses an AppData-relative path, which plugin
// function it lands on, and where the options object sits in that call.
// AT_THE_DOOR below holds the ones that are not AppData-relative; between them
// the two lists have to name every method the port has, or the last test fails.
interface Relative {
  method: string;
  plugin: keyof typeof fs;
  /** The relative path the call below asks for. */
  path: string;
  /** Where the options object sits in the plugin call. */
  optionsAt: number;
  call(): Promise<unknown>;
}

const RELATIVE: Relative[] = [
  {
    method: "exists",
    plugin: "exists",
    path: "a.json",
    optionsAt: 1,
    call: () => appData.exists("a.json"),
  },
  {
    method: "readText",
    plugin: "readTextFile",
    path: "a.json",
    optionsAt: 1,
    call: () => appData.readText("a.json"),
  },
  {
    method: "readBytes",
    plugin: "readFile",
    path: "library/a.pdf",
    optionsAt: 1,
    call: () => appData.readBytes("library/a.pdf"),
  },
  {
    method: "writeBytes",
    plugin: "writeFile",
    path: "library/a.pdf",
    optionsAt: 2,
    call: () => appData.writeBytes("library/a.pdf", new Uint8Array([7])),
  },
  {
    method: "appendText",
    plugin: "writeTextFile",
    path: "events-t1.jsonl",
    optionsAt: 2,
    call: () => appData.appendText("events-t1.jsonl", "line\n"),
  },
  {
    method: "readDir",
    plugin: "readDir",
    path: "slides",
    optionsAt: 1,
    call: () => appData.readDir("slides"),
  },
  {
    method: "mkdirp",
    plugin: "mkdir",
    path: "covers",
    optionsAt: 1,
    call: () => appData.mkdirp("covers"),
  },
  {
    method: "stat",
    plugin: "stat",
    path: "a.json",
    optionsAt: 1,
    call: () => appData.stat("a.json"),
  },
  {
    method: "remove",
    plugin: "remove",
    path: "a.json",
    optionsAt: 1,
    call: () => appData.remove("a.json"),
  },
  {
    method: "removeDir",
    plugin: "remove",
    path: "prep-1",
    optionsAt: 1,
    call: () => appData.removeDir("prep-1"),
  },
];

for (const c of RELATIVE) {
  test(`${c.method} addresses AppData`, async () => {
    await c.call();
    const args = argsOf(c.plugin);
    // The path goes down untouched, and the base directory goes with it.
    expect(args[0]).toBe(c.path);
    expect(args[c.optionsAt]).toMatchObject({ baseDir: APPDATA });
  });
}

test("rename gives both ends the AppData base", async () => {
  await appData.rename("rehearsal-1.json", "rehearsal-1.json.bad");
  expect(argsOf("rename")).toEqual([
    "rehearsal-1.json",
    "rehearsal-1.json.bad",
    { oldPathBaseDir: APPDATA, newPathBaseDir: APPDATA },
  ]);
});

test("mkdirp creates the whole path", async () => {
  await appData.mkdirp("prep-1/chapters");
  expect(argsOf("mkdir")).toEqual(["prep-1/chapters", { baseDir: APPDATA, recursive: true }]);
});

test("removeDir removes the whole tree", async () => {
  await appData.removeDir("prep-1");
  expect(argsOf("remove")[1]).toEqual({ baseDir: APPDATA, recursive: true });
});

test("remove does not recurse", async () => {
  await appData.remove("a.json");
  expect(argsOf("remove")[1]).toEqual({ baseDir: APPDATA });
});

test("appendText appends rather than replacing", async () => {
  await appData.appendText("events-t1.jsonl", "line\n");
  expect(argsOf("writeTextFile")).toEqual([
    "events-t1.jsonl",
    "line\n",
    { baseDir: APPDATA, append: true },
  ]);
});

test("writeBytes carries no append flag", async () => {
  await appData.writeBytes("library/a.pdf", new Uint8Array([7]));
  expect(argsOf("writeFile")[2]).toEqual({ baseDir: APPDATA });
});

test("stat reports the modification time in milliseconds", async () => {
  expect(await appData.stat("a.json")).toEqual({
    mtimeMs: 1_700_000_000_123,
    size: 12,
  });
});

test("a host that reports no mtime stats as 0, not as missing", async () => {
  spyOn(fs, "stat").mockImplementation(async () => ({ ...INFO, mtime: null }));
  expect(await appData.stat("a.json")).toEqual({ mtimeMs: 0, size: 12 });
});

test("a file that cannot be stat'd is null, not a throw", async () => {
  spyOn(fs, "stat").mockImplementation(async () => {
    throw new Error("no file: a.json");
  });
  expect(await appData.stat("a.json")).toBeNull();
});

test("readDir hands back the port's own entries", async () => {
  // The plugin's own DirEntry plus a field a later version might add: what
  // comes out is built here, not passed through.
  spyOn(fs, "readDir").mockImplementation(
    async () => [{ ...ENTRY, name: "deck.json", extra: "ignored" }] as unknown as fs.DirEntry[],
  );
  const entries = await appData.readDir("slides");
  expect(entries).toEqual([
    { name: "deck.json", isFile: true, isDirectory: false, isSymlink: false },
  ]);
  expect(Object.keys(entries[0]).sort()).toEqual([
    "isDirectory",
    "isFile",
    "isSymlink",
    "name",
  ]);
});

test("readPicked reads an absolute path with no base directory", async () => {
  await appData.readPicked("/home/reader/Downloads/paper.pdf");
  expect(argsOf("readFile")).toEqual(["/home/reader/Downloads/paper.pdf"]);
});

test("writeAtomic and quarantine go to the Rust commands", async () => {
  await appData.writeAtomic("topics.json", "{}");
  await appData.quarantine("topics.json");
  const calls = (core.invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  expect(calls).toEqual([
    ["write_text_file_atomic", { path: "topics.json", contents: "{}" }],
    ["quarantine_file", { path: "topics.json" }],
  ]);
});

// The two lists above are the whole port or they are not a check. A method
// added without a line here means a filesystem call nobody asserted a base
// directory for.
const AT_THE_DOOR = ["rename", "writeAtomic", "quarantine", "readPicked"];

test("every method of the port is covered by one of the two lists", () => {
  const covered = [...RELATIVE.map((c) => c.method), ...AT_THE_DOOR].sort();
  expect(Object.keys(appData).sort()).toEqual(covered);
});
