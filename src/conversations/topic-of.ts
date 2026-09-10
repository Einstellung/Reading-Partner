// Which topic a conversation belongs to.
//
// Four kinds of thread file exist (src/palace) and no two of them say it the
// same way, because none of them was written to be searched across:
//
//   reading-thread  the file key is the book id, and the topic is whichever one
//                   holds a file with that content hash (topics.json)
//   info-thread     the thread carries its own topic id; a day's briefing that
//                   was never assigned one belongs to the brief topic
//   retell-thread   the file key names a retell, and the retell says its topic
//   talk-thread     the file key names an outline, the outline names the retell
//                   it came from, and the retell says the topic
//
// Read here rather than asked of each domain, so that nothing in this capability
// has to know what a book or a retell is. The files are read as JSON and one
// field is taken off each; the domains own the shapes, and a shape that changed
// under this would show up as an unresolved topic, never as a wrong one.

import { resolvePalace, rowOf, type PalaceKind } from "../palace";
import { TOPICS_FILE } from "../platform/app/topics";
import { threadFileName, type ConversationIo } from "./io";

/** The kinds of file that hold a conversation. */
export const THREAD_KINDS = [
  "reading-thread",
  "retell-thread",
  "talk-thread",
  "info-thread",
] as const;

export type ThreadKind = (typeof THREAD_KINDS)[number];

const THREAD_KIND_SET: ReadonlySet<string> = new Set(THREAD_KINDS);

/** The thread kind a file name belongs to, or null when it holds no conversation. */
export function threadKindOf(name: string): ThreadKind | null {
  const hit = resolvePalace(name);
  if (!hit || !THREAD_KIND_SET.has(hit.row.kind)) return null;
  return hit.row.kind as ThreadKind;
}

// What a thread contributes to the answer. Structural rather than the store's
// Thread, because the field is optional today and arrives with the topic work:
// an info thread written before it exists reads as the brief topic, which is
// where those conversations were.
export interface TopicCarrier {
  topicId?: string;
}

async function readJson(path: string, io: ConversationIo): Promise<Record<string, unknown> | null> {
  const text = await io.readText(path);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// The file one of the id-keyed rows names, so the naming stays in the catalogue.
function pathOf(kind: PalaceKind, id: string): string {
  const row = rowOf(kind);
  if (!row.pathFor) throw new Error(`palace: ${kind} has no path for an id`);
  return row.pathFor(id);
}

async function topicOfRetell(retellId: string, io: ConversationIo): Promise<string | null> {
  const retell = await readJson(pathOf("retell", retellId), io);
  return retell ? str(retell.topicId) : null;
}

/**
 * The topic a thread file's conversation is filed under, or null when nothing
 * says: the book is in no topic, the retell is gone, the outline was brought in
 * from outside a retell.
 *
 * `thread` is the conversation itself where the file keeps one topic per thread
 * rather than one per file, which today is the info briefings alone.
 */
export async function topicOfThreadFile(
  fileKey: string,
  io: ConversationIo,
  thread?: TopicCarrier,
): Promise<string | null> {
  const kind = threadKindOf(threadFileName(fileKey));
  if (!kind) return null;
  // An info conversation is filed under its own topic once the reader has
  // confirmed one, and under none until then (docs/21).
  if (kind === "info-thread") return thread?.topicId ?? null;
  if (kind === "retell-thread") {
    return topicOfRetell(fileKey.slice("retell-".length), io);
  }
  if (kind === "talk-thread") {
    const outline = await readJson(pathOf("outline", fileKey.slice("talk-".length)), io);
    const retellId = outline ? str(outline.retellId) : null;
    return retellId ? topicOfRetell(retellId, io) : null;
  }
  // A reading thread. The file key is the book id, and the topic is the one
  // listing a file with that hash. A book can sit in more than one topic in
  // principle; the first is taken, which is the order topics.json is written in.
  const topics = await readJson(TOPICS_FILE, io);
  const rows = Array.isArray(topics?.topics) ? (topics.topics as unknown[]) : [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const topic = row as { id?: unknown; files?: unknown };
    const files = Array.isArray(topic.files) ? topic.files : [];
    const holds = files.some(
      (f) => f !== null && typeof f === "object" && (f as { hash?: unknown }).hash === fileKey,
    );
    if (holds) return str(topic.id);
  }
  return null;
}
