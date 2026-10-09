// Topic library. A topic is the top-level container for syntopical reading —
// several PDFs read against one question (docs/01 §1). Topics store only path
// references; files are never copied. Persisted to AppData/topics.json.
//
// A book, by its content hash, is on one topic. Only moveFile takes it to
// another; adding one another topic lists leaves it where it is (addFile), and
// a merge that lands it on two keeps one (oneTopicPerBook).

import { readGuardedJson, writeTextAtomic, type GuardedRead } from "./atomic-fs";
import {
  emptyDeletions,
  readDeletions,
  readTopicFileRevivals,
  recordDeletion,
  recordRevival,
  topicFileId,
  type Deletions,
} from "./deleted-books";
import { basename, decodeLegacyName, normalizeFilePath } from "./path";
import { createSerialQueue } from "./serial-queue";

// Exported so the shelf's pull route can name it once (reading/pull-routes.ts).
export const TOPICS_FILE = "topics.json";

export interface FileRef {
  path: string;
  name: string;
  addedAt: number;
  lastOpenedAt?: number;
  // The book id (content hash), written by the door the file came in by
  // (reading/session/import-book.ts). Absent only on a row written before
  // 2026-09-21, when a door wrote the path alone; the app falls back to reading
  // `path` and writes the id then (reading/session/open-file.ts).
  hash?: string;
}

export interface Topic {
  id: string;
  name: string;
  createdAt: number;
  files: FileRef[];
}

/** The whole shelf, which is what the one file holds. */
export interface TopicFile {
  topics: Topic[];
}

// Where saved info articles land until anything smarter exists (docs/21). A
// fixed id, not a name match: the user may rename it, and it still has to be
// recognizable. Both devices derive the same id, so the two copies merge as one
// topic record rather than becoming two topics named "Brief".
export const BRIEF_TOPIC_ID = "brief";
export const BRIEF_TOPIC_NAME = "Brief";

// Pure: repair references stored before paths were normalized on the way in —
// an iOS import wrote the percent-encoded file URL as the path and its last
// segment as the name (path.ts, docs/pitfall/106). Two references that normalize
// to the same path are one file and collapse into the first, keeping whichever
// book id and open time either of them carries. Returns the same array — same
// object — when there is nothing to repair, which is what lets the repair below
// skip the write, and with it the sync revision.
export function healTopicFiles(files: FileRef[]): FileRef[] {
  let changed = false;
  const out: FileRef[] = [];
  const byPath = new Map<string, FileRef>();
  for (const file of files) {
    const path = normalizeFilePath(file.path);
    // A path that was already clean keeps its name (which may predate this
    // repair); a decoded one takes its name from the decoded path.
    const name = path === file.path ? decodeLegacyName(file.name) : basename(path);
    const healed = path === file.path && name === file.name ? file : { ...file, path, name };
    if (healed !== file) changed = true;
    const seen = byPath.get(path);
    if (!seen) {
      byPath.set(path, healed);
      out.push(healed);
      continue;
    }
    const merged: FileRef = { ...seen };
    if (!merged.hash && healed.hash) merged.hash = healed.hash;
    if (healed.lastOpenedAt !== undefined && healed.lastOpenedAt > (merged.lastOpenedAt ?? 0)) {
      merged.lastOpenedAt = healed.lastOpenedAt;
    }
    if (healed.addedAt < merged.addedAt) merged.addedAt = healed.addedAt;
    out[out.indexOf(seen)] = merged;
    byPath.set(path, merged);
    changed = true;
  }
  return changed ? out : files;
}

