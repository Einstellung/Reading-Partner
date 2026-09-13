// The model-call log (src/memory/usage/model-calls.ts): one line per call,
// append-only, one file per device. Run: bun test.

import { expect, test } from "bun:test";
import { inSyncRange } from "../../src/platform/sync/syncFs";
import {
  capToBytes,
  createModelCallLog,
  modelCallLogFile,
  MODEL_CALL_LOG_MAX_BYTES,
  type ModelCallRecord,
} from "../../src/memory/usage/model-calls";

const JULY_17 = new Date("2026-07-17T12:00:00Z").getTime();

function makeLog(deviceId = "device1") {
  const files = new Map<string, string>();
  const log = createModelCallLog({
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

function lines(text: string): ModelCallRecord[] {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as ModelCallRecord);
}

test("a call is one line, stamped and named for the device that made it", async () => {
  const { log, files } = makeLog();

  await log.logModelCall([
    {
      caller: "reading",
      bookId: "b-1",
      provider: "anthropic",
      model: "claude-x",
      input: 1200,
      output: 340,
      cacheRead: 900,
      ok: true,
    },
  ]);

  const entries = lines(files.get(modelCallLogFile("device1")) ?? "");
  expect(entries).toEqual([
    {
      at: "2026-07-17T12:00:00.000Z",
      device: "device1",
      caller: "reading",
      bookId: "b-1",
      provider: "anthropic",
      model: "claude-x",
      input: 1200,
      output: 340,
      cacheRead: 900,
      ok: true,
    },
  ]);
});

test("later calls are appended, and the file keeps everything already in it", async () => {
  const { log, files } = makeLog();
  const path = modelCallLogFile("device1");

  await log.logModelCall([
    { caller: "distill", provider: "anthropic", model: "m", input: 10, output: 2, ok: true },
    { caller: "translate", provider: "deepseek", model: "d", input: 5, output: 1, ok: false },
  ]);
  await log.logModelCall([
    { caller: "info", topicId: "t-1", provider: "anthropic", model: "m", input: 7, output: 3, ok: true },
  ]);

  const entries = lines(files.get(path) ?? "");
  expect(entries.map((e) => e.caller)).toEqual(["distill", "translate", "info"]);
  expect(entries[1]?.ok).toBe(false);
  expect(entries[2]?.topicId).toBe("t-1");
  expect(files.get(path)?.endsWith("\n")).toBe(true);
});

test("nothing is written for an empty batch", async () => {
  const { log, files } = makeLog();
  await log.logModelCall([]);
  expect(files.size).toBe(0);
});

// A device with no identity yet would write model-calls-.jsonl, which is out of
// sync range and would sit unread — the same drop createUsageLog makes.
test("a device with no identity writes nothing", async () => {
  const { log, files } = makeLog("");
  await log.logModelCall([{ caller: "prep", provider: "a", model: "m", input: 1, output: 1, ok: true }]);
  expect(files.size).toBe(0);
});

// What a machine spent is the machine's. Nothing collects these lines, so a
// synced copy would be one ever-growing file per device and no reader for any
// of them.
test("the log file is named for the device, and stays on it", () => {
  expect(modelCallLogFile("device1")).toBe("model-calls-device1.jsonl");
  expect(inSyncRange(modelCallLogFile("device1"))).toBe(false);
});

// --- the cap -----------------------------------------------------------------

const LINES = ["aaaa", "bbbb", "cccc"].map((l) => `${l}\n`).join("");

test("a log under the cap is left exactly as it is", () => {
  expect(capToBytes(LINES, 100)).toBe(LINES);
  expect(capToBytes("", 100)).toBe("");
});

test("over the cap, whole lines go off the front and the newest stay", () => {
  // Each line is five bytes with its newline.
  expect(capToBytes(LINES, 12)).toBe("bbbb\ncccc\n");
  expect(capToBytes(LINES, 5)).toBe("cccc\n");
});

test("the newest line is kept even when it alone is over the cap", () => {
  expect(capToBytes(LINES, 1)).toBe("cccc\n");
});

test("a multi-byte line is measured in bytes, not characters", () => {
  // Four three-byte characters and a newline: 13 bytes, not 5.
  const wide = "字字字字\n";
  expect(capToBytes(`aaaa\n${wide}`, 13)).toBe(wide);
  expect(capToBytes(`aaaa\n${wide}`, 18)).toBe(`aaaa\n${wide}`);
});

test("the cap is applied on append, so the file cannot grow without end", async () => {
  const { log, files } = makeLog();
  const path = modelCallLogFile("device1");
  files.set(path, `${"x".repeat(MODEL_CALL_LOG_MAX_BYTES)}\n`);

  await log.logModelCall([{ caller: "prep", provider: "a", model: "m", input: 1, output: 1, ok: true }]);

  const text = files.get(path) ?? "";
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MODEL_CALL_LOG_MAX_BYTES);
  expect(lines(text).map((e) => e.caller)).toEqual(["prep"]);
});
