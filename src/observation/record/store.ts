// Per-topic observation store over an injected filesystem, so the whole write
// path runs headless in tests (live.ts binds the Tauri fs). Layout, one
// directory per topic under AppData:
//   memory-<topicId>/<id>.md   — one observation per file (frontmatter + body)
//   memory-<topicId>/index.md  — one line per observation; loaded into context
//   memory-<topicId>/meta.json — bookkeeping (when the last distillation ran)
// The "memory-" prefix is the historical on-disk name, kept deliberately: the
// feature was renamed to AI observations on 2026-08-06 but the directories hold
// real synced data, so the paths and the meta.json field names never moved.
// The entry files are the source of truth; the index is derived and rebuilt
// after every mutation (a topic holds tens of observations, not thousands).

import {
  buildIndex,
  isoDate,
  oneLine,
  parseIndex,
  parseObservation,
  serializeObservation,
} from "./files";
import type {
  EvidenceAnchors,
  Observation,
  ObservationIndexEntry,
  ObservationPatch,
  RetainInput,
} from "./types";

// The few fs operations the store needs, relative paths under the app data dir.
export interface ObservationFs {
  read(path: string): Promise<string | null>; // null when missing
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>; // file names; [] when the dir is missing
}

export interface ObservationMeta {
  lastDistilledAt: number | null;
  // Where the reader's silent marks had been folded in to, before the cursor
  // became per book. Still read as the seed for a book that has never been
  // distilled; no longer written. Keeping it means an upgrade does not re-distil
  // every mark ever made.
  lastAnnotationDistillAt: number | null;
  // How many messages of a conversation have already been distilled, by thread
  // id. Both paths write it, over disjoint thread ids: a rehearsal is left and
  // re-entered over days (docs/31), and a reading thread is distilled again and
  // again by the arrears sweep (arrears.ts). Neither may drop the other's
  // bookkeeping when it writes here.
  distilledMessages?: Record<string, number>;
  // The newest mark folded in, by book id. Per book because a topic is several
  // books read against one question (docs/01 §1): one topic-wide cursor advanced
  // by a pass over book A puts book B's older marks behind it, and they are then
  // never observed.
  distilledMarks?: Record<string, number>;
}

const ENTRY_FILE = /^(m-[0-9a-f]{8})\.md$/;

// A conflict copy sync left beside an entry: `<id>.conflict-<digest>.md`, the
// whole losing version of a file two devices both edited (platform/sync/merge).
// ENTRY_FILE is deliberately narrow enough not to match one — a copy must not
// join the index or a prompt, and must not be rewritten by a later update — but
// nothing else matched them either, so the reader's own writing sat on disk with
// no way to know it was there. This is that way.
const CONFLICT_FILE = /^(m-[0-9a-f]{8})\.conflict-[0-9a-f]+\.md$/;

// A conflict copy of the index, which is a different thing entirely: the index
// is derived — rebuilt from the entry files after every mutation — so a losing
// version of it holds nothing the entry files do not already say. Sync has no
// way to know that (a .md file is prose to it) and parks a copy that then
// travels between devices forever. Deleted by rebuildIndex, the one place that
// owns this file's content.
const INDEX_CONFLICT_FILE = /^index\.conflict-[0-9a-f]+\.md$/;

// One conflict copy, parsed here so a renderer never has to know the file
// format. The fields are empty when the copy does not parse, which leaves the
// path — and the path is what makes it findable either way.
export interface ObservationConflict {
  // Path under the app data dir.
  path: string;
  // The observation this is a copy of.
  id: string;
  summary: string;
  body: string;
  updated: string;
}

