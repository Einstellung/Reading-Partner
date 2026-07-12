// Topic library. A topic is the top-level container for syntopical reading —
// several PDFs read against one question (docs/01 §1). Topics store only path
// references; files are never copied. Persisted to AppData/topics.json.

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { basename } from "./storage";

const TOPICS_FILE = "topics.json";

export interface FileRef {
  path: string;
  name: string;
  addedAt: number;
  lastOpenedAt?: number;
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

async function ensureDir(): Promise<void> {
  try {
    if (!(await exists("", { baseDir: BaseDirectory.AppData }))) {
      await mkdir("", { baseDir: BaseDirectory.AppData, recursive: true });
    }
  } catch {
    // A real problem resurfaces on the write below.
  }
}

// Missing/corrupt file reads as an empty library; genuine write failures
// propagate so the caller can warn (never silently lose a topic).
async function load(): Promise<Store> {
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

async function save(store: Store): Promise<void> {
  await ensureDir();
  await writeTextFile(TOPICS_FILE, JSON.stringify(store, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
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

export async function addFileToTopic(id: string, path: string): Promise<void> {
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
