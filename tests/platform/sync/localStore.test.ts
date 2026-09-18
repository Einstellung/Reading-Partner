// The delete journal's retention rule (src/platform/sync/localStore.ts). The
// journal is the only copy of a record a merge removed because the other device
// deleted it, so what this drops is unrecoverable — and what it keeps is what
// the user gets back. Run: bun test.

import { expect, test } from "bun:test";
import {
  pruneTrashText,
  readCachedPeerHoldings,
  TRASH_TTL_MS,
} from "../../../src/platform/sync/localStore";
import { buildHoldings, serializeHoldings } from "../../../src/platform/sync/holdings";

const line = (id: string, at: number) => JSON.stringify({ at, path: "a.json", id, record: {} });

test("entries older than the retention window are dropped, the rest kept", () => {
  const now = 10 * TRASH_TTL_MS;
  const text = [
    line("stale", now - TRASH_TTL_MS - 1),
    line("fresh", now - 1000),
    line("edge", now - TRASH_TTL_MS + 1),
  ].join("\n");

  expect(pruneTrashText(text, now)).toBe(`${line("fresh", now - 1000)}
${line("edge", now - TRASH_TTL_MS + 1)}
`);
});

test("a journal with nothing to drop is not rewritten", () => {
  const now = 10 * TRASH_TTL_MS;
  expect(pruneTrashText(`${line("fresh", now)}\n`, now)).toBeNull();
  expect(pruneTrashText("", now)).toBeNull();
});

test("dropping the last entry leaves an empty journal, not a stray blank line", () => {
  const now = 10 * TRASH_TTL_MS;
  expect(pruneTrashText(`${line("stale", 0)}\n`, now)).toBe("");
});

// This file is the only copy of what it holds. A line this cannot read is still
// a record someone might want back, and there is nowhere else to get it.
test("a line that will not parse is kept, not swept up as garbage", () => {
  const now = 10 * TRASH_TTL_MS;
  const text = `{ truncated mid-write\n${line("stale", 0)}\n`;
  expect(pruneTrashText(text, now)).toBe("{ truncated mid-write\n");
});

test("an entry with no timestamp is kept rather than aged out immediately", () => {
  const now = 10 * TRASH_TTL_MS;
  expect(pruneTrashText(`${JSON.stringify({ id: "x", record: 1 })}\n`, now)).toBeNull();
});

// --- cached peer holdings ---------------------------------------------------

test("cached peer trees are read, minus self, this device and junk", async () => {
  const tree = (device: string, app?: string) =>
    serializeHoldings(buildHoldings({ device, at: 1, files: {}, app }));
  const files: Record<string, Uint8Array> = {
    "sync-holdings/self.json": tree("d-me"),
    "sync-holdings/d-me.json": tree("d-me"),
    "sync-holdings/d-mac.json": tree("d-mac", "0.19.2 (macos)"),
    "sync-holdings/d-torn.json": new TextEncoder().encode("{ half"),
    "sync-holdings/notes.txt": new TextEncoder().encode("x"),
  };
  const fs = {
    async readDir() {
      return Object.keys(files).map((p) => ({
        name: p.slice("sync-holdings/".length),
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      }));
    },
    async readBytes(path: string) {
      const b = files[path];
      if (!b) throw new Error(`enoent ${path}`);
      return b;
    },
  };
  const peers = await readCachedPeerHoldings("d-me", fs);
  expect(peers.map((h) => [h.device, h.app])).toEqual([["d-mac", "0.19.2 (macos)"]]);

  const noDir = {
    readDir: async () => {
      throw new Error("no dir");
    },
    readBytes: fs.readBytes,
  };
  expect(await readCachedPeerHoldings("d-me", noDir)).toEqual([]);
});
