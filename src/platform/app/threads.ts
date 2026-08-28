// AI-pen conversation threads, one file per document: threads-<bookId>.json,
// keyed by the book's content hash (library.ts).
// This is the seed of the "conversation stream" tier (docs/01 §3, first layer);
// the format is intentionally small but the field names are the durable ones.
// Writes go through the shared debounced writer (debounced-writer.ts): they
// coalesce, they are flushed on the way out of the app, and failures are
// surfaced (pitfall 09).
//
// The one rule this store exists to keep: a write never replaces a file this
// process has not read. Every write re-reads the file it is about to replace
// and merges what it holds onto what is there, so no path — not one that starts
// from an empty map, not one that runs while the cache is being refreshed — can
// turn a conversation history into a one-thread file. What that looked like
// when it was possible is in tests/threads-store.test.ts, and why it is written
// down at all is in docs/13.
//
// The second rule follows from the first, because every write now spans two
// awaits with the user still typing across them: nothing computed before an
// await is ever assigned back over the cache afterwards. What comes back is
// added to the live entry, key by key, and only where the entry has no opinion
// (addMissing); whether the file it came from is still the file being compared
// against is decided by Entry.gen. Snapshot-then-assign is how a conversation
// created during a write disappeared out from under the button that opened it.
//
// Everything the store reaches outside itself is passed in (same shape as
// annotations.ts and settings.ts), so a test can run the real store against an
// in-memory file on a fake clock instead of rewriting the module registry for
// every other test sharing the worker (pitfall 119).

import { appData } from "./appdata";
import { quarantineFile, writeTextAtomic, type CorruptFileReport } from "./atomic-fs";
import {
  createDebouncedWriter,
  type DebouncedWriter,
  type WriterTimer,
} from "./debounced-writer";
import { reportStoreError } from "./store-errors";

// A durable message part (the persisted projection of the UI's ChatPart, in
// src/ui/components/chatParts.ts). Only durable parts reach disk: text, and a card
// whose kind is worth keeping (the confirm card, the briefing-ready card). The
// tool trace and the transient briefing progress/failure cards are never stored.
// The card payload is kept opaque here so persistence does not depend on the info
// domain; the UI casts it back to its payload type on rehydrate.
export type PersistedCardPayload = { kind: string } & Record<string, unknown>;
export type PersistedPart =
  | { type: "text"; text: string }
  | { type: "card"; id: string; card: PersistedCardPayload };

export interface ThreadMessage {
  role: "user" | "ai";
  text: string;
  ts: number;
  // Filenames of attached images under images/threads/<threadId>/, e.g.
  // "1720000000000-0.png". Kept out of the thread JSON body so the file stays
  // small (same reasoning as image annotations, pitfall 07); the base64 is read
  // back on demand for display and for resending to the model.
  images?: string[];
  // The durable message-parts structure. Absent on plain text turns and on files
  // written before parts existed — a reader then falls back to `text` alone, so
  // old { role, text, ts } messages keep loading unchanged.
  parts?: PersistedPart[];
}

// Where a chat-span aside was pulled out of: the parent AI message, and the
// words the reader selected in it.
//
// The TEXT, never a character offset. linkifyCitations rewrites a message's
// source before react-markdown parses it, so a DOM offset taken off the rendered
// reply does not index `message.text` and would point at the wrong words — or
// past the end of a shorter one — on the next read.
export interface AsideAnchor {
  // The ts of the parent message the span came from, which is how the parent's
  // history is cut for the aside's turn (reading/aside.ts).
  messageTs: number;
  // The selection, verbatim.
  text: string;
}