// Pure: drop what the deletion log says is gone — a topic by its id, a file by
// the book id it carries, and a file taken off this one topic by the pair. The
// record may still be in the file: a topic's row comes back when another device
// edited it (a lastOpenedAt) after this one deleted it, since an edit outranks a
// delete in the merge (merge/records.ts), and a FileRef comes back from a merge
// with no base or from a client that still settles a topic whole (docs/59 §11).
// The log is what the reader asked for, so the store answers from it and the
// file catches up on the next write. Returns the same array when nothing is
// dropped, so a caller can skip the write.
export function pruneDeletedTopics(topics: Topic[], deletions: Deletions): Topic[] {
  const offTopic = deletions["topic-file"];
  if (deletions.topic.size === 0 && deletions.book.size === 0 && offTopic.size === 0) return topics;
  let changed = false;
  const out: Topic[] = [];
  for (const topic of topics) {
    if (deletions.topic.has(topic.id)) {
      changed = true;
      continue;
    }
    const files = topic.files.filter(
      (f) => !f.hash || (!deletions.book.has(f.hash) && !offTopic.has(topicFileId(topic.id, f.hash))),
    );
    if (files.length !== topic.files.length) {
      changed = true;
      out.push({ ...topic, files });
    } else {
      out.push(topic);
    }
  }
  return changed ? out : topics;
}

/** A book going from one topic to another. */
export interface FileMove {
  hash: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
}

/** A book an add found on another topic, where it stays. */
export interface FiledElsewhere {
  hash: string;
  topic: { id: string; name: string };
}

/** Whether some book id is listed under more than one topic. */
export function bookOnTwoTopics(topics: readonly Topic[]): boolean {
  const home = new Map<string, string>();
  for (const topic of topics) {
    for (const f of topic.files) {
      if (!f.hash) continue;
      const seen = home.get(f.hash);
      if (seen !== undefined && seen !== topic.id) return true;
      home.set(f.hash, topic.id);
    }
  }
  return false;
}

// Pure: every book on one topic (docs/reading/01 §一). The store never puts a
// book on a second topic, but a merge can: two devices that moved it to two
// topics, or a client that still lists one book twice, each add a row the other
// side never had (docs/59 §11). The topic that claimed it last keeps it. A
// topic's claim is the later of the pair's latest revive in the deletion log
// and the row's addedAt, which a move and an import both set to now; a tie goes
// to the smaller topic id. Everything compared is in the file and the log, so
// every device drops the same rows. Rows with no book id are left alone. Returns
// the same array when no book is on two topics.
export function oneTopicPerBook(
  topics: Topic[],
  revivedAt: ReadonlyMap<string, string> = new Map(),
): Topic[] {
  if (!bookOnTwoTopics(topics)) return topics;
  const claim = (topic: Topic, hash: string): number => {
    const at = revivedAt.get(topicFileId(topic.id, hash));
    let out = at === undefined ? 0 : Date.parse(at) || 0;
    for (const f of topic.files) if (f.hash === hash && f.addedAt > out) out = f.addedAt;
    return out;
  };
  const holders = new Map<string, Topic[]>();
  for (const topic of topics) {
    for (const f of topic.files) {
      if (!f.hash) continue;
      const list = holders.get(f.hash) ?? [];
      if (!list.includes(topic)) list.push(topic);
      holders.set(f.hash, list);
    }
  }
  const losing = new Map<Topic, Set<string>>();
  for (const [hash, list] of holders) {
    if (list.length < 2) continue;
    let keep = list[0]!;
    let keepAt = claim(keep, hash);
    for (const topic of list.slice(1)) {
      const at = claim(topic, hash);
      if (at > keepAt || (at === keepAt && topic.id < keep.id)) {
        keep = topic;
        keepAt = at;
      }
    }
    for (const topic of list) {
      if (topic === keep) continue;
      const lost = losing.get(topic) ?? new Set<string>();
      lost.add(hash);
      losing.set(topic, lost);
    }
  }
  return topics.map((topic) => {
    const lost = losing.get(topic);
    return lost ? { ...topic, files: topic.files.filter((f) => !f.hash || !lost.has(f.hash)) } : topic;
  });
}

