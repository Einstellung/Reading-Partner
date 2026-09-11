// The door (docs/61): a conversation the reader has with the soul while nothing
// is on the desk. They are standing at the door, not sitting at it — no book, no
// briefing, no talk, just the person and whatever they came to say.
//
// One file per day (palace kind "conversation", conversation-<date>.json), the
// same ownership rule every other conversation follows: a book's conversation
// lives in the book's file and dies with the book, a day's briefing lives in the
// day's file, and a conversation that belongs to no material lives in the day it
// was held. Nothing else owns it, so nothing else can take it away.
//
// The turn is the same assembly as every other one, over an empty desk: the soul
// brings its statements and its tools, no item brings a prompt, and the
// conversation is replayed from the messages the caller passes in. No interaction
// is wired to this yet.

import { openDesk, type DeskEnv, type DeskMessage } from "../desk";
import { registerDistillSource, type SourceUnit } from "../memory";
import { resolvePalace } from "../palace";
import { appData } from "../platform/app/appdata";
import { loadThreads, peekThreads } from "../platform/app/threads";
import type { Settings } from "../platform/app/settings";
import type { BudgetPurpose } from "../budget";
import { assembleTurn, type AssembledTurn } from "./turn";

/** The palace kind the door's files are catalogued under. */
export const DOOR_KIND = "conversation";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The day a conversation at the door is filed under, in the reader's own zone. */
export function doorDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The thread store's key for a day at the door. The store writes it to
 * conversation-<date>.json: the key keeps the prefix that says whose it is, and
 * the file is named for what it holds (platform/app/threads.ts).
 */
export function doorKey(date: string): string {
  return `door-${date}`;
}

/** What a day's conversations are called where a book's name would go. */
export function doorLabel(date: string): string {
  return `At the door ${date}`;
}

export interface DoorTurnInput {
  settings: Settings;
  /** The conversation being held. Created by the caller before the turn. */
  threadId: string;
  /** The day it is filed under. Today unless a caller is replaying an old one. */
  date?: string;
  /** The conversation so far, in the order it was said. */
  messages?: readonly DeskMessage[];
  purpose?: BudgetPurpose;
  signal?: AbortSignal;
}

/**
 * Assemble one turn held at the door. Null when the signal aborted while the
 * soul was being read.
 */
export async function openDoorTurn(input: DoorTurnInput): Promise<AssembledTurn | null> {
  const date = input.date ?? doorDate();
  const key = doorKey(date);
  // Load the day's file so the assembly can read this conversation off the store
  // — its messages, and whatever topic it has been filed under (soul/self.ts).
  await loadThreads(key).catch(() => ({}));
  const env: DeskEnv = {
    settings: input.settings,
    thread: { key, id: input.threadId },
    ...(input.signal ? { signal: input.signal } : {}),
  };
  const desk = await openDesk([], env);
  return assembleTurn({
    desk,
    messages: input.messages ?? [],
    ...(input.purpose ? { purpose: input.purpose } : {}),
  });
}

/** Every conversation held at the door, oldest day first. */
export async function listDoorUnits(): Promise<SourceUnit[]> {
  const entries = await appData.readDir(".").catch(() => []);
  const dates: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile) continue;
    const hit = resolvePalace(entry.name);
    if (hit?.row.kind !== DOOR_KIND || !hit.id) continue;
    dates.push(hit.id);
  }
  dates.sort();

  const units: SourceUnit[] = [];
  for (const date of dates) {
    for (const thread of await peekThreads(doorKey(date)).catch(() => [])) {
      if (thread.messages.length === 0) continue;
      units.push({
        id: thread.id,
        // Whatever the conversation settled on, and null until it settles one:
        // nothing was on the desk to say what this is about. A unit with no
        // topic is not distilled — there is no topic to file the observation
        // under, and the brief topic is the info page's, not the door's.
        topicId: thread.topicId ?? null,
        label: doorLabel(date),
        messages: thread.messages.map(({ id, role, text, ts }) => ({
          ...(id ? { id } : {}),
          role,
          text,
          ts,
        })),
      });
    }
  }
  return units;
}

/**
 * Register the door conversations as a distillation source. For the shell to
 * call on the way up; the undo is for tests.
 */
export function registerDoorDistillSource(): () => void {
  return registerDistillSource({
    kind: DOOR_KIND,
    listUnits: listDoorUnits,
    cursor: "distilledMessages",
    afterEnd: "keep",
  });
}
