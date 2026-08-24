// Topic library. A topic is the top-level container for syntopical reading —
// several PDFs read against one question (docs/01 §1). Topics store only path
// references; files are never copied. Persisted to AppData/topics.json.

import { readGuardedJson, writeTextAtomic, type GuardedRead } from "./atomic-fs";
import { basename, decodeLegacyName, normalizeFilePath } from "./path";

// Exported so the shelf's pull route can name it once (reading/pull-routes.ts).
export const TOPICS_FILE = "topics.json";

export interface FileRef {
  path: string;
  name: string;
  addedAt: number;
  lastOpenedAt?: number;
  // The book id (content hash), backfilled the first time the file is opened or
  // by the startup migration. Absent for files added but never opened since the
  // upgrade; the app falls back to reading `path` in that case.
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
const BRIEF_TOPIC_NAME = "Brief";

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
}

export interface TopicStore {
  repairPaths: () => Promise<boolean>;
  list: () => Promise<Topic[]>;
  create: (name: string) => Promise<Topic>;
  ensureBrief: () => Promise<Topic>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addFile: (id: string, rawPath: string) => Promise<void>;
  removeFile: (id: string, path: string) => Promise<void>;
  setFileHash: (id: string, path: string, hash: string) => Promise<void>;
  markOpened: (id: string, path: string) => Promise<void>;
}

export function createTopicStore(io: TopicIo): TopicStore {
  // Every mutator is load -> await -> save of the whole file, so two of them
  // overlapping read the same library twice and the second write drops the first
  // one's edit. The startup hash backfill does exactly that: it calls setFileHash
  // once per file across every topic with multi-second awaits in between, while
  // the user is on the shelf renaming and adding. So mutations run one at a time.
  //
  // This is one store's queue over its own file, not a lock on the file. The
  // sync engine writes topics.json through syncFs without taking anything, and
  // nothing here ever waits on the sync engine, so neither can be left waiting
  // on the other. A mutation overlapping a pull costs what it always did — one
  // of the two writes lands whole — which is what the shelf's pull route
  // re-reads for.
  //
  // In the closure rather than at module scope: a chain is a queue of work, and
  // a queue shared by everything that ever imported this file makes one caller's
  // unfinished write the thing the next caller waits behind.
  let mutations: Promise<unknown> = Promise.resolve();

  function serialize<T>(run: () => Promise<T>): Promise<T> {
    // Run whether the one before resolved or rejected, and keep the chain's own
    // handle settled: a mutation that throws must neither block the next one nor
    // surface here as an unhandled rejection. The caller still gets the rejection.
    const next = mutations.then(run, run);
    mutations = next.catch(() => {});
    return next;
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

  // Every read hands out repaired references, whether or not the file on disk has
  // been rewritten yet.
  async function load(): Promise<TopicFile> {
    return { topics: healTopics((await readStore()).topics) };
  }

  function save(store: TopicFile): Promise<void> {
    return io.write(JSON.stringify(store, null, 2));
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
    addFile: (id, rawPath) => {
      const path = normalizeFilePath(rawPath);
      return serialize(async () => {
        const store = await load();
        const topic = store.topics.find((t) => t.id === id);
        if (!topic || topic.files.some((f) => f.path === path)) return;
        topic.files.push({ path, name: basename(path), addedAt: io.now() });
        await save(store);
      });
    },

    removeFile: (id, path) =>
      serialize(async () => {
        const store = await load();
        const topic = store.topics.find((t) => t.id === id);
        if (!topic) return;
        topic.files = topic.files.filter((f) => f.path !== path);
        await save(store);
      }),

    // Record a file's book id (content hash) once known. Matched by path within
    // the topic; a no-op if already set to the same hash.
    //
    // This one and markOpened below are backfills that ride along with opening a
    // book, so an unreadable file makes them do nothing rather than raise: the
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

export function deleteTopic(id: string): Promise<void> {
  return store.remove(id);
}

export function addFileToTopic(id: string, rawPath: string): Promise<void> {
  return store.addFile(id, rawPath);
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
