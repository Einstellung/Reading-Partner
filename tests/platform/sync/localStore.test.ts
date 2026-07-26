// The delete journal's retention rule (src/platform/sync/localStore.ts). The
// journal is the only copy of a record a merge removed because the other device
// deleted it, so what this drops is unrecoverable — and what it keeps is what
// the user gets back. Run: bun test.

import { expect, test } from "bun:test";
import { pruneTrashText, TRASH_TTL_MS } from "../../../src/platform/sync/localStore";

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