export function healTopics(topics: Topic[]): Topic[] {
  let changed = false;
  const healed = topics.map((topic) => {
    const files = healTopicFiles(topic.files);
    if (files === topic.files) return topic;
    changed = true;
    return { ...topic, files };
  });
  return changed ? healed : topics;
}

// Everything the store reaches outside itself, passed in rather than imported,
// so a test can run the real store — the serialisation included — against its
// own file.
export interface TopicIo {
  // The guarded read, so the quarantine policy stays in atomic-fs.
  read: () => Promise<GuardedRead<TopicFile>>;
  write: (contents: string) => Promise<void>;
  newId: () => string;
  now: () => number;
  // What the deletion log says is gone (deleted-books.ts). Left out, nothing is.
  deletions?: () => Promise<Deletions>;
  // Log a book going off a topic, or coming back onto one it was taken off. A
  // revive of a pair that is not deleted writes nothing. Left out, nothing is
  // logged.
  logFile?: (op: "delete" | "revive", topicId: string, hash: string) => Promise<void>;
  // When each "topic-file" pair was last put back (deleted-books.ts), read only
  // when some book is on two topics. Left out, no pair ever was.
  revivals?: () => Promise<ReadonlyMap<string, string>>;
  // Told of an add that found the book on another topic and wrote nothing.
  elsewhere?: (found: FiledElsewhere) => void;
}

export interface TopicStore {
  repairPaths: () => Promise<boolean>;
  list: () => Promise<Topic[]>;
  create: (name: string) => Promise<Topic>;
  ensureBrief: () => Promise<Topic>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  // Answers the topic the book is already on when that is another one; the
  // add then writes nothing.
  addFile: (id: string, rawPath: string, hash: string, name?: string) => Promise<FiledElsewhere | null>;
  // Null when there was nothing to move: no such book or topic, or the book is
  // already there.
  moveFile: (hash: string, toId: string) => Promise<FileMove | null>;
  removeFile: (id: string, path: string) => Promise<void>;
  setFileHash: (id: string, path: string, hash: string) => Promise<void>;
  markOpened: (id: string, path: string) => Promise<void>;
  // Write the file without what the deletion log says is gone. Answers whether
  // anything was dropped.
  pruneDeleted: () => Promise<boolean>;
}

