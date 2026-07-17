// Per-topic memory store over an injected filesystem, so the whole write path
// runs headless in tests (live.ts binds the Tauri fs). Layout, one directory
// per topic under AppData:
//   memory-<topicId>/<id>.md   — one memory per file (frontmatter + body)
//   memory-<topicId>/index.md  — one line per memory; what gets loaded into context
//   memory-<topicId>/meta.json — bookkeeping (when the last distillation ran)
// The entry files are the source of truth; the index is derived and rebuilt
// after every mutation (a topic holds tens of memories, not thousands).

import {
  buildIndex,
  isoDate,
  oneLine,
  parseIndex,
  parseMemory,
  serializeMemory,
} from "./files";
import type {
  EvidenceAnchors,
  MemoryEntry,
  MemoryIndexEntry,
  MemoryPatch,
  RetainInput,
} from "./types";

// The few fs operations the store needs, relative paths under the app data dir.
export interface MemoryFs {
  read(path: string): Promise<string | null>; // null when missing
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>; // file names; [] when the dir is missing
}

export interface MemoryMeta {
  lastDistilledAt: number | null;
}

const ENTRY_FILE = /^(m-[0-9a-f]{8})\.md$/;

function newId(): string {
  return `m-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function normalizeAnchors(a?: Partial<EvidenceAnchors>): EvidenceAnchors {
  return {
    annotationIds: a?.annotationIds ?? [],
    messageIds: a?.messageIds ?? [],
  };
}

export class MemoryFileStore {
  private dir: string;

  constructor(
    topicId: string,
    private fs: MemoryFs,
    private now: () => number = Date.now,
  ) {
    this.dir = `memory-${topicId}`;
  }

  private entryPath(id: string): string {
    return `${this.dir}/${id}.md`;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const text = await this.fs.read(this.entryPath(id));
    return text === null ? null : parseMemory(text);
  }

  // All memories, read from the entry files (index-independent), newest first.
  async list(): Promise<MemoryEntry[]> {
    const names = await this.fs.listDir(this.dir);
    const entries: MemoryEntry[] = [];
    for (const name of names) {
      if (!ENTRY_FILE.test(name)) continue;
      const text = await this.fs.read(`${this.dir}/${name}`);
      const entry = text === null ? null : parseMemory(text);
      if (entry) entries.push(entry);
    }
    entries.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
    return entries;
  }

  async create(input: RetainInput): Promise<MemoryEntry> {
    const today = isoDate(this.now());
    const entry: MemoryEntry = {
      id: newId(),
      type: input.type,
      summary: oneLine(input.summary),
      body: input.body.trim(),
      created: today,
      updated: today,
      anchors: normalizeAnchors(input.anchors),
    };
    await this.fs.write(this.entryPath(entry.id), serializeMemory(entry));
    await this.rebuildIndex();
    return entry;
  }

  // Update in place: `created` is preserved, `updated` bumps to today. This is
  // also the evolution path — the distiller rewrites summary/body to carry both
  // the old state and the resolution.
  async update(id: string, patch: MemoryPatch): Promise<MemoryEntry | null> {
    const prev = await this.get(id);
    if (!prev) return null;
    const entry: MemoryEntry = {
      ...prev,
      type: patch.type ?? prev.type,
      summary: patch.summary !== undefined ? oneLine(patch.summary) : prev.summary,
      body: patch.body !== undefined ? patch.body.trim() : prev.body,
      anchors: patch.anchors !== undefined ? normalizeAnchors(patch.anchors) : prev.anchors,
      updated: isoDate(this.now()),
    };
    await this.fs.write(this.entryPath(id), serializeMemory(entry));
    await this.rebuildIndex();
    return entry;
  }

  async delete(id: string): Promise<boolean> {
    if ((await this.get(id)) === null) return false;
    await this.fs.remove(this.entryPath(id));
    await this.rebuildIndex();
    return true;
  }

  // The raw index text — the exact lines a prompt loads.
  async readIndexText(): Promise<string> {
    return (await this.fs.read(`${this.dir}/index.md`)) ?? "";
  }

  async readIndex(): Promise<MemoryIndexEntry[]> {
    return parseIndex(await this.readIndexText());
  }

  // Regenerate the index from the entry files (they are the source of truth).
  async rebuildIndex(): Promise<void> {
    const entries = await this.list();
    await this.fs.write(
      `${this.dir}/index.md`,
      buildIndex(entries.map(({ id, type, summary, updated }) => ({ id, type, summary, updated }))),
    );
  }

  async getMeta(): Promise<MemoryMeta> {
    try {
      const raw = await this.fs.read(`${this.dir}/meta.json`);
      if (raw === null) return { lastDistilledAt: null };
      const parsed = JSON.parse(raw) as MemoryMeta;
      return { lastDistilledAt: parsed.lastDistilledAt ?? null };
    } catch {
      return { lastDistilledAt: null };
    }
  }

  async setMeta(meta: MemoryMeta): Promise<void> {
    await this.fs.write(`${this.dir}/meta.json`, JSON.stringify(meta, null, 2));
  }
}
