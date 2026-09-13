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
import { appendLines, type UsageIo } from "./log";

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
      const at = new Date(io.now()).toISOString();
      const path = modelCallLogFile(device);
      const prior = (await io.read(path)) ?? "";
      await io.write(path, appendLines(prior, calls.map((c) => ({ at, device, ...c }))));
    },
  };
}
