// Append-only feedback log (docs/16): every reaction the reader gives a briefing
// item is one JSONL line. Future triage reads the tail so the profile learns
// from behavior, not just the written profile. Synced between devices (append-
// only, so a merge is a union). Persisted to AppData/info-feedback.jsonl.

import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { FeedbackAction, FeedbackEvent } from "../info/briefing/types";

export const FEEDBACK_FILE = "info-feedback.jsonl";

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

export async function loadFeedback(): Promise<FeedbackEvent[]> {
  try {
    if (!(await exists(FEEDBACK_FILE, { baseDir: BaseDirectory.AppData }))) return [];
    return parseFeedbackLog(await readTextFile(FEEDBACK_FILE, { baseDir: BaseDirectory.AppData }));
  } catch {
    return [];
  }
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
  let prior = "";
  try {
    if (await exists(FEEDBACK_FILE, { baseDir: BaseDirectory.AppData })) {
      prior = await readTextFile(FEEDBACK_FILE, { baseDir: BaseDirectory.AppData });
    }
  } catch {
    prior = "";
  }
  const body = (prior && !prior.endsWith("\n") ? prior + "\n" : prior) + JSON.stringify(full) + "\n";
  await writeTextFile(FEEDBACK_FILE, body, { baseDir: BaseDirectory.AppData });
}