export function createTopicStore(io: TopicIo): TopicStore {
  // Every mutator is load -> await -> save of the whole file, so two of them
  // overlapping read the same library twice and the second write drops the first
  // one's edit. Filing a book does exactly that: a book is hundreds of MB, so
  // the read and the import between picking the file and writing its row take
  // seconds the user spends on the shelf renaming and adding. So mutations run
  // one at a time.
  //
  // This is one store's queue over its own file, not a lock on the file. The
  // sync engine writes topics.json through syncFs without taking anything, and
  // nothing here ever waits on the sync engine, so neither can be left waiting
  // on the other. A mutation overlapping a pull costs what it always did — one
  // of the two writes lands whole — which is what the shelf's pull route
  // re-reads for.
  const queue = createSerialQueue();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    return queue.run(run);
  }

  // The topic library read.
  //
  // Nothing rebuilds a topic. The PDFs are still on disk, but which question they
  // were read against, when they were added and when they were last opened live
  // only here — and lastOpenedAt is the only source "Continue reading" has. So a
  // file that is there and could not be read raises rather than reading as no
  // topics at all: an empty library turns the next edit into "one topic, the one
  // being edited", and the shelf is one sync unit, so local-changed against
  // remote-unchanged is classified an upload rather than a merge
  // (sync/reconcile.ts) — the one-topic file goes to Drive whole and nothing is
  // journalled to sync-trash.jsonl.
  //
  // Content that doesn't parse is quarantined and a fresh library takes over.
  async function readStore(): Promise<TopicFile> {
    const read = await io.read();
    if (read.status === "ok") return read.value;
    if (read.status === "missing") return { topics: [] };
    if (read.savedAs === null) throw new Error(`${TOPICS_FILE} could not be read`);
    return { topics: [] };
  }

  // What the log says is gone dropped, and every book on one topic. The same
  // array when there is nothing to drop.
  async function settle(topics: Topic[]): Promise<Topic[]> {
    const deletions = io.deletions ? await io.deletions() : emptyDeletions();
    const pruned = pruneDeletedTopics(topics, deletions);
    if (!bookOnTwoTopics(pruned)) return pruned;
    return oneTopicPerBook(pruned, io.revivals ? await io.revivals() : new Map());
  }

  // Every read hands out repaired references, whether or not the file on disk has
  // been rewritten yet.
  async function load(): Promise<TopicFile> {
    return { topics: await settle(healTopics((await readStore()).topics)) };
  }

  function save(store: TopicFile): Promise<void> {
    return io.write(JSON.stringify(store, null, 2));
  }

  // Take a book off one topic, every row of it, logged before the rows go so a
  // device that still holds them cannot hand them back (docs/59 §11).
  async function unlist(topic: Topic, hash: string): Promise<void> {
    await io.logFile?.("delete", topic.id, hash);
    topic.files = topic.files.filter((f) => f.hash !== hash);
  }

  // Take a book off every topic but `keep`. Answers the topic it came off and
  // its row there; after load there is at most one.
  async function unlistElsewhere(
    store: TopicFile,
    hash: string,
    keep: string,
  ): Promise<{ topic: Topic; row: FileRef } | null> {
    let first: { topic: Topic; row: FileRef } | null = null;
    for (const topic of store.topics) {
      if (topic.id === keep) continue;
      const row = topic.files.find((f) => f.hash === hash);
      if (!row) continue;
      await unlist(topic, hash);
      first ??= { topic, row };
    }
    return first;
  }

  function moveOf(hash: string, from: Topic, to: Topic): FileMove {
    return { hash, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name } };
  }

  return {
    // Rewrite the file once with the repaired paths and names. A clean file
    // writes nothing, so this can run at every launch without producing a sync
    // revision. Returns whether it wrote.
    repairPaths: () =>
      serialize(async () => {
        const store = await readStore();
        const healed = healTopics(store.topics);
        if (healed === store.topics) return false;
        await save({ topics: healed });
        return true;
      }),

    list: async () => {
      const store = await load();
      return store.topics.sort((a, b) => b.createdAt - a.createdAt);
    },

    create: (name) =>
      serialize(async () => {
        const store = await load();
        const topic: Topic = {
          id: io.newId(),
          name: name.trim() || "Untitled",
          createdAt: io.now(),
          files: [],
        };
        store.topics.push(topic);
        await save(store);
        return topic;
      }),

    // The Brief topic, created on first use. Idempotent by id.
    ensureBrief: () =>
      serialize(async () => {
        // The raise happens in the read, before the lookup rather than after: no
        // topics in hand would mean creating a second Brief over the first.
        const store = await load();
        const found = store.topics.find((t) => t.id === BRIEF_TOPIC_ID);
        if (found) return found;
        const topic: Topic = {
          id: BRIEF_TOPIC_ID,
          name: BRIEF_TOPIC_NAME,
          createdAt: io.now(),
          files: [],
        };
        store.topics.push(topic);
        await save(store);
        return topic;
      }),

    rename: (id, name) =>
      serialize(async () => {
        const store = await load();
        const topic = store.topics.find((t) => t.id === id);
        if (!topic) return;
        topic.name = name.trim() || topic.name;
        await save(store);
      }),

    remove: (id) =>
      serialize(async () => {
        // An unreadable file holds an unknown number of topics, so a delete over
        // it would keep this one and drop the rest. The read raises instead.
        const store = await load();
        store.topics = store.topics.filter((t) => t.id !== id);
        await save(store);
      }),

    // The one door a host path comes through: the file picker hands back a plain
    // path on desktop and a percent-encoded file URL on iOS, and everything
    // stored downstream (the library title, the notes state's book name) is
    // derived from what lands here. Normalize once, at the door.
    //
    // The book id comes with the path because by the time a row is written the
    // bytes are already in the library (reading/session/import-book.ts). One
    // write, one sync revision.
    //
    // A book is on one topic (docs/reading/01 §一) and only moveFile changes
    // which: an add of one another topic lists writes nothing and answers where
    // it is. This is the one place that holds the rule for every door a book
    // comes in by.
    addFile: (id, rawPath, hash, name) => {
      const path = normalizeFilePath(rawPath);
      return serialize(async () => {
        const store = await load();
        const topic = store.topics.find((t) => t.id === id);
        // A topic lists a book once: the merge keys a row by its book id.
        if (!topic || topic.files.some((f) => f.path === path || f.hash === hash)) return null;
        const home = store.topics.find((t) => t.files.some((f) => f.hash === hash));
        if (home) {
          const found: FiledElsewhere = { hash, topic: { id: home.id, name: home.name } };
          io.elsewhere?.(found);
          return found;
        }
        // Back onto a topic it was taken off: the revive goes first, or the
        // next read filters the new row out again.
        await io.logFile?.("revive", id, hash);
        topic.files.push({ path, name: name ?? basename(path), addedAt: io.now(), hash });
        await save(store);
        return null;
      });
    },

    // The row as it stands, onto another topic. addedAt is the move: it is
    // when the book was filed here, and what a merge that lands it on two
    // topics compares (oneTopicPerBook).
    moveFile: (hash, toId) =>
      serialize(async () => {
        const store = await load();
        const to = store.topics.find((t) => t.id === toId);
        if (!to || to.files.some((f) => f.hash === hash)) return null;
        const from = await unlistElsewhere(store, hash, toId);
        if (!from) return null;
        await io.logFile?.("revive", toId, hash);
        to.files.push({ ...from.row, addedAt: io.now() });
        await save(store);
        return moveOf(hash, from.topic, to);
      }),

    // Every row of that book on the topic goes with it. A row with no book id
    // is only the row, and is not logged.
    removeFile: (id, path) =>
      serialize(async () => {
        const store = await load();
        const topic = store.topics.find((t) => t.id === id);
        const row = topic?.files.find((f) => f.path === path);
        if (!topic || !row) return;
        if (row.hash) await unlist(topic, row.hash);
        topic.files = topic.files.filter((f) => f.path !== path);
        await save(store);
      }),

    // Repair a file's book id. Matched by path within the topic; a no-op if
    // already set to the same hash. The door writes the id (addFile above), so
    // this is for the row it does not cover: one written before the doors
    // imported, and one whose library copy has gone missing.
    //
    // This one and markOpened below ride along with opening a book, so an
    // unreadable file makes them do nothing rather than raise: the
    // book still opens, and the id is written the next time it is opened after a
    // read that worked. Raising here would tell the user the file they are
    // looking at could not be opened (App.tsx's openFile catches around both).
    setFileHash: (id, path, hash) =>
      serialize(async () => {
        const store = await load().catch(() => null);
        if (!store) return;
        const file = store.topics.find((t) => t.id === id)?.files.find((f) => f.path === path);
        if (!file || file.hash === hash) return;
        file.hash = hash;
        await save(store);
      }),

    markOpened: (id, path) =>
      serialize(async () => {
        const store = await load().catch(() => null);
        if (!store) return;
        const file = store.topics.find((t) => t.id === id)?.files.find((f) => f.path === path);
        if (!file) return;
        file.lastOpenedAt = io.now();
        await save(store);
      }),

    pruneDeleted: () =>
      serialize(async () => {
        const raw = await readStore();
        const healed = healTopics(raw.topics);
        const settled = await settle(healed);
        if (settled === healed) return false;
        await save({ topics: settled });
        return true;
      }),
  };
}

