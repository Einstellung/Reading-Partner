// The memory usage log (src/memory/usage.ts): append-only, one file per device.
// Run: bun test.

import { expect, test } from "bun:test";
import { inSyncRange } from "../../src/platform/sync/syncFs";
import {
  appendLines,
  createUsageLog,
  usageLogFile,
  type UsageEntry,
} from "../../src/memory/usage/log";

const JULY_17 = new Date("2026-07-17T12:00:00Z").getTime();

function makeLog(deviceId = "device1") {
  const files = new Map<string, string>();
  const log = createUsageLog({
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    deviceId: () => deviceId,
    now: () => JULY_17,
  });
  return { log, files };
}

function lines(text: string): UsageEntry[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as UsageEntry);
}

test("a batch is one write, and the file keeps everything already in it", async () => {
  const { log, files } = makeLog();
  const path = usageLogFile("device1");

  await log.logUsage([
    { kind: "shown", id: "s-0123456789abcdef" },
    { kind: "cited", id: "m-0123456789abcdef", query: "bm25" },
  ]);
  await log.logUsage([{ kind: "rejected", id: "s-0123456789abcdef" }]);

  expect(lines(files.get(path) as string)).toEqual([
    { at: "2026-07-17T12:00:00.000Z", device: "device1", kind: "shown", id: "s-0123456789abcdef" },
    {
      at: "2026-07-17T12:00:00.000Z",
      device: "device1",
      kind: "cited",
      id: "m-0123456789abcdef",
      query: "bm25",
    },
    { at: "2026-07-17T12:00:00.000Z", device: "device1", kind: "rejected", id: "s-0123456789abcdef" },
  ]);
  expect((files.get(path) as string).endsWith("\n")).toBe(true);
});

test("nothing to log writes nothing at all", async () => {
  const { log, files } = makeLog();
  await log.logUsage([]);
  expect(files.size).toBe(0);
});

// The identity is minted at startup. A call before that would write
// "memory-usage-.jsonl", which is out of sync range and would sit unread.
test("a device with no identity yet writes nothing", async () => {
  const { log, files } = makeLog("");
  await log.logUsage([{ kind: "shown", id: "s-0123456789abcdef" }]);
  expect(files.size).toBe(0);
  expect(inSyncRange(usageLogFile(""))).toBe(false);
});

test("the file this device writes is in sync range", () => {
  expect(usageLogFile("device1")).toBe("memory-usage-device1.jsonl");
  expect(inSyncRange("memory-usage-device1.jsonl")).toBe(true);
});

// A half-written line is one line a reader skips, not a reason to rewrite the
// file: the log is append-only in the strong sense that nothing here ever
// rewrites a byte that is already down.
test("bad bytes already in the file are left exactly where they are", () => {
  const broken = '{"at":"2026-07-17T12:00:00.000Z","dev';
  const out = appendLines(broken, [
    { at: "2026-07-17T12:00:00.000Z", device: "device1", kind: "shown", id: "s-1" },
  ]);
  expect(out.startsWith(`${broken}\n`)).toBe(true);
  // Two lines: the corrupt one, untouched, and the new one after it.
  expect(out.split("\n").filter((l) => l.trim() !== "").length).toBe(2);
});
