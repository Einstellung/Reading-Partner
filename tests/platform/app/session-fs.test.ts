// The harness's filesystem over AppData (src/platform/app/session-fs.ts).
//
// Two halves. The first is this project's own: the twelve methods the session
// repo calls, the four that say no, and the confinement — the part where a
// composed path tries to leave session/ and is refused.
//
// The second is pi's own conformance suite, run against a JsonlSessionRepo
// built on this filesystem. It is the only thing that exercises the twelve the
// way the harness actually uses them (staging a file and renaming it into
// place, reading a header line, listing a store to find what is in it), and it
// is where a plausible-but-wrong implementation gets caught. The suite ships as
// runner-independent cases — `{ group, name, run() }` asserting through
// node:assert/strict — so registering each one as a bun test is the whole
// adaptation. Run: scripts/t.sh tests/platform/app/session-fs.test.ts

import { describe, expect, test } from "bun:test";
import {
  JsonlSessionRepo,
  BACKGROUND_CONTEXT,
  type FileError,
  type JsonlSessionMetadata,
  type Result,
  type SessionRepo,
} from "@earendil-works/pi-agent-core";
import { createSessionRepoConformance } from "@earendil-works/pi-agent-core/harness/session/testing";
import { createSessionFileSystem, SESSIONS_ROOT } from "../../../src/platform/app/session-fs";
import { memoryAppData, type MemoryDisk } from "../../support/memory-appdata";

const ctx = BACKGROUND_CONTEXT;

function rig(): { disk: MemoryDisk; fs: ReturnType<typeof createSessionFileSystem> } {
  const disk = memoryAppData();
  return { disk, fs: createSessionFileSystem(disk) };
}

