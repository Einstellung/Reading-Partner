// Local event log (M8): one JSONL file per topic under AppData
// (events-<topicId>.jsonl), append-only, local only — it never leaves the
// device. Payloads are ids and numbers, never message or passage text.
// The append is injected so the format and logger run headless in tests.

import { BaseDirectory, exists, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";

export type EventType =
  | "classroom-toggle" // { on: boolean }
  | "citation-click" // { kind: "page", page } | { kind: "paper", slug }
  | "page-nav" // { from, to, dwellMs } — dwell is time spent on the previous page
  | "call-start" // { threadId }
  | "call-end" // { threadId } — hangup
  | "distill-run" // { threadId, created, updated, deleted }
  | "prep-status" // { slug, status }
  | "memory-tab-open"; // {}

export type EventPayload = Record<string, string | number | boolean | null>;

// One event as a single JSON line (newline-terminated).
export function formatEventLine(type: EventType, payload: EventPayload, ts: number): string {
  return JSON.stringify({ ts, type, ...payload }) + "\n";
}

export type AppendFn = (topicId: string, line: string) => Promise<void>;

// A logger over an injected append. Fire-and-forget: instrumentation must never
// break the interaction it observes, so failures only warn.
export function createEventLogger(append: AppendFn, now: () => number = Date.now) {
  return (topicId: string, type: EventType, payload: EventPayload = {}): void => {
    void append(topicId, formatEventLine(type, payload, now())).catch((e) =>
      console.warn("failed to append event", e),
    );
  };
}

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

async function tauriAppend(topicId: string, line: string): Promise<void> {
  await ensureDir();
  await writeTextFile(`events-${topicId}.jsonl`, line, {
    baseDir: BaseDirectory.AppData,
    append: true,
  });
}

export const logEvent = createEventLogger(tauriAppend);