export interface Thread {
  id: string;
  // The AI-pen mark this thread is anchored on. Empty string for the one
  // book-level thread (docs/03: the top-bar AI button, no selection), which is
  // marked by `book` instead, and for an aside pulled out of a chat message.
  annotationId: string;
  // The single persistent per-book thread reached from the top-bar AI button.
  // Absent (undefined) on ordinary mark-anchored threads, and never set on an
  // aside — the top-bar button finds the lesson by this field, and an aside
  // carrying it would be what the button reopens.
  book?: boolean;
  // The thread this aside branched off (docs/03). Present only on asides, which
  // are one level deep: an aside never gets one of its own. Absent on every
  // thread written before asides existed, and a sync pull from an older device
  // carries records without it — the same additive discipline as `focusChapter`.
  parentThreadId?: string;
  // The span a chat-span aside was opened on. Absent on a mark-anchored aside,
  // whose anchor is the annotation, exactly as on an ordinary mark thread.
  asideAnchor?: AsideAnchor;
  // The book id (content hash) this thread belongs to. Kept for readability of
  // the on-disk file; the store keys off the filename, not this field.
  path: string;
  createdAt: number;
  messages: ThreadMessage[];
  // The chapter this conversation is parked on (docs/09), by the number printed
  // in the book. Absent on every thread that has none, which is most of them and
  // all of the ones written before this existed — a sync pull from an older
  // device carries records without it and nothing here may mind.
  //
  // Only the book-level thread ever gets one. A marked passage's conversation
  // can be asked to teach chapter 3 and will, but it stays a conversation about
  // the mark, so nothing is written down.
  focusChapter?: number;
}

type ThreadMap = Record<string, Thread>;

// The three doors into a conversation (docs/03), derived rather than stored.
// `annotationId === ""` and `book === true` were one binary between them and
// cannot say which of three a record is, so every reader of that binary asks
// this instead — an aside must never be taken for the lesson.
export type ThreadKind = "book" | "mark" | "aside";

// The parent link is read first, and both halves of it count: an aside must
// answer "aside" even when the field the store keys off has been lost, because
// the alternative answer for one with no mark is "book".
export function threadKind(
  t: Pick<Thread, "annotationId" | "book" | "parentThreadId" | "asideAnchor">,
): ThreadKind {
  if (t.parentThreadId || t.asideAnchor) return "aside";
  if (t.book) return "book";
  return t.annotationId === "" ? "book" : "mark";
}

const SAVE_DEBOUNCE = 500;

function fileFor(bookId: string): string {
  return `threads-${bookId}.json`;
}

export interface ThreadIo {
  // The file's text, or null when there is none. A read that fails for any
  // other reason throws, so the caller — and the writer — can tell the
  // difference between "no file yet" and "could not be read".
  read: (file: string) => Promise<string | null>;
  write: (file: string, contents: string) => Promise<void>;
  // Move a file whose bytes will not parse aside, answering with its new name.
  // Required rather than optional: without it the writer's only honest choice is
  // to refuse, and refusing is permanent — every message of the session after
  // the file went bad is dropped on the floor. atomic-fs's rule, applied here:
  // the fallback is never destructive because the bad bytes are kept first.
  quarantine: (file: string) => Promise<string | null>;
  onError?: (e: unknown) => void;
  // A file whose bytes were moved aside. Reported apart from onError because it
  // is a different sentence: the write did land, and what the user lost is the
  // history that was in the file, not the message they just sent.
  onCorrupt?: (report: CorruptFileReport) => void;
  timer?: WriterTimer;
  exit?: (onExit: () => void) => void;
}

// What the store holds for one file.
interface Entry {
  threads: ThreadMap;
  // The deletions this process owes the file. The merge adds back anything on
  // disk that is not in `threads`, so a thread deleted here has to be named or
  // it comes straight back. Never emptied: it is also what stops a read issued
  // before a delete and answered after it from resurrecting the thread, and a
  // set of ids the user deleted in one session costs nothing to keep.
  removed: Set<string>;
  // Whether this entry has ever been reconciled with the file — set by a load
  // and by every write that merged the file in. Only a reconciled entry may be
  // written without reading first, which is what the way out of the app does.
  reconciled: boolean;
  // Bumped by every change to this entry and twice by every write — once when
  // it starts and once when it is over, however it ended. An operation that
  // reads the file takes this number before its first await and compares it
  // after: an unchanged number is the only proof that what came back still
  // describes the entry it is about to be applied to. One bump is not enough,
  // because a read can outlive the whole write and land where `writing` and
  // `isPending` have both gone quiet again.
  gen: number;
}

