// Append-only feedback log (docs/16): every reaction the reader gives a briefing
// item is one JSONL line. Future triage reads the tail so the profile learns
// from behavior, not just the written profile. Persisted to
// AppData/info-feedback.jsonl and synced between devices.
//
// Append-only is the format, not the write: plugin-fs has no append mode, so
// every reaction rewrites the whole file, and a rewrite standing in for a failed
// read truncated the log to its one new line. Nor does the merge put the rest
// back — it is a union only without a base, and with one, lines this device no
// longer has are deletes (platform/sync/merge/records.ts). So readLogText
// answers "" for a file that is not there and null for one that would not open,
// and appendFeedback writes nothing on null.

import {
  BaseDirectory,
  exists,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../../platform/app/atomic-fs";

export const FEEDBACK_FILE = "info-feedback.jsonl";

// Feedback events (append-only info-feedback.jsonl). "opened" fires from the
// article view, "dismissed" from a card's ×, "appealed" from Filtered's
// "Show anyway".
export type FeedbackAction = "opened" | "dismissed" | "appealed";

export interface FeedbackEvent {
  ts: number;
  itemId: string;
  title: string;
  action: FeedbackAction;
  // The item's filtered/dismissal category when the event carries one.
  category?: string;
}

// Parse a JSONL blob into events, skipping malformed lines (a half-written line
// must not sink the whole log). Exported for tests.
export function parseFeedbackLog(text: string): FeedbackEvent[] {
  const out: FeedbackEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as FeedbackEvent;
      if (e && typeof e.itemId === "string" && typeof e.action === "string") out.push(e);
    } catch {
      // Skip a corrupt line.
    }
  }
  return out;
}

// The log as it stands on disk: "" when there is no file yet, and null when it
// is there and could not be read. The two are not the same answer, and the
// difference is the whole of appendFeedback's safety — see readGuardedJson in
// platform/app/atomic-fs.ts, the JSON-shaped version of this distinction.
async function readLogText(): Promise<string | null> {
  try {
    if (!(await exists(FEEDBACK_FILE, { baseDir: BaseDirectory.AppData }))) return "";
    return await readTextFile(FEEDBACK_FILE, { baseDir: BaseDirectory.AppData });
  } catch (e) {
    console.warn(`failed to read ${FEEDBACK_FILE}`, e);
    return null;
  }
}

export async function loadFeedback(): Promise<FeedbackEvent[]> {
  return parseFeedbackLog((await readLogText()) ?? "");
}

// Append one event. Read-modify-write rather than a true append (plugin-fs has no
// append mode); the log is small (one day's reactions) so this is cheap.
export async function appendFeedback(event: {
  itemId: string;
  title: string;
  action: FeedbackAction;
  category?: string;
}): Promise<void> {
  const full: FeedbackEvent = { ts: Date.now(), ...event };
  const prior = await readLogText();
  // A file that could not be read is not an empty one. This write replaces the
  // whole file (plugin-fs has no append mode), so carrying on with "" would put
  // this single line where the reader's whole attention log was, and sync does
  // not put it back: the line merge is a union only when there is no base, and
  // with one a line the base has and this device dropped is a delete that takes
  // it off the other device too (platform/sync/merge/records.ts). Skipping one
  // reaction is the smaller loss, and the next one writes again.
  if (prior === null) return;
  // Bad bytes are kept verbatim: a half-written line is one line parseFeedbackLog
  // skips, not a reason to rewrite the file.
  const body = (prior && !prior.endsWith("\n") ? prior + "\n" : prior) + JSON.stringify(full) + "\n";
  await writeTextAtomic(FEEDBACK_FILE, body);
}
