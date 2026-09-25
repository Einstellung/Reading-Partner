// A book's supplements: the documents it picked up from its own conversation
// (docs/67 「辅助资料」). One supplements-<bookId>.json per book, holding
// references only — the documents themselves are library entries like any other,
// built by the same ingest path as an article.
//
// Filed under the book rather than under the topic: a link pasted while reading
// belongs to the book it was pasted about, and the shelf stays the list of
// things the reader put there.
//
// Everything the store reaches outside itself is passed in, so a test can run
// the real store — the serialisation included — against its own file rather than
// rewriting the module registry for every other test sharing the process
// (pitfall 119).

import { readGuardedJson, writeTextAtomic, type GuardedRead } from "./atomic-fs";
import { createSerialQueue } from "./serial-queue";

/** One supplement: which document it is, and where it came from. */
export interface SupplementRef {
  /** The document's book id (content hash) — the library is where its bytes are. */
  hash: string;
  title: string;
  /** The URL it was ingested from. Absent for a document that came from nowhere. */
  sourceUrl?: string;
  addedAt: number;
}

/** The whole list of one book, which is what the one file holds. */
export interface SupplementFile {
  items: SupplementRef[];
}

export function supplementsFile(bookId: string): string {
  return `supplements-${bookId}.json`;
}

export interface SupplementIo {
  // The guarded read, so the quarantine policy stays in atomic-fs.
  read: (file: string) => Promise<GuardedRead<SupplementFile>>;
  write: (file: string, contents: string) => Promise<void>;
}

export interface SupplementStore {
  list: (bookId: string) => Promise<SupplementRef[]>;
  /** Idempotent by hash. Returns whether this call is what added it. */
  add: (bookId: string, ref: SupplementRef) => Promise<boolean>;
  remove: (bookId: string, hash: string) => Promise<void>;
}

export function createSupplementStore(io: SupplementIo): SupplementStore {
  // Every mutator is read -> await -> write of the whole file, so two of them
  // overlapping read the same list twice and the second write drops the first
  // one's edit — one chat turn ingesting two links is exactly that. One chain
  // for the store rather than one per book: these writes are rare, and a queue
  // that cannot be indexed wrong is worth more here than the parallelism.
  const queue = createSerialQueue();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    return queue.run(run);
  }

  // A file that is not there is a book with no supplements. Content that does
  // not parse is quarantined and a fresh list takes over; content that is there
  // and could not be read raises, because an empty list turns the next add into
  // "this book has one supplement, the one being added" and the write would take
  // the others off every device.
  async function read(bookId: string): Promise<SupplementRef[]> {
    const got = await io.read(supplementsFile(bookId));
    if (got.status === "ok") return got.value.items;
    if (got.status === "missing") return [];
    if (got.savedAs === null) throw new Error(`${supplementsFile(bookId)} could not be read`);
    return [];
  }

  function save(bookId: string, items: SupplementRef[]): Promise<void> {
    return io.write(supplementsFile(bookId), JSON.stringify({ items }, null, 2));
  }

  return {
    list: (bookId) => read(bookId),

    // The same URL ingested twice is the same bytes and so the same hash, and
    // that is the whole of the idempotency: nothing is rewritten, so the file
    // produces no sync revision and the sidebar keeps the order it had.
    add: (bookId, ref) =>
      serialize(async () => {
        const items = await read(bookId);
        if (items.some((s) => s.hash === ref.hash)) return false;
        await save(bookId, [...items, ref]);
        return true;
      }),

    remove: (bookId, hash) =>
      serialize(async () => {
        const items = await read(bookId);
        const kept = items.filter((s) => s.hash !== hash);
        if (kept.length === items.length) return;
        await save(bookId, kept);
      }),
  };
}

const store = createSupplementStore({
  read: (file) =>
    readGuardedJson<SupplementFile>(file, (raw) => {
      const parsed = raw as SupplementFile | null;
      return parsed && typeof parsed === "object" && Array.isArray(parsed.items) ? parsed : null;
    }),
  write: writeTextAtomic,
});

export function listSupplements(bookId: string): Promise<SupplementRef[]> {
  return store.list(bookId);
}

export function addSupplement(bookId: string, ref: SupplementRef): Promise<boolean> {
  return store.add(bookId, ref);
}

export function removeSupplement(bookId: string, hash: string): Promise<void> {
  return store.remove(bookId, hash);
}