// What an aside is created with. An object rather than a fourth positional
// boolean beside `annotationId` and `book`: which of these a caller means is not
// readable from its position, and the two flavours differ by which of them is
// filled in.
export interface AsideInit {
  // The thread this aside branches off. Required — an aside with no parent is
  // the orphan case, and nothing may create one deliberately.
  parentThreadId: string;
  // The AI-pen mark this aside was drawn on, for one opened from the page.
  // Omitted for one pulled out of a chat message, which has no mark at all.
  annotationId?: string;
  // The span, for a chat-span aside. Omitted for a mark-anchored one.
  asideAnchor?: AsideAnchor;
}

export interface ThreadStore {
  load: (bookId: string) => Promise<ThreadMap>;
  peek: (bookId: string) => Promise<Thread[]>;
  drop: (bookId: string) => void;
  get: (bookId: string, threadId: string) => Thread | undefined;
  list: (bookId: string) => Thread[];
  getBook: (bookId: string) => Thread | undefined;
  asides: (bookId: string, threadId: string) => Thread[];
  orphanAsides: (bookId: string) => Thread[];
  create: (bookId: string, annotationId: string, threadId: string) => Thread;
  createBook: (bookId: string, threadId: string) => Thread;
  createAside: (bookId: string, threadId: string, init: AsideInit) => Thread;
  remove: (bookId: string, threadId: string) => boolean;
  removeTree: (bookId: string, threadId: string) => string[];
  append: (bookId: string, threadId: string, message: ThreadMessage) => Thread | undefined;
  patch: (bookId: string, threadId: string, ts: number, patch: Partial<ThreadMessage>) => void;
  setFocusChapter: (bookId: string, threadId: string, chapter: number | null) => void;
  flush: () => Promise<void>;
}

function parseThreads(text: string): ThreadMap {
  const parsed = JSON.parse(text) as { threads?: ThreadMap };
  return parsed.threads ?? {};
}