// Who hears of an add that found its book on another topic (App.tsx,
// PhoneApp.tsx say it in a toast).
const elsewhereListeners = new Set<(found: FiledElsewhere) => void>();

/** Hear of every add that left its book on the topic it was already on. Answers the unsubscribe. */
export function onFiledElsewhere(listener: (found: FiledElsewhere) => void): () => void {
  elsewhereListeners.add(listener);
  return () => {
    elsewhereListeners.delete(listener);
  };
}

const store = createTopicStore({
  read: () =>
    readGuardedJson<TopicFile>(TOPICS_FILE, (raw) => {
      const parsed = raw as TopicFile | null;
      return parsed && typeof parsed === "object" && Array.isArray(parsed.topics) ? parsed : null;
    }),
  write: (contents) => writeTextAtomic(TOPICS_FILE, contents),
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
  deletions: readDeletions,
  logFile: (op, topicId, hash) =>
    (op === "delete" ? recordDeletion : recordRevival)("topic-file", topicFileId(topicId, hash), Date.now()),
  revivals: readTopicFileRevivals,
  elsewhere: (found) => {
    for (const listener of elsewhereListeners) listener(found);
  },
});

export function repairTopicPaths(): Promise<boolean> {
  return store.repairPaths();
}

export function listTopics(): Promise<Topic[]> {
  return store.list();
}

