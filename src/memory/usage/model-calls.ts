// What every model call spent: one line per call, one file per device.
//
// Separate from the memory usage log beside it. That log's lines name a
// statement or an observation that was put in front of the reader, and dream
// reads them as activation (docs/48); a line per model call names nothing dream
// can replay and would swamp the ones that do. Same file shape and the same
// one-writer-per-device rule as log.ts, for the same reasons — a different
// question, so a different file.
//
// Ids and numbers only: no prompt, no reply, no title.

import type { AiSurface } from "../../platform/app/cache-telemetry";
import { appendLines, writeInTurn, type UsageIo } from "./log";

// Who spent it. The tool-loop surfaces answer with the value they already carry
// for the cache accounting (platform/app/cache-telemetry.ts), so the two logs
// can be read against each other without a translation table; the rest are the
// plain single-shot calls, which have no surface.
export type ModelCaller =
  | AiSurface
  // A passage sent to be translated (src/reading/translate).
  | "translate"
  // A spoken turn (src/ai/voice).
  | "voice"
  // The nightly distillation pass (src/memory/dream).
  | "distill"
  // The unattended pipelines: plans, overviews, outlines, news triage.
  | "prep";

// What the call was about, when the caller has a name for it. A reading call
// has a book, an info call has a topic, a one-off has neither.
export interface ModelCallAbout {
  topicId?: string;
  bookId?: string;
}

export interface ModelCallContext extends ModelCallAbout {
  caller: ModelCaller;
}

// The part of pi's Usage this keeps. Structural, like TurnUsage: nothing here
// imports a provider SDK, and pi's Usage satisfies it.
export interface ModelCallUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

// One call. `ok` is false for a call that failed, which still spent whatever
// input it sent; a call that never reached a provider reports zeros, which is
// the truth about it.
export interface ModelCallRecord extends ModelCallContext, ModelCallUsage {
  at: string; // ISO 8601
  device: string;
  provider: string;
  model: string;
  ok: boolean;
}

export type ModelCallInput = Omit<ModelCallRecord, "at" | "device">;

export function modelCallLogFile(deviceId: string): string {
  return `model-calls-${deviceId}.jsonl`;
}

// How much of it to keep. Nothing collects this file and nothing syncs it, so
// the only thing that bounds it is this: a line is about 200 bytes, so a
// megabyte is some five thousand calls, which is months of them on one machine.
// The oldest go first — what a call cost last spring answers no question this
// log is kept for.
export const MODEL_CALL_LOG_MAX_BYTES = 1_000_000;

const UTF8 = new TextEncoder();

// Drop whole lines off the front until what is left fits. Pure, and whole lines
// only: half a line is a line a reader skips, and a file that starts mid-record
// is one every reader has to be taught to skip past.
//
// A single line longer than the cap is kept — it is the newest, and the file is
// then over by that line rather than empty.
export function capToBytes(text: string, maxBytes: number): string {
  if (UTF8.encode(text).length <= maxBytes) return text;
  const lines = text.split("\n").filter((l) => l !== "");
  const sizes = lines.map((l) => UTF8.encode(`${l}\n`).length);
  let bytes = sizes.reduce((a, b) => a + b, 0);
  let first = 0;
  // Never past the last line: the newest call is the one line this file cannot
  // be without, and a file over the cap by one line beats an empty one.
  while (first < lines.length - 1 && bytes > maxBytes) {
    bytes -= sizes[first] ?? 0;
    first += 1;
  }
  return `${lines.slice(first).join("\n")}\n`;
}

export interface ModelCallLog {
  logModelCall(calls: readonly ModelCallInput[]): Promise<void>;
}

export function createModelCallLog(io: UsageIo): ModelCallLog {
  return {
    async logModelCall(calls) {
      if (calls.length === 0) return;
      // A device with no identity yet writes nothing: see createUsageLog, which
      // drops the same way for the same reason.
      const device = io.deviceId();
      if (!device) return;
      // Stamped when the call reported, not when its turn at the file came:
      // the send path reports fire-and-forget, so a turn's calls queue behind
      // each other here (writeInTurn) while all of them happened at once.
      const at = new Date(io.now()).toISOString();
      const path = modelCallLogFile(device);
      const lines = calls.map((c) => ({ at, device, ...c }));
      await writeInTurn(path, async () => {
        const prior = (await io.read(path)) ?? "";
        const written = appendLines(prior, lines);
        await io.write(path, capToBytes(written, MODEL_CALL_LOG_MAX_BYTES));
      });
    },
  };
}