export function createThreadStore(io: ThreadIo): ThreadStore {
  const cache = new Map<string, Entry>();

  function entryFor(key: string): Entry {
    const held = cache.get(key);
    if (held) return held;
    const fresh: Entry = { threads: {}, removed: new Set(), reconciled: false, gen: 0 };
    cache.set(key, fresh);
    return fresh;
  }

  // The one rule for applying anything computed across an await: add what the
  // entry has no opinion about, and change nothing else. A thread the entry
  // holds is the copy being edited (cache wins per thread); a thread it has
  // removed is a deletion it still owes the file. Both blockers this file was
  // rewritten for were the other shape — a map snapshotted before an await and
  // assigned back after it, erasing whatever was created or deleted in between.
  function addMissing(entry: Entry, from: ThreadMap): void {
    for (const [id, thread] of Object.entries(from)) {
      if (id in entry.threads || entry.removed.has(id)) continue;
      // The other half of the cascade, paid on the way back in. Deleting a
      // parent deletes its asides, but per-record sync merge has no referential
      // integrity (platform/sync/merge/records.ts): an aside another device
      // edited outranks this device's delete and comes back off the file with
      // its parent gone. On the device whose user asked for the deletion the
      // answer is to finish it — the parent's id is in `removed` for good, so
      // the aside is taken out with it and named too, or the next merge reads it
      // straight back in.
      if (thread.parentThreadId && entry.removed.has(thread.parentThreadId)) {
        entry.removed.add(id);
        continue;
      }
      entry.threads[id] = thread;
    }
  }

  // Keys whose write has begun and not finished. The debounced writer stops
  // calling a key pending the moment its write starts, and a load landing in
  // that window would take the file — which does not have the edit being
  // written yet — for the whole truth.
  const writing = new Set<string>();

  // The file as a writer must see it. A read that fails throws: nothing is known
  // to be wrong with the file, so nothing may be put over it. Bytes that will
  // not parse are a different answer — they are moved aside first, and then "no
  // threads" is the truth about what is left, so the session's messages land
  // instead of every write for this book being refused for good.
  async function readForWrite(key: string): Promise<ThreadMap> {
    const file = fileFor(key);
    const text = await io.read(file);
    if (text === null) return {};
    try {
      return parseThreads(text);
    } catch (e) {
      // Named here rather than by the channel: the corrupt-file scope carries no
      // log line of its own, because the store reporting one has already said
      // which file and which parse error (atomic-fs does the same).
      console.error(`failed to parse ${file}`, e);
      // A quarantine that fails throws out of the write: the bad bytes are still
      // where they were, and nothing may be put over them.
      const savedAs = await io.quarantine(file);
      io.onCorrupt?.({ file, savedAs });
      return {};
    }
  }

  // Read-modify-write, always. The alternative is to write the cache straight
  // out whenever the store believes it read the file first, and that belief is
  // one more thing that can be wrong: a cache that was dropped, or that was
  // never loaded because the caller reached a create path before its load
  // resolved, then writes an empty map over the file. Re-reading costs one IPC
  // round-trip per debounce window and removes the whole class.
  //
  // Cache wins per thread: the copy this process is editing is the newer one for
  // the threads it holds. A thread only the file has (another device's, pulled
  // under us) is kept as it is rather than erased, which is what v1 per-file LWW
  // used to do to it.
  async function writeMerged(key: string): Promise<void> {
    const entry = cache.get(key);
    // Nothing held for this key: there is nothing to say about the file, and
    // saying "{}" is exactly the bug this store is written against.
    if (!entry) return;
    writing.add(key);
    entry.gen++;
    try {
      const onDisk = await readForWrite(key);
      // Taken here, with no await between this and the write: everything the
      // entry holds at the moment the bytes are handed over goes out with them,
      // including a thread created while the file was being read.
      const merged: ThreadMap = { ...onDisk, ...entry.threads };
      for (const id of entry.removed) delete merged[id];
      // Same cascade, applied to the bytes about to go out: an aside the file
      // still has whose parent this process deleted goes with it, and is named
      // so the merge after this one does not put it back.
      //
      // Only ids the file brought. A thread the entry holds is never taken out
      // here: that is how the file and the cache came to disagree — the id was
      // dropped from the bytes, kept in memory, and everything typed into it
      // afterwards was written and thrown away by turns depending on which write
      // path ran. Whatever the entry holds, the entry decides (removeFrom).
      for (const [id, thread] of Object.entries(merged)) {
        if (id in entry.threads) continue;
        if (thread.parentThreadId && entry.removed.has(thread.parentThreadId)) {
          entry.removed.add(id);
          delete merged[id];
        }
      }
      await io.write(fileFor(key), JSON.stringify({ threads: merged }, null, 2));
      // Applied to the entry as it is now, not as `merged` left it: a thread
      // created while the bytes were in the air belongs to the live entry, and
      // assigning `merged` over it is how the top-bar button ended up holding a
      // thread the store did not have and every message typed into it was lost.
      addMissing(entry, onDisk);
      entry.reconciled = true;
    } finally {
      // The other half of the bump at the top, and the reason a read cannot
      // outlive this write unnoticed: `writing` stops being true here, so this
      // is the last moment anything can say the file moved on. Bumped however
      // the write ended — one that threw leaves the entry holding the only copy
      // of what it was carrying, and adopting the file over that loses it just
      // the same.
      entry.gen++;
      writing.delete(key);
    }
  }

  // The way out of the app. On iOS the webview is suspended at pagehide with
  // whatever has not been written yet still in memory, so this is the last
  // chance the session's final message gets — and it gets one IPC to take it,
  // not two.
  //
  // A reconciled entry is written straight out, unmerged. There is no other
  // writer in this process on the way out, the entry is the file plus this
  // session's edits, and reading first buys a merge that can only lose: a read
  // that fails would leave this path writing nothing at all, which is the exact
  // failure it exists to prevent.
  //
  // An entry that has never been reconciled is the one case where writing it out
  // is the incident — a book whose file was never read holds one new thread and
  // nothing else. That one reads first and, if the read fails, writes nothing,
  // because there is nothing safe to write.
  async function writeOnExit(key: string): Promise<void> {
    const entry = cache.get(key);
    if (!entry) return;
    if (!entry.reconciled) return writeMerged(key);
    // `removed` is applied even though nothing it names can be in `threads`
    // (removeFrom takes both together). It is one line, and it makes this path's
    // guarantee local: the write that skips the merge cannot be the one that
    // resurrects a conversation the reader deleted.
    const out: ThreadMap = { ...entry.threads };
    for (const id of entry.removed) delete out[id];
    await io.write(fileFor(key), JSON.stringify({ threads: out }, null, 2));
  }

  const writer: DebouncedWriter<string> = createDebouncedWriter<string>({
    write: writeMerged,
    writeOnExit,
    debounceMs: SAVE_DEBOUNCE,
    onError: io.onError,
    timer: io.timer,
    exit: io.exit,
  });

  const schedule = (key: string): void => writer.schedule(key);

  // Load a document's threads. Missing file is normal ({}); read/parse errors
  // rethrow so the caller can warn — and so the top-bar button says so instead
  // of starting a second conversation. Nothing is quarantined here: a file the
  // user still has is worth a sentence, and the writer moves it aside only when
  // it would otherwise be stuck refusing writes forever.
  async function load(bookId: string): Promise<ThreadMap> {
    const before = cache.get(bookId)?.gen;
    const text = await io.read(fileFor(bookId));
    const onDisk = text === null ? {} : parseThreads(text);
    const entry = entryFor(bookId);
    // The file is this book's whole truth only when nothing happened to the
    // entry while it was being read and nothing of the entry is still on its way
    // to disk. `isPending` and `writing` are the two halves of "on its way";
    // `gen` catches the third case both of them answer "no" to — a read slower
    // than a whole debounce-and-write cycle, whose answer is a file that no
    // longer exists by the time it arrives.
    const current =
      entry.gen === (before ?? 0) && !writer.isPending(bookId) && !writing.has(bookId);
    // Adopt it: a thread another device deleted goes away here. The entry object
    // itself is kept rather than replaced — a write in the air holds it — and
    // this process's own deletions still outrank the file until they are paid.
    if (current) for (const id of Object.keys(entry.threads)) delete entry.threads[id];
    addMissing(entry, onDisk);
    entry.reconciled = true;
    return entry.threads;
  }

  // The on-disk threads of a book, without touching the cache — the sweep's read
  // path, for the same reason as peekAnnotations. A book that is open answers from
  // disk here, at most one debounce behind, rather than from the live cache.
  async function peek(bookId: string): Promise<Thread[]> {
    try {
      const text = await io.read(fileFor(bookId));
      return text === null ? [] : Object.values(parseThreads(text));
    } catch {
      return [];
    }
  }

  // What every creation path goes through. The three doors differ only in which
  // of the optional markers they fill in, so they hand those over by name — a
  // fourth positional flag beside `annotationId` would be unreadable at the call
  // site and is exactly how `book` gets set on something that is not the lesson.
  type ThreadInit = Pick<Thread, "book" | "parentThreadId" | "asideAnchor">;

  function create(
    bookId: string,
    annotationId: string,
    threadId: string,
    init: ThreadInit = {},
  ): Thread {
    const entry = entryFor(bookId);
    const thread: Thread = {
      id: threadId,
      annotationId,
      ...(init.book ? { book: init.book } : {}),
      ...(init.parentThreadId ? { parentThreadId: init.parentThreadId } : {}),
      ...(init.asideAnchor ? { asideAnchor: init.asideAnchor } : {}),
      path: bookId,
      createdAt: Date.now(),
      messages: [],
    };
    entry.threads[threadId] = thread;
    entry.removed.delete(threadId);
    entry.gen++;
    schedule(bookId);
    return thread;
  }

  // The asides branched off one thread, from the cache. One level deep, so this
  // is the whole tree below `threadId`.
  function asidesOf(bookId: string, threadId: string): Thread[] {
    const held = cache.get(bookId);
    if (!held) return [];
    return Object.values(held.threads).filter((t) => t.parentThreadId === threadId);
  }

  // The one way a thread leaves an entry, so the cache and the file cannot end
  // up saying different things about the same id. A conversation takes its
  // asides with it — deleting the lesson deletes what hangs off it — and every
  // id that goes is named in `removed`, or the next read-modify-write reads it
  // straight back in (docs/13).
  //
  // Named ids are gone from `threads` as well, always. An id in both is the
  // shape this store exists to make impossible: `get` keeps answering with a
  // thread the file does not have, `append` writes messages the debounced write
  // then drops, and the exit path — which writes the entry unmerged — puts it
  // back with them.
  function removeFrom(entry: Entry, threadId: string): string[] {
    if (!(threadId in entry.threads)) return [];
    const gone = [
      threadId,
      ...Object.values(entry.threads)
        .filter((t) => t.parentThreadId === threadId)
        .map((t) => t.id),
    ];
    for (const id of gone) {
      delete entry.threads[id];
      entry.removed.add(id);
    }
    entry.gen++;
    return gone;
  }

  return {
    load,
    peek,
    // A sync pull replaced the file under us. Re-read it rather than throw the
    // cached copy away: an absent entry reads as "this book has no threads",
    // and that is what sent the top-bar AI button off to start a second
    // conversation over a history it could not see. The re-read is allowed to
    // be asynchronous and is allowed to fail, because it is no longer what
    // keeps the file safe — the writer's merge is — and because load applies
    // what comes back to the live entry instead of installing it over one.
    drop: (bookId) => {
      void load(bookId).catch((e: unknown) => io.onError?.(e));
    },
    get: (bookId, threadId) => cache.get(bookId)?.threads[threadId],
    // Every thread this process holds for a book. The read behind anything that
    // has to see a conversation's neighbours — its asides, its parent — without
    // a store method per question.
    list: (bookId) => Object.values(cache.get(bookId)?.threads ?? {}),
    // The book-level thread for a document, if one has ever been created. There
    // is at most one per book (the top-bar button reopens it rather than making
    // more), so this answers with the oldest if a past bug left two.
    //
    // An aside is skipped on both counts. It never carries `book`, and the
    // parent link is checked as well rather than trusted to be absent, because
    // this is what the top-bar button opens: answering with an aside would put
    // the reader's side conversation where the lesson goes.
    getBook: (bookId) => {
      const held = cache.get(bookId);
      if (!held) return undefined;
      let found: Thread | undefined;
      for (const t of Object.values(held.threads)) {
        if (!t.book || threadKind(t) !== "book") continue;
        if (!found || t.createdAt < found.createdAt) found = t;
      }
      return found;
    },
    asides: asidesOf,
    // Asides whose parent is not in the file — a delete that a concurrent edit
    // on another device outran (the note on addMissing). Kept rather than
    // reaped: this device's user deleted nothing, and throwing away the side
    // conversation they were in the middle of because another device deleted the
    // lesson is the destructive direction. Enumerated here so the thread list
    // has a door to them; distillation gives each one a unit of its own
    // (memory/observations/arrears.ts), so what the reader said still lands in
    // memory whether or not anyone reopens it.
    orphanAsides: (bookId) => {
      const held = cache.get(bookId);
      if (!held) return [];
      return Object.values(held.threads).filter(
        (t) => t.parentThreadId !== undefined && !(t.parentThreadId in held.threads),
      );
    },
    create: (bookId, annotationId, threadId) => create(bookId, annotationId, threadId),
    // Create the book-level thread (docs/03: the top-bar AI button's
    // selection-free entry). No annotation anchor; the `book` marker is how it's
    // found again.
    createBook: (bookId, threadId) => create(bookId, "", threadId, { book: true }),
    // Create an aside off a live conversation (docs/03). Never `book`, whatever
    // the parent is: the parent link and the top-bar button's marker are the two
    // things that must not be true of the same record.
    createAside: (bookId, threadId, init) =>
      create(bookId, init.annotationId ?? "", threadId, {
        parentThreadId: init.parentThreadId,
        ...(init.asideAnchor ? { asideAnchor: init.asideAnchor } : {}),
      }),
    // Remove a thread from its file by id, and the asides branched off it with
    // it — there is one delete, and this is the answer for a caller that only
    // wants to know whether the thread was there. The file stays and is
    // rewritten without them — an in-file edit, so per-file LWW sync carries the
    // removal to other devices (unlike a whole-file deletion, which v1 sync does
    // not propagate). The threads' images under images/threads/<threadId>/ are
    // left on disk; they are not synced and a stale directory is harmless. No-op
    // when the thread is already gone.
    remove: (bookId, threadId) => {
      const held = cache.get(bookId);
      if (!held) return false;
      const gone = removeFrom(held, threadId);
      if (gone.length === 0) return false;
      schedule(bookId);
      return true;
    },
    // The same delete, answering with every id that went — the caller needs them
    // for whatever else is keyed by thread id (a live turn, staged images, an
    // event line). Deleting an aside takes only the aside: it has no children,
    // and its parent is the conversation the reader is still in.
    removeTree: (bookId, threadId) => {
      const held = cache.get(bookId);
      if (!held) return [];
      const gone = removeFrom(held, threadId);
      if (gone.length > 0) schedule(bookId);
      return gone;
    },
    append: (bookId, threadId, message) => {
      const entry = cache.get(bookId);
      const thread = entry?.threads[threadId];
      if (!entry || !thread) return undefined;
      thread.messages.push(message);
      entry.gen++;
      schedule(bookId);
      return thread;
    },
    // Merge a patch into the stored message identified by `ts` (used to record a
    // card's later state, e.g. a confirm card flipping to "added"). No-op when
    // the thread or message is gone.
    patch: (bookId, threadId, ts, patch) => {
      const entry = cache.get(bookId);
      const thread = entry?.threads[threadId];
      if (!entry || !thread) return;
      const i = thread.messages.findIndex((m) => m.ts === ts);
      if (i < 0) return;
      thread.messages[i] = { ...thread.messages[i], ...patch };
      entry.gen++;
      schedule(bookId);
    },
    // Park the conversation on a chapter, or clear it (docs/09). Written on the
    // thread rather than beside it because it is what the next turn of *this*
    // conversation loads, and a book with two conversations open must not have
    // one of them decide what the other is about.
    setFocusChapter: (bookId, threadId, chapter) => {
      const entry = cache.get(bookId);
      const thread = entry?.threads[threadId];
      if (!entry || !thread) return;
      const next = chapter === null ? undefined : Math.round(chapter);
      if (thread.focusChapter === next) return;
      if (next === undefined) delete thread.focusChapter;
      else thread.focusChapter = next;
      entry.gen++;
      schedule(bookId);
    },
    flush: writer.flush,
  };
}