export function createTopic(name: string): Promise<Topic> {
  return store.create(name);
}

export function ensureBriefTopic(): Promise<Topic> {
  return store.ensureBrief();
}

export function renameTopic(id: string, name: string): Promise<void> {
  return store.rename(id, name);
}

// The row and nothing else. What else named the topic is settled by the domain
// (reading/delete/delete-topic.ts), which is where the cascade can reach the
// stores platform/app may not import; this is the last step of it.
/**
 * Finish what a merge undid: rewrite the file without what the log says is
 * gone, and with every book on one topic (oneTopicPerBook).
 */
export function pruneDeletedFromTopics(): Promise<boolean> {
  return store.pruneDeleted();
}

export function removeTopicRecord(id: string): Promise<void> {
  return store.remove(id);
}

// `name` is for a path whose last segment is not a file name (an Android content
// URI); without it the name is the path's basename. A book another topic lists
// stays there: nothing is written, and where it is is answered and told to
// onFiledElsewhere.
export function addFileToTopic(
  id: string,
  rawPath: string,
  hash: string,
  name?: string,
): Promise<FiledElsewhere | null> {
  return store.addFile(id, rawPath, hash, name);
}

/** Move a book to another topic, its row as it stands: the one way a book changes topic. */
export function moveFileToTopic(hash: string, toTopicId: string): Promise<FileMove | null> {
  return store.moveFile(hash, toTopicId);
}

export function removeFileFromTopic(id: string, path: string): Promise<void> {
  return store.removeFile(id, path);
}

export function setFileHash(id: string, path: string, hash: string): Promise<void> {
  return store.setFileHash(id, path, hash);
}

export function markOpened(id: string, path: string): Promise<void> {
  return store.markOpened(id, path);
}

// Most-recently-opened first (falling back to when it was added).
export function sortedFiles(topic: Topic): FileRef[] {
  return [...topic.files].sort(
    (a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt),
  );
}

// The single most-recently-opened file across all topics (docs/16 vestibule's
// "Continue reading"). Only files actually opened before qualify; null when
// nothing has been read yet. Pure over the given topics.
export function mostRecentlyOpened(topics: Topic[]): { topic: Topic; file: FileRef } | null {
  let best: { topic: Topic; file: FileRef } | null = null;
  for (const topic of topics) {
    for (const file of topic.files) {
      if (file.lastOpenedAt === undefined) continue;
      if (!best || file.lastOpenedAt > (best.file.lastOpenedAt ?? 0)) best = { topic, file };
    }
  }
  return best;
}
