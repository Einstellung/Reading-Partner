// Every conversation on disk, read as data rather than through the live store.
//
// platform/app/threads.ts is a debounced cache with a merge discipline of its
// own; a migration that went through it would be racing the reader's typing and
// would write files the reader is holding open. This reads the JSON, keeps
// every key it does not understand, and writes it back in the same shape the
// store writes it in ({ threads: {...} }, two-space indent) so an untouched
// file is byte-identical and a touched one differs only where it had to.

import type { MigrationFs } from "./types";

// A message with the keys this migration reads and everything else carried
// through untouched. The index signature is the point: a build that has never
// heard of `parts` must not be the thing that deletes them.
export interface StoredMessage {
  id?: string;
  role: string;
  ts: number;
  [key: string]: unknown;
}

export interface StoredThread {
  id?: string;
  parentThreadId?: string;
  messages: StoredMessage[];
  [key: string]: unknown;
}

export interface ThreadFile {
  path: string;
  threads: Record<string, StoredThread>;
}

export interface ThreadRef {
  threadId: string;
  thread: StoredThread;
  file: ThreadFile;
}

export interface ThreadIndex {
  files: ThreadFile[];
  // Thread id -> every thread carrying it. A LIST, because a thread id is not
  // unique across files: the info companion's daily briefing conversation is
  // the literal id "briefing" in threads-info-<date>.json, one file per day, and
  // 25 files on the owner's store hold one. Keying by id alone hid 67 of 614
  // messages from the backfill.
  byId: Map<string, ThreadRef[]>;
  // Message stamp -> the ids of the threads holding a message with that stamp.
  // The whole store, not one file: a repair that says "exactly one thread owns
  // this stamp" has to mean exactly one anywhere.
  threadsByTs: Map<number, string[]>;
  // Files whose bytes did not parse. Never rewritten, always reported.
  unreadable: string[];
}

const THREAD_FILE = /^threads-.+\.json$/;

export function serializeThreadFile(file: ThreadFile): string {
  return JSON.stringify({ threads: file.threads }, null, 2);
}

export async function loadThreads(fs: MigrationFs): Promise<ThreadIndex> {
  const index: ThreadIndex = {
    files: [],
    byId: new Map(),
    threadsByTs: new Map(),
    unreadable: [],
  };
  for (const name of (await fs.listDir("")).filter((n) => THREAD_FILE.test(n)).sort()) {
    const text = await fs.read(name);
    if (text === null) continue;
    let parsed: { threads?: Record<string, StoredThread> };
    try {
      parsed = JSON.parse(text) as { threads?: Record<string, StoredThread> };
    } catch {
      index.unreadable.push(name);
      continue;
    }
    const threads = parsed.threads ?? {};
    const file: ThreadFile = { path: name, threads };
    index.files.push(file);
    for (const [id, thread] of Object.entries(threads)) {
      if (!thread || !Array.isArray(thread.messages)) continue;
      // The map key is the thread's identity; the `id` field is kept for
      // readability of the file and is not what the store keys off.
      index.byId.set(id, [...(index.byId.get(id) ?? []), { threadId: id, thread, file }]);
      for (const message of thread.messages) {
        const holders = index.threadsByTs.get(message.ts);
        if (!holders) index.threadsByTs.set(message.ts, [id]);
        else if (!holders.includes(id)) holders.push(id);
      }
    }
  }
  return index;
}

export function holdsStamp(thread: StoredThread, ts: number): boolean {
  return thread.messages.some((m) => m.ts === ts);
}

// The threads carrying an id, and the ones of those that hold a given stamp.
export function threadsWithId(index: ThreadIndex, threadId: string): ThreadRef[] {
  return index.byId.get(threadId) ?? [];
}

export function holdersOfStamp(index: ThreadIndex, threadId: string, ts: number): ThreadRef[] {
  return threadsWithId(index, threadId).filter((ref) => holdsStamp(ref.thread, ts));
}

// Every message on the store, with the thread it is stored in. What the id
// backfill and the collision check both walk.
export function allMessages(
  index: ThreadIndex,
): { threadId: string; file: ThreadFile; message: StoredMessage }[] {
  const out: { threadId: string; file: ThreadFile; message: StoredMessage }[] = [];
  for (const refs of index.byId.values()) {
    for (const { threadId, thread, file } of refs) {
      for (const message of thread.messages) out.push({ threadId, file, message });
    }
  }
  return out;
}