function liveStore(): ThreadStore {
  return createThreadStore({
    read: async (file) => ((await appData.exists(file)) ? appData.readText(file) : null),
    write: writeTextAtomic,
    quarantine: quarantineFile,
    onError: (e) => reportStoreError("threads", e),
    onCorrupt: (report) => reportStoreError("corrupt-file", report),
  });
}

let store = liveStore();

// The store as this module was first imported with. `drop` is not this: it
// re-reads the file over the cached entry, and a thread the cache already holds
// outranks what comes back — which is right for a sync pull and useless to a
// test, whose next case shares the process and gets the previous one's messages
// appended to the same thread id.
export function rebuildThreadStoreForTests(): void {
  store = liveStore();
}

export const loadThreads = (bookId: string): Promise<ThreadMap> => store.load(bookId);
export const peekThreads = (bookId: string): Promise<Thread[]> => store.peek(bookId);
export const dropThreadCache = (bookId: string): void => store.drop(bookId);
export const getThread = (bookId: string, threadId: string): Thread | undefined =>
  store.get(bookId, threadId);
export const listThreads = (bookId: string): Thread[] => store.list(bookId);
export const getBookThread = (bookId: string): Thread | undefined => store.getBook(bookId);
export const createThread = (bookId: string, annotationId: string, threadId: string): Thread =>
  store.create(bookId, annotationId, threadId);
