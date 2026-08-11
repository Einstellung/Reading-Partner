// Topic library. A topic is the top-level container for syntopical reading —
// several PDFs read against one question (docs/01 §1). Topics store only path
// references; files are never copied. Persisted to AppData/topics.json.

import {
  BaseDirectory,
  exists,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "./atomic-fs";
import { basename, decodeLegacyName, normalizeFilePath } from "./path";

const TOPICS_FILE = "topics.json";

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

interface Store {
  topics: Topic[];
}

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

// Missing/corrupt file reads as an empty library; genuine write failures
// propagate so the caller can warn (never silently lose a topic).
async function read(): Promise<Store> {
  try {
    if (!(await exists(TOPICS_FILE, { baseDir: BaseDirectory.AppData }))) {
      return { topics: [] };
    }
    const parsed = JSON.parse(
      await readTextFile(TOPICS_FILE, { baseDir: BaseDirectory.AppData }),
    ) as Store;
    return Array.isArray(parsed.topics) ? parsed : { topics: [] };
  } catch {
    return { topics: [] };
  }
}

// Every read hands out repaired references, whether or not the file on disk has
// been rewritten yet.
async function load(): Promise<Store> {
  const store = await read();
  return { topics: healTopics(store.topics) };
}

// Rewrite the file once with the repaired paths and names. A clean file writes
// nothing, so this can run at every launch without producing a sync revision.
// Returns whether it wrote.
export async function repairTopicPaths(): Promise<boolean> {
  const store = await read();
  const healed = healTopics(store.topics);
  if (healed === store.topics) return false;
  await save({ topics: healed });
  return true;
}

async function save(store: Store): Promise<void> {
  await writeTextAtomic(TOPICS_FILE, JSON.stringify(store, null, 2));
}

export async function listTopics(): Promise<Topic[]> {
  const { topics } = await load();
  return topics.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createTopic(name: string): Promise<Topic> {
  const store = await load();
  const topic: Topic = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled",
    createdAt: Date.now(),
    files: [],
  };
  store.topics.push(topic);
  await save(store);
  return topic;
}

// Where saved info articles land until anything smarter exists (docs/21). A
// fixed id, not a name match: the user may rename it, and it still has to be
// recognizable. Both devices derive the same id, so the two copies merge as one
// topic record rather than becoming two topics named "Brief".
export const BRIEF_TOPIC_ID = "brief";
const BRIEF_TOPIC_NAME = "Brief";

// The Brief topic, created on first use. Idempotent by id.
export async function ensureBriefTopic(): Promise<Topic> {
  const store = await load();
  const found = store.topics.find((t) => t.id === BRIEF_TOPIC_ID);
  if (found) return found;
  const topic: Topic = {
    id: BRIEF_TOPIC_ID,
    name: BRIEF_TOPIC_NAME,
    createdAt: Date.now(),
    files: [],
  };
  store.topics.push(topic);
  await save(store);
  return topic;
}

export async function renameTopic(id: string, name: string): Promise<void> {
  const store = await load();
  const topic = store.topics.find((t) => t.id === id);
  if (!topic) return;
  topic.name = name.trim() || topic.name;
  await save(store);
}

export async function deleteTopic(id: string): Promise<void> {
  const store = await load();
  store.topics = store.topics.filter((t) => t.id !== id);
  await save(store);
}

// The one door a host path comes through: the file picker hands back a plain
// path on desktop and a percent-encoded file URL on iOS, and everything stored
// downstream (the library title, the notes state's book name) is derived from
// what lands here. Normalize once, at the door.
export async function addFileToTopic(id: string, rawPath: string): Promise<void> {
  const path = normalizeFilePath(rawPath);
  const store = await load();
  const topic = store.topics.find((t) => t.id === id);
  if (!topic || topic.files.some((f) => f.path === path)) return;
  topic.files.push({ path, name: basename(path), addedAt: Date.now() });
  await save(store);
}

export async function removeFileFromTopic(id: string, path: string): Promise<void> {
  const store = await load();
  const topic = store.topics.find((t) => t.id === id);
  if (!topic) return;
  topic.files = topic.files.filter((f) => f.path !== path);
  await save(store);
}

// Record a file's book id (content hash) once known. Matched by path within the
// topic; a no-op if already set to the same hash.
export async function setFileHash(id: string, path: string, hash: string): Promise<void> {
  const store = await load();
  const file = store.topics.find((t) => t.id === id)?.files.find((f) => f.path === path);
  if (!file || file.hash === hash) return;
  file.hash = hash;
  await save(store);
}

export async function markOpened(id: string, path: string): Promise<void> {
  const store = await load();
  const file = store.topics.find((t) => t.id === id)?.files.find((f) => f.path === path);
  if (!file) return;
  file.lastOpenedAt = Date.now();
  await save(store);
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
