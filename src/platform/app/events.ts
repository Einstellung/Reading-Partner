// Local event log (M8): one JSONL file per topic under AppData
// (events-<topicId>.jsonl), append-only, local only — it never leaves the
// device. Payloads are ids and numbers, never message or passage text.
// The append is injected so the format and logger run headless in tests.
// This is the one writer that stays on the fs plugin: an O_APPEND of one short
// line is already all-or-nothing, and the atomic writer would have to rewrite
// the whole log to add a line.

import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";

export type EventType =
  | "classroom-toggle" // { on: boolean }
  | "talk-start" // { talkId, materials } — a talk was started (docs/31)
  | "talk-open" // { talkId } — a talk was opened from the topic's list
  | "citation-click" // { kind: "page", page } | { kind: "paper", slug }
  | "page-nav" // { from, to, dwellMs } — dwell is time spent on the previous page
  | "call-start" // { threadId }
  | "call-end" // { threadId } — hangup
  | "thread-delete" // { threadId, book } — conversation deleted (and its mark, if any)
  // A pass that finished. `trigger` is what set it going (hangup, trim, timer,
  // startup, foreground, book-switch, talk-exit). A transcript pass carries the
  // threadId, a silent-marking pass the bookId, a rehearsal's pass (docs/31) also
  // { talkId, messages } — which talk it was and how many messages it covered.
  | "distill-run" // { trigger, threadId?, bookId?, created, updated, deleted, talkId?, messages? }
  // A distillation pass that did not finish, so nothing was observed and its
  // cursors did not advance. `outcome` is the sub-agent's (src/ai/subagent), e.g.
  // "out-of-turns" or "failed".
  | "distill-failed" // { trigger, threadId?, bookId?, outcome, created?, updated?, deleted?, talkId? }
  // A profile-guess pass that finished (observation/guess.ts), in events-ai.jsonl
  // rather than a topic's log: the pass looks across every topic at once.
  // `wrote` says whether the guess section actually changed.
  | "guess-run" // { trigger, wrote, guesses, dropped }
  // One that did not, so the profile was left alone and the stamp did not move.
  // `outcome` is the sub-agent's, or a skip reason from before the model ran.
  | "guess-failed" // { trigger, outcome }
  // Where a briefing run's wall clock went, in events-info.jsonl rather than a
  // topic's log: a briefing belongs to no book. One line per source as it
  // settles, one for the triage call.
  | "info-collect" // { source, ms, items, ok }
  | "info-triage" // { ms, items, ok }
  | "prep-status" // { slug, status }
  | "notes-run" // { phase: "start" | "done" | "failed" }
  | "notes-chapter-regenerate" // { index }
  | "notes-tab-open" // {}
  // One attempt at reading a model's machine-readable output, in
  // events-ai.jsonl rather than a topic's log. See structured-output.ts for the
  // fields and for why it has no topic.
  | "structured-parse";

// The reserved topic id the briefing's timing lines are filed under:
// events-info.jsonl. Topic ids are UUIDs, so this cannot collide with one —
// same arrangement as the "ai" id in structured-output.ts.
export const INFO_EVENT_TOPIC = "info";

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

// Outside Tauri (unit tests, the plain-browser dev server) there is no AppData
// to append to. Dropping the line beats warning once per event, now that the
// unattended pipelines log one on every structured parse.
async function tauriAppend(topicId: string, line: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  await writeTextFile(`events-${topicId}.jsonl`, line, {
    baseDir: BaseDirectory.AppData,
    append: true,
  });
}

export const logEvent = createEventLogger(tauriAppend);
