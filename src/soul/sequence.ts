// The soul's continuity, in time order (docs/61): every conversation the app
// holds, cut into spans and laid end to end.
//
// A span is one thread of one file: when it started, when it was last spoken
// in, how many messages it holds, what topic it is filed under, and what was on
// the desk while it was held. That last field is what the index exists for — the
// person is one person across a book, a briefing and the door, and "what did I
// say yesterday" is a question about time, not about which file it landed in.
//
// It is derived. Everything here is rebuildable by scanning the conversation
// files (src/conversations walks them), so the file it is kept in is a cache and
// nothing but a cache: it does not sync, losing it costs one rebuild, and a
// stale one is detected rather than trusted. Syncing it would be worse than
// useless — the spans describe this device's files and would arrive describing
// another's.

import {
  appConversationIo,
  memoizeIo,
  topicOfThreadFile,
  walkThreadFiles,
  type ConversationIo,
  type ThreadFile,
  type TopicCarrier,
} from "../conversations";
import { appData } from "../platform/app/appdata";
import { threadKind, type Thread } from "../platform/app/threads";

/** Where a span was held, as the palace names the material. */
export type DeskOf =
  | { on: "book"; id: string }
  | { on: "day"; id: string }
  | { on: "retell"; id: string }
  | { on: "outline"; id: string }
  | { on: "none"; id: "" };

/** What kind of conversation a span is. The three reading doors, then the rest. */
export type SpanKind = "book" | "mark" | "aside" | "info" | "retell" | "talk" | "door";

export interface ConversationSpan {
  /**
   * The thread file's store key, and the thread's id inside it. A thread id is
   * only unique within its file (docs/pitfall/209), so both are the identity.
   */
  fileKey: string;
  threadId: string;
  kind: SpanKind;
  /** The first and last message's stamps. 0 for a thread with no messages. */
  firstTs: number;
  lastTs: number;
  messageCount: number;
  topicId: string | null;
  desk: DeskOf;
}

/** The file's own bookkeeping, so a rebuild after a format change is automatic. */
export const SEQUENCE_VERSION = 1;
export const SEQUENCE_FILE = "soul-sequence.json";

/** File name to last-modified time, unix ms: what the spans were read off. */
export type Stamp = Record<string, number>;

export interface Sequence {
  version: number;
  stamp: Stamp;
  /** Oldest last-spoken-in first. */
  spans: ConversationSpan[];
}

export const EMPTY_SEQUENCE: Sequence = { version: SEQUENCE_VERSION, stamp: {}, spans: [] };

// --- deriving --------------------------------------------------------------