export const createBookThread = (bookId: string, threadId: string): Thread =>
  store.createBook(bookId, threadId);
export const createAsideThread = (bookId: string, threadId: string, init: AsideInit): Thread =>
  store.createAside(bookId, threadId, init);
// Deletes a conversation and its asides, with every id that went named back.
// Whatever else is keyed by thread id — a live turn, staged images — is cleared
// from those names.
export const deleteThreadTree = (bookId: string, threadId: string): string[] =>
  store.removeTree(bookId, threadId);
export const appendMessage = (
  bookId: string,
  threadId: string,
  message: ThreadMessage,
): Thread | undefined => store.append(bookId, threadId, message);
export const patchThreadMessage = (
  bookId: string,
  threadId: string,
  ts: number,
  patch: Partial<ThreadMessage>,
): void => store.patch(bookId, threadId, ts, patch);
export const setThreadFocusChapter = (
  bookId: string,
  threadId: string,
  chapter: number | null,
): void => store.setFocusChapter(bookId, threadId, chapter);

// Thread images live one directory per thread. Mirrors annotations.ts's base64
// <-> bytes helpers; here `data` is bare base64 (no data: prefix), matching the
// ChatMessage.images contract.
function threadImageDir(threadId: string): string {
  return `images/threads/${threadId}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function extFor(mediaType: string): string {
  return mediaType === "image/png" ? "png" : "jpg";
}

// Narrow, so a loaded image is the same shape the compressor produces
// (ai/image-utils's CompressedImage) and can be handed straight to a bubble.
function mediaTypeFor(name: string): "image/png" | "image/jpeg" {
  return name.endsWith(".png") ? "image/png" : "image/jpeg";
}

// Write a message's images to disk, returning the filenames to store on the
// ThreadMessage. The extension records the media type so it round-trips on read.
// Throws on write failure so the caller can warn instead of silently dropping.
export async function saveThreadImages(
  threadId: string,
  images: { data: string; mediaType: string }[],
): Promise<string[]> {
  if (images.length === 0) return [];
  await appData.mkdirp(threadImageDir(threadId));
  const stamp = Date.now();
  const names: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const name = `${stamp}-${i}.${extFor(images[i].mediaType)}`;
    await appData.writeBytes(`${threadImageDir(threadId)}/${name}`, base64ToBytes(images[i].data));
    names.push(name);
  }
  return names;
}

// Read a message's stored images back as base64 for display / resending. Missing
// files are skipped (a half-written thread should not block the rest).
export async function readThreadImages(
  threadId: string,
  names: string[],
): Promise<{ data: string; mediaType: "image/png" | "image/jpeg" }[]> {
  const out: { data: string; mediaType: "image/png" | "image/jpeg" }[] = [];
  for (const name of names) {
    const path = `${threadImageDir(threadId)}/${name}`;
    if (!(await appData.exists(path))) continue;
    const bytes = await appData.readBytes(path);
    out.push({ data: bytesToBase64(bytes), mediaType: mediaTypeFor(name) });
  }
  return out;
}
