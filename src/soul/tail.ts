// The other half of what a turn replays (docs/61): not this conversation, but
// the last thing the reader and the soul said to each other anywhere.
//
// Every desk used to replay one history and nothing else, so the person who had
// spent an hour on a briefing walked into a book knowing none of it. The turn
// now replays two spans: the soul's tail, which is the most recent messages
// across every conversation the app holds whatever desk they were said over, and
// the item's own span, which is what the material in front of the reader carries.
// The item's span wins when they compete for the same forty messages — what is
// in front of the reader is what the turn is about.
//
// Each stretch is prefixed by one line saying what was on the desk while it was
// said, because otherwise the model reads a briefing and a book as one
// conversation that changed subject without anybody saying so. Those lines are
// derived through the catalogue and the conversation index; nothing here imports
// a domain, and a book's title is read off library.json the same way the topic
// resolution reads topics.json.

import type { ConversationIo } from "../conversations";
import type { DeskMessage } from "../desk";
import type { Rung } from "../budget";
import type { ConversationSpan } from "./sequence";

// How many messages one turn replays in total, the soul's tail and the item's
// span together. The same number reading/desk.ts has always trimmed a thread to
// (HISTORY_KEEP); held apart because a capability may not read a domain, and
// tests/soul/tail.test.ts holds the two equal.
export const TURN_KEEP = 40;

/**
 * The rung that gives the tail up. First on the ladder wherever there is one:
 * of everything a call carries it is the only part about no material at all, so
 * it goes before the turn starts cutting into what the reader said here. Silent
 * — the reader has no stake in whether a turn happened to remember last night's
 * briefing, and a note saying so on every tight turn would be noise.
 */
export const TAIL_RUNG: Rung<string> = { id: "soul-tail", price: "messages" };

export const TAIL_RUNG_ID = "soul-tail";

/** One stretch of one conversation, ready to be replayed. */
export interface TailSpan {
  span: ConversationSpan;
  /** The line that says what was on the desk, without its brackets. */
  label: string;
  messages: readonly TailMessage[];
}

export interface TailMessage {
  id?: string;
  role: "user" | "ai";
  text: string;
  ts: number;
}

// --- the desk line ---------------------------------------------------------

/**
 * What was on the desk, in one short line. Given the book titles the caller
 * could resolve; a book that is no longer on the shelf is named by nothing
 * rather than by its hash.
 */
export function deskLabel(span: ConversationSpan, bookTitles: ReadonlyMap<string, string>): string {
  switch (span.desk.on) {
    case "book": {
      const title = bookTitles.get(span.desk.id);
      return title ? `over the book: ${title}` : "over a book";
    }
    case "day":
      return `over the briefing of ${span.desk.id}`;
    case "retell":
      return "over a retelling";
    case "outline":
      return "over a talk";
    default:
      return "at the door";
  }
}

// --- assembling ------------------------------------------------------------

// A message's identity for the deduplication. The id where there is one; the
// thread and the stamp otherwise, which is the anchor form the rest of the app
// uses for a message written before ids existed (conversations/search.ts).
function identity(span: ConversationSpan, m: TailMessage): string {
  return m.id ? `#${m.id}` : `${span.fileKey}:${span.threadId}:${m.ts}`;
}

/**
 * The tail, as messages: the most recent `keep` messages across the stretches
 * given, in time order, each stretch opening with the line that says where it
 * was said.
 *
 * Pure. Trimmed from the front, so what falls out is the oldest; and a tail that
 * would open on a reply opens one message later instead, because every provider
 * wants the exchange to open on a user message and the item's span, which
 * follows this, has already been composed on that assumption.
 */
export function assembleTail(spans: readonly TailSpan[], keep: number): DeskMessage[] {
  if (keep <= 0) return [];
  const seen = new Set<string>();
  const flat: { span: ConversationSpan; label: string; m: TailMessage }[] = [];
  for (const s of spans) {
    for (const m of s.messages) {
      if (m.text === "") continue;
      const key = identity(s.span, m);
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push({ span: s.span, label: s.label, m });
    }
  }
  flat.sort((a, b) => a.m.ts - b.m.ts);
  let cut = flat.length > keep ? flat.slice(flat.length - keep) : flat;
  while (cut.length > 0 && cut[0]!.m.role !== "user") cut = cut.slice(1);

  const out: DeskMessage[] = [];
  let openedBy: string | null = null;
  for (const entry of cut) {
    const here = `${entry.span.fileKey} ${entry.span.threadId}`;
    const opens = here !== openedBy;
    openedBy = here;
    out.push({
      role: entry.m.role,
      text: opens ? `[${entry.label}]\n${entry.m.text}` : entry.m.text,
    });
  }
  return out;
}

// --- reading it off disk ---------------------------------------------------

const LIBRARY_FILE = "library.json";

/** The shelf's titles by book id, read off the catalogue's own file. */
export async function bookTitles(io: ConversationIo): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const text = await io.readText(LIBRARY_FILE);
  if (text === null) return titles;
  try {
    const parsed: unknown = JSON.parse(text);
    const books = (parsed as { books?: Record<string, { title?: unknown }> } | null)?.books;
    if (!books || typeof books !== "object") return titles;
    for (const [id, entry] of Object.entries(books)) {
      const title = entry?.title;
      if (typeof title === "string" && title !== "") titles.set(id, title);
    }
  } catch {
    return titles;
  }
  return titles;
}

export interface TailInput {
  spans: readonly ConversationSpan[];
  /** The conversation the turn is being held in. Never part of its own tail. */
  exclude: { fileKey: string; threadId: string };
  /** How many messages the tail may take, once the item's span has had its own. */
  keep: number;
  io: ConversationIo;
}

/**
 * The soul's tail for one turn. Reads only the most recent spans, and only as
 * many of them as `keep` could possibly draw from: a store of forty
 * conversations costs a handful of file reads, not forty.
 */
export async function soulTail(input: TailInput): Promise<DeskMessage[]> {
  const { spans, exclude, keep, io } = input;
  if (keep <= 0) return [];
  const recent = spans
    .filter(
      (s) =>
        s.messageCount > 0 &&
        !(s.fileKey === exclude.fileKey && s.threadId === exclude.threadId),
    )
    .slice(-Math.max(1, keep));
  if (recent.length === 0) return [];
  // Newest first, and stop as soon as the spans in hand can cover the tail.
  const wanted: ConversationSpan[] = [];
  let have = 0;
  for (let i = recent.length - 1; i >= 0 && have < keep; i -= 1) {
    const span = recent[i]!;
    wanted.push(span);
    have += span.messageCount;
  }
  wanted.reverse();

  const titles = await bookTitles(io);
  const byFile = new Map<string, TailMessage[] | null>();
  const loaded: TailSpan[] = [];
  for (const span of wanted) {
    let threads = byFile.get(`${span.fileKey} ${span.threadId}`);
    if (threads === undefined) {
      const found = (await io.peekThreads(span.fileKey)).find((t) => t.id === span.threadId);
      threads = found ? (found.messages as TailMessage[]) : null;
      byFile.set(`${span.fileKey} ${span.threadId}`, threads);
    }
    if (!threads) continue;
    loaded.push({
      span,
      label: deskLabel(span, titles),
      // Only the last `keep` of any one conversation can reach the tail.
      messages: threads.length > keep ? threads.slice(threads.length - keep) : threads,
    });
  }
  return assembleTail(loaded, keep);
}