function newId(): string {
  return `m-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function normalizeAnchors(a?: Partial<EvidenceAnchors>): EvidenceAnchors {
  return {
    annotationIds: a?.annotationIds ?? [],
    messageIds: a?.messageIds ?? [],
  };
}

export class ObservationFileStore {
  private dir: string;

  constructor(
    topicId: string,
    private fs: ObservationFs,
    private now: () => number = Date.now,
  ) {
    // Historical directory name, not a leftover: see the header.
    this.dir = `memory-${topicId}`;
  }

  private entryPath(id: string): string {
    return `${this.dir}/${id}.md`;
  }

  async get(id: string): Promise<Observation | null> {
    const text = await this.fs.read(this.entryPath(id));
    return text === null ? null : parseObservation(text);
  }

  // All observations, read from the entry files (index-independent), newest first.
  async list(): Promise<Observation[]> {
    return this.readEntries(await this.fs.listDir(this.dir));
  }

  private async readEntries(names: string[]): Promise<Observation[]> {
    const entries: Observation[] = [];
    for (const name of names) {
      if (!ENTRY_FILE.test(name)) continue;
      const text = await this.fs.read(`${this.dir}/${name}`);
      const entry = text === null ? null : parseObservation(text);
      if (entry) entries.push(entry);
    }
    entries.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
    return entries;
  }

  // The conflict copies sitting in this topic's directory, oldest name first.
  // Read-only and separate from list(): a copy is a second version of one
  // observation, not a second observation, so nothing derived — the index, a
  // prompt, recall — may take it for one.
  async listConflicts(): Promise<ObservationConflict[]> {
    const names = await this.fs.listDir(this.dir);
    const out: ObservationConflict[] = [];
    for (const name of names) {
      const m = CONFLICT_FILE.exec(name);
      if (!m) continue;
      const path = `${this.dir}/${name}`;
      const text = await this.fs.read(path);
      const entry = text === null ? null : parseObservation(text);
      out.push({
        path,
        id: m[1],
        summary: entry?.summary ?? "",
        body: entry?.body ?? "",
        updated: entry?.updated ?? "",
      });
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  async create(input: RetainInput): Promise<Observation> {
    const today = isoDate(this.now());
    const entry: Observation = {
      id: newId(),
      type: input.type,
      summary: oneLine(input.summary),
      body: input.body.trim(),
      created: today,
      updated: today,
      anchors: normalizeAnchors(input.anchors),
      ...(input.bookId ? { bookId: input.bookId } : {}),
    };
    await this.fs.write(this.entryPath(entry.id), serializeObservation(entry));
    await this.rebuildIndex();
    return entry;
  }

  // Update in place: `created` is preserved, `updated` bumps to today. This is
  // also the evolution path — the distiller rewrites summary/body to carry both
  // the old state and the resolution.
  async update(id: string, patch: ObservationPatch): Promise<Observation | null> {
    const prev = await this.get(id);
    if (!prev) return null;
    const entry: Observation = {
      ...prev,
      type: patch.type ?? prev.type,
      summary: patch.summary !== undefined ? oneLine(patch.summary) : prev.summary,
      body: patch.body !== undefined ? patch.body.trim() : prev.body,
      anchors: patch.anchors !== undefined ? normalizeAnchors(patch.anchors) : prev.anchors,
      // Filled in when the entry predates the field; never overwritten, because
      // the session correcting an observation is not always the one it is about.
      ...(prev.bookId ?? patch.bookId ? { bookId: prev.bookId ?? patch.bookId } : {}),
      updated: isoDate(this.now()),
    };
    await this.fs.write(this.entryPath(id), serializeObservation(entry));
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

  async readIndex(): Promise<ObservationIndexEntry[]> {
    return parseIndex(await this.readIndexText());
  }

  // Regenerate the index from the entry files (they are the source of truth),
  // and drop any conflict copy of the index while here — see INDEX_CONFLICT_FILE.
  // An entry's own copies are left alone: those are versions of what the model
  // wrote about the reader, and the panel shows them.
  async rebuildIndex(): Promise<void> {
    const names = await this.fs.listDir(this.dir);
    const entries = await this.readEntries(names);
    await this.fs.write(
      `${this.dir}/index.md`,
      buildIndex(entries.map(({ id, type, summary, updated }) => ({ id, type, summary, updated }))),
    );
    for (const name of names) {
      if (INDEX_CONFLICT_FILE.test(name)) await this.fs.remove(`${this.dir}/${name}`);
    }
  }

  async getMeta(): Promise<ObservationMeta> {
    try {
      const raw = await this.fs.read(`${this.dir}/meta.json`);
      if (raw === null) return { lastDistilledAt: null, lastAnnotationDistillAt: null };
      const parsed = JSON.parse(raw) as Partial<ObservationMeta>;
      return {
        lastDistilledAt: parsed.lastDistilledAt ?? null,
        lastAnnotationDistillAt: parsed.lastAnnotationDistillAt ?? null,
        ...(parsed.distilledMessages ? { distilledMessages: parsed.distilledMessages } : {}),
        ...(parsed.distilledMarks ? { distilledMarks: parsed.distilledMarks } : {}),
      };
    } catch {
      return { lastDistilledAt: null, lastAnnotationDistillAt: null };
    }
  }

  async setMeta(meta: ObservationMeta): Promise<void> {
    await this.fs.write(`${this.dir}/meta.json`, JSON.stringify(meta, null, 2));
  }
}
