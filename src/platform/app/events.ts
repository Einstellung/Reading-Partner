// Local event log (M8): one JSONL file per topic under AppData
// (events-<topicId>.jsonl), append-only, local only — it never leaves the
// device. Payloads are ids and numbers, never message or passage text.
// The append is injected so the format and logger run headless in tests.
// This is the one writer that stays on the fs plugin: an O_APPEND of one short
// line is already all-or-nothing, and the atomic writer would have to rewrite
// the whole log to add a line.

import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "./host";

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
  // cursors did not advance. `stage` is how far it got and `reason` is the one
  // category the failure sorts into; `outcome` is the sub-agent's
  // (src/ai/subagent) and is null when the pass never reached a run. `from`/`to`
  // are the message indexes the pass would have moved the cursor over and
  // `fromTs`/`toTs` the timestamps at the ends of that stretch — which is the
  // stretch a later pass has to redo. Fields and the classifier are in
  // observation/distill/distill.ts (distillFailurePayload).
  | "distill-failed" // { trigger, threadId?, bookId?, talkId?, stage, reason, outcome, from, to, fromTs, toTs, created, updated, deleted }
  // A profile-guess pass that finished (observation/profile/guess.ts), in events-ai.jsonl
  // rather than a topic's log: the pass looks across every topic at once.
  // `wrote` says whether the guess section actually changed.
  | "guess-run" // { trigger, wrote, guesses, dropped }
  // One that did not, so the profile was left alone and the stamp did not move.
  // `outcome` is the sub-agent's, or a skip reason from before the model ran.
  | "guess-failed" // { trigger, outcome }
  // Where a briefing run's wall clock went, in events-info.jsonl rather than a
  // topic's log: a briefing belongs to no book. One line per source as it is
  // discovered, then one per funnel phase (docs/35) — so "why did that take four
  // minutes" is answerable both by source and by stage.
  | "info-collect" // { source, ms, items, ok } — one source's discovery
  | "info-poll" // { ms, sources, added, pool } — one background collection cycle
  | "info-discover" // { ms, sources, items, pooled }
  | "info-screen" // { ms, items, batches, kept, dropped, cappedOut }
  | "info-material" // { ms, items, fetched }
  | "info-triage" // { ms, items, ok }
  | "prep-status" // { slug, status }
  | "notes-run" // { phase: "start" | "done" | "failed" }
  | "notes-chapter-regenerate" // { index }
  // The reader opened the Prep tab. Its old name was "notes-tab-open", from
  // when the two kinds of prep material had a tab each.
  | "prep-tab-open" // {}
  // The reader opened a topic's AI observations. The one face of the observation
  // machinery they can look at, and until this line nothing said whether they
  // ever did.
  | "observations-open" // {}
  // One attempt at reading a model's machine-readable output, in
  // events-ai.jsonl rather than a topic's log. See structured-output.ts for the
  // fields and for why it has no topic.
  | "structured-parse"
  // What prompt caching did on one model turn, in the same log and for the same
  // reason: a turn belongs to a face of the app, not to a book. See
  // cache-telemetry.ts for the fields and for why the gap to the previous turn
  // on the same thread is one of them.
  | "prompt-cache"
  // A reading turn that rendered the pages around the reader's highlight and
  // sent them as images (reading/figures/page-window.ts), in events-ai.jsonl
  // beside the cache line. `tokens` is what the pictures cost the request, which
  // is the number that decides whether the gate is drawn in the right place;
  // `sent` is false when the budget ladder took the window back off the call
  // after it was rendered.
  | "page-window"; // { thread, gate, anchor, from, to, pages, tokens, px, sent }

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
  if (!isTauri()) return;
  await writeTextFile(`events-${topicId}.jsonl`, line, {
    baseDir: BaseDirectory.AppData,
    append: true,
  });
}

export const logEvent = createEventLogger(tauriAppend);