// The Result the interface returns everywhere. Unwrapped here rather than in
// every case, and a failure names its error instead of reading as `undefined`.
function value<T>(result: Result<T, Error>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`);
  return result.value;
}

function error(result: { ok: true; value: unknown } | { ok: false; error: FileError }): FileError {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

test("a file written under the sessions root can be read back", async () => {
  const { disk, fs } = rig();
  value(await fs.createDir(`${SESSIONS_ROOT}/store`, undefined, ctx));
  value(await fs.writeFile(`${SESSIONS_ROOT}/store/a.jsonl`, "one\n", ctx));
  expect(value(await fs.readTextFile(`${SESSIONS_ROOT}/store/a.jsonl`, ctx))).toBe("one\n");
  // The addressed path is the AppData path with a leading slash, and nothing
  // else lands anywhere else on the disk.
  expect([...disk.files.keys()]).toEqual(["session/store/a.jsonl"]);
});

test("appending adds lines, and readTextLines stops where it is told", async () => {
  const { fs } = rig();
  value(await fs.createDir(`${SESSIONS_ROOT}/store`, undefined, ctx));
  value(await fs.writeFile(`${SESSIONS_ROOT}/store/a.jsonl`, "header\n", ctx));
  value(await fs.appendFile(`${SESSIONS_ROOT}/store/a.jsonl`, "second\n", ctx));
  value(await fs.appendFile(`${SESSIONS_ROOT}/store/a.jsonl`, "third\n", ctx));
  expect(value(await fs.readTextLines(`${SESSIONS_ROOT}/store/a.jsonl`, undefined, ctx))).toEqual([
    "header",
    "second",
    "third",
  ]);
  expect(
    value(await fs.readTextLines(`${SESSIONS_ROOT}/store/a.jsonl`, { maxLines: 1 }, ctx)),
  ).toEqual(["header"]);
});

test("a listing names its children and says which are directories", async () => {
  const { fs } = rig();
  value(await fs.createDir(`${SESSIONS_ROOT}/store/nested`, undefined, ctx));
  value(await fs.writeFile(`${SESSIONS_ROOT}/store/a.jsonl`, "x", ctx));
  const listed = value(await fs.listDir(`${SESSIONS_ROOT}/store`, ctx));
  expect(listed.map((e) => `${e.kind}:${e.name}:${e.path}`).sort()).toEqual([
    `directory:nested:${SESSIONS_ROOT}/store/nested`,
    `file:a.jsonl:${SESSIONS_ROOT}/store/a.jsonl`,
  ]);
});

test("fileInfo tells a file from a directory, and sizes the file", async () => {
  const { fs } = rig();
  value(await fs.createDir(`${SESSIONS_ROOT}/store`, undefined, ctx));
  value(await fs.writeFile(`${SESSIONS_ROOT}/store/a.jsonl`, "12345", ctx));
  const file = value(await fs.fileInfo(`${SESSIONS_ROOT}/store/a.jsonl`, ctx));
  expect({ kind: file.kind, size: file.size, name: file.name }).toEqual({
    kind: "file",
    size: 5,
    name: "a.jsonl",
  });
  expect(value(await fs.fileInfo(`${SESSIONS_ROOT}/store`, ctx)).kind).toBe("directory");
});

test("rename moves a file, and removing takes it away", async () => {
  const { fs } = rig();
  value(await fs.createDir(`${SESSIONS_ROOT}/store`, undefined, ctx));
  value(await fs.writeFile(`${SESSIONS_ROOT}/store/staged.tmp`, "body", ctx));
  value(
    await fs.renameFile(`${SESSIONS_ROOT}/store/staged.tmp`, `${SESSIONS_ROOT}/store/a.jsonl`, ctx),
  );
  expect(value(await fs.exists(`${SESSIONS_ROOT}/store/staged.tmp`, ctx))).toBe(false);
  expect(value(await fs.readTextFile(`${SESSIONS_ROOT}/store/a.jsonl`, ctx))).toBe("body");

  value(await fs.remove(`${SESSIONS_ROOT}/store/a.jsonl`, undefined, ctx));
  expect(value(await fs.exists(`${SESSIONS_ROOT}/store/a.jsonl`, ctx))).toBe(false);
  value(await fs.remove(`${SESSIONS_ROOT}/store`, { recursive: true }, ctx));
  expect(value(await fs.exists(`${SESSIONS_ROOT}/store`, ctx))).toBe(false);
});

// A path that is not there is the failure every caller tells apart from the
// rest, and `force` is the staging sweep that does not care.
test("a path that is not there reads as not_found, and force forgives it", async () => {
  const { fs } = rig();
  expect(error(await fs.readTextFile(`${SESSIONS_ROOT}/store/missing.jsonl`, ctx)).code).toBe(
    "not_found",
  );
  expect(error(await fs.readTextLines(`${SESSIONS_ROOT}/missing`, undefined, ctx)).code).toBe(
    "not_found",
  );
  expect(error(await fs.fileInfo(`${SESSIONS_ROOT}/missing`, ctx)).code).toBe("not_found");
  expect(error(await fs.listDir(`${SESSIONS_ROOT}/missing`, ctx)).code).toBe("not_found");
  expect(error(await fs.remove(`${SESSIONS_ROOT}/missing`, undefined, ctx)).code).toBe("not_found");
  value(await fs.remove(`${SESSIONS_ROOT}/missing`, { force: true }, ctx));
  expect(value(await fs.exists(`${SESSIONS_ROOT}/missing`, ctx))).toBe(false);
});

// The whole point of the confinement: a path is a string the harness composed,
// and the app's own files sit one directory up.
test("nothing reaches out of the sessions root", async () => {
  const { disk, fs } = rig();
  const outside = [
    "/library.json",
    `${SESSIONS_ROOT}/../library.json`,
    `${SESSIONS_ROOT}/a/../../library.json`,
    "/sessionry/x.json",
  ];
  for (const path of outside) {
    expect(error(await fs.writeFile(path, "stolen", ctx)).code).toBe("permission_denied");
    expect(error(await fs.readTextFile(path, ctx)).code).toBe("permission_denied");
    expect(error(await fs.remove(path, { force: true }, ctx)).code).toBe("permission_denied");
    expect(error(await fs.exists(path, ctx)).code).toBe("permission_denied");
  }
  // Neither end of a rename may leave either.
  value(await fs.createDir(SESSIONS_ROOT, undefined, ctx));
  value(await fs.writeFile(`${SESSIONS_ROOT}/a.jsonl`, "body", ctx));
  expect(error(await fs.renameFile(`${SESSIONS_ROOT}/a.jsonl`, "/library.json", ctx)).code).toBe(
    "permission_denied",
  );
  expect(disk.files.has("library.json")).toBe(false);
});

// Unconfined on purpose: they touch nothing, and the repo resolves the
// session's `cwd` through absolutePath — a grouping key that names no file of
// ours. Confining it would refuse to create a session at all.
test("absolutePath and joinPath normalize without judging", async () => {
  const { fs } = rig();
  expect(value(await fs.absolutePath("/app/./work/..", ctx))).toBe("/app");
  expect(value(await fs.absolutePath("store/a.jsonl", ctx))).toBe(`${SESSIONS_ROOT}/store/a.jsonl`);
  expect(value(await fs.joinPath([SESSIONS_ROOT, "store", "a.jsonl"], ctx))).toBe(
    `${SESSIONS_ROOT}/store/a.jsonl`,
  );
  // A segment that starts with a slash is a segment, not a new root.
  expect(value(await fs.joinPath(["/session", "/store", "a.jsonl"], ctx))).toBe(
    `${SESSIONS_ROOT}/store/a.jsonl`,
  );
  // The repo resolves a session's cwd before it knows there is one
  // (docs/pitfall/305): undefined is the current directory, not a crash.
  expect(value(await fs.absolutePath(undefined as unknown as string, ctx))).toBe(SESSIONS_ROOT);
});

test("the four AppData has no answer for say so", async () => {
  const { fs } = rig();
  for (const result of [
    await fs.readBinaryFile(`${SESSIONS_ROOT}/a.jsonl`, ctx),
    await fs.canonicalPath(`${SESSIONS_ROOT}/a.jsonl`, ctx),
    await fs.createTempDir(undefined, ctx),
    await fs.createTempFile(undefined, ctx),
  ]) {
    expect(error(result).code).toBe("not_supported");
  }
  // cleanup is the fifth, and the one that cannot report: it returns void and
  // the interface forbids it throwing.
  await fs.cleanup(ctx);
});

// --- pi's own conformance suite ---------------------------------------------

// The one case that is not about us. It starts a fork and a create racing for
// the same destination id and requires the one called first to win, and the
// winner is whichever reaches the repo's in-memory reservation set first — a
// question of how many microtask ticks each path spends before it gets there,
// not of the filesystem contract. A filesystem-backed repo cannot pass both
// orderings; they are there for a repository whose reservation is a
// transaction. Which of the two is lost moved in pi 0.87 — fork now reaches the
// reservation first either way, so the case that expects create to win is the
// one left out (docs/pitfall/396). Left out by name rather than by group, so a
// case pi adds later runs without anyone having to remember to add it.
const NOT_FOR_A_FILESYSTEM = new Set([
  "publishes create when it reserves a shared destination id first",
]);

describe("JsonlSessionRepo conformance on AppData", () => {
  for (const conformance of createSessionRepoConformance(async () => {
    const { fs } = rig();
    // The suite is written against SessionRepo's list(void); the JSONL repo
    // narrows it to list(JsonlSessionListOptions | undefined), which no case
    // passes. The cast is that one signature, not a shape difference.
    return new JsonlSessionRepo({
      fileSystem: fs,
      sessionsRoot: SESSIONS_ROOT,
    }) as unknown as SessionRepo<JsonlSessionMetadata>;
  })) {
    if (NOT_FOR_A_FILESYSTEM.has(conformance.name)) continue;
    test(`${conformance.group}: ${conformance.name}`, async () => {
      await conformance.run();
    });
  }
});