function after(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/** What was on the desk while a file's conversations were held. */
export function deskOfFile(file: Pick<ThreadFile, "kind" | "fileKey">): DeskOf {
  switch (file.kind) {
    case "reading-thread":
      return { on: "book", id: file.fileKey };
    case "info-thread":
      return { on: "day", id: after(file.fileKey, "info-") };
    case "retell-thread":
      return { on: "retell", id: after(file.fileKey, "retell-") };
    case "talk-thread":
      return { on: "outline", id: after(file.fileKey, "talk-") };
    default:
      return { on: "none", id: "" };
  }
}

/**
 * The span one thread of one file makes. Pure: everything it needs about the
 * world — which topic, which file — is resolved by the caller.
 */
export function spanOf(
  file: Pick<ThreadFile, "kind" | "fileKey">,
  thread: Thread,
  topicId: string | null,
): ConversationSpan {
  const stamps = (thread.messages ?? [])
    .map((m) => m.ts)
    .filter((ts) => typeof ts === "number" && Number.isFinite(ts));
  const kind: SpanKind =
    file.kind === "reading-thread"
      ? threadKind(thread)
      : file.kind === "info-thread"
        ? "info"
        : file.kind === "retell-thread"
          ? "retell"
          : file.kind === "talk-thread"
            ? "talk"
            : "door";
  return {
    fileKey: file.fileKey,
    threadId: thread.id,
    kind,
    firstTs: stamps.length ? Math.min(...stamps) : 0,
    lastTs: stamps.length ? Math.max(...stamps) : 0,
    messageCount: thread.messages?.length ?? 0,
    topicId,
    desk: deskOfFile(file),
  };
}

/**
 * Time order, and the same order every time: oldest conversation first, and two
 * spans last spoken in at the same instant ordered by their identity rather
 * than by whatever the directory listing happened to say.
 */
export function orderSpans(spans: readonly ConversationSpan[]): ConversationSpan[] {
  return [...spans].sort(
    (a, b) =>
      a.lastTs - b.lastTs ||
      a.firstTs - b.firstTs ||
      (a.fileKey < b.fileKey ? -1 : a.fileKey > b.fileKey ? 1 : 0) ||
      (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0),
  );
}

// --- staleness -------------------------------------------------------------

/**
 * Whether an index still describes the files on disk: the same names, the same
 * modification times. A thread file is written debounced and atomically, so its
 * mtime moves whenever a message lands in it — which is the whole of what this
 * has to notice.
 */
export function isStale(seq: Sequence, now: Stamp): boolean {
  if (seq.version !== SEQUENCE_VERSION) return true;
  const was = Object.keys(seq.stamp);
  const is = Object.keys(now);
  if (was.length !== is.length) return true;
  for (const name of is) if (seq.stamp[name] !== now[name]) return true;
  return false;
}

// --- the io ----------------------------------------------------------------

export interface SequenceIo {
  conversations: ConversationIo;
  /** A file's last-modified time in unix ms, or null when it is not there. */
  mtime(path: string): Promise<number | null>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
}

export const appSequenceIo: SequenceIo = {
  conversations: appConversationIo,
  async mtime(path) {
    const info = await appData.stat(path).catch(() => null);
    return info ? info.mtimeMs : null;
  },
  readText: (path) => appConversationIo.readText(path),
  writeText: (path, text) => appData.writeAtomic(path, text),
};

// --- reading and rebuilding ------------------------------------------------

/** The modification times of every conversation file on disk, right now. */
export async function currentStamp(io: SequenceIo): Promise<Stamp> {
  const stamp: Stamp = {};
  for await (const file of walkThreadFiles(io.conversations)) {
    stamp[file.name] = (await io.mtime(file.name)) ?? 0;
  }
  return stamp;
}

/** Scan every conversation file and build the index from scratch. */
export async function rebuildSequence(io: SequenceIo): Promise<Sequence> {
  const disk = memoizeIo(io.conversations);
  const spans: ConversationSpan[] = [];
  const stamp: Stamp = {};
  for await (const file of walkThreadFiles(disk)) {
    stamp[file.name] = (await io.mtime(file.name)) ?? 0;
    for (const thread of file.threads) {
      const topicId = await topicOfThreadFile(file.fileKey, disk, thread as TopicCarrier);
      spans.push(spanOf(file, thread, topicId));
    }
  }
  return { version: SEQUENCE_VERSION, stamp, spans: orderSpans(spans) };
}

function parse(text: string | null): Sequence | null {
  if (text === null) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (raw === null || typeof raw !== "object") return null;
    const seq = raw as Partial<Sequence>;
    if (typeof seq.version !== "number" || !Array.isArray(seq.spans)) return null;
    return {
      version: seq.version,
      stamp: seq.stamp && typeof seq.stamp === "object" ? seq.stamp : {},
      spans: seq.spans,
    };
  } catch {
    return null;
  }
}

/**
 * The index, rebuilt when the cache is missing, unreadable, from another
 * version, or behind the files. A rebuild is written back; a failed write is
 * swallowed, because the answer is already in hand and the only cost is
 * rebuilding again next time.
 *
 * The thread store offers no change hook a capability could subscribe to
 * without the store learning about the soul, so this is where staying current
 * happens: a stamp check per call, and a full scan only when it fails.
 */
export async function readSequence(io: SequenceIo = appSequenceIo): Promise<Sequence> {
  const stamp = await currentStamp(io);
  const held = parse(await io.readText(SEQUENCE_FILE));
  if (held && !isStale(held, stamp)) return held;
  const fresh = await rebuildSequence(io);
  await io.writeText(SEQUENCE_FILE, JSON.stringify(fresh)).catch(() => {});
  return fresh;
}
