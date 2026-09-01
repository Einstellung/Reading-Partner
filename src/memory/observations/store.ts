// Per-topic observation store over an injected filesystem, so the whole write
// path runs headless in tests (live.ts binds the Tauri fs). Layout, one
// directory per topic under AppData:
//   memory-<topicId>/<id>.md   — one observation per file (frontmatter + body)
//   memory-<topicId>/index.md  — one line per observation; loaded into context
//   memory-<topicId>/meta.json — bookkeeping (when the last distillation ran)
//   memory-<topicId>/deleted-observations.jsonl — one line per deletion
// The "memory-" prefix is the historical on-disk name, kept deliberately: the
// feature was renamed to AI observations on 2026-08-06 but the directories hold
// real synced data, so the paths and the meta.json field names never moved.
// The entry files are the source of truth; the index is derived and rebuilt
// after every mutation (a topic holds tens of observations, not thousands).

import {
  appendTombstone,
  buildIndex,
  isoDate,
  oneLine,
  parseIndex,
  parseObservation,
  parseTombstones,
  serializeObservation,
} from "./files";
import { cleanObservationBody } from "./residue";
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
  // id. Both paths write it, over disjoint thread ids: a retell is left and
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

// One line per deleted observation: `{"id":"m-1234abcd","at":"2026-08-31"}`.
//
// Removing the entry file is not a deletion that survives. Sync propagates no
// file deletion by design — reconcile.ts leaves a file missing locally but
// present remotely alone, so nothing is ever destroyed by a sync — and the other
// device then republishes its copy at a higher revision. Measured on the owner's
// store 2026-08-31: 106 entry files on disk against a 103-line index, the three
// ids the index was missing (m-fb109f9c, m-0fe3bfb7, m-883ca3e9) all deliberately
// merged into another entry and deleted, all three back from the other device;
// m-883ca3e9 and m-fb109f9c arrived at rev 1 a week after the entry recording
// their deletion was written. The next rebuildIndex would have put them back in
// a prompt. So a deletion is written down as a record of its own, in a file the
// records strategy unions across devices (platform/sync/merge/records.ts): a
// tombstone can arrive from either side and can never be lost.
//
// A list of what is deleted, deliberately not a manifest of what exists. The
// iPad runs an older build this one cannot upgrade and cannot detect; if this
// file said which ids exist, every observation that build creates would be
// absent from it and so invisible here. Existence stays with the entry files.
const TOMBSTONE_FILE = "deleted-observations.jsonl";

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

// `updated` never moves backwards. It is the last day this observation's
// evidence covers, and that evidence is everything ever anchored to it rather
// than only what the newest pass cited — the sweep works through its backlog
// oldest-first, so a pass folding in an older conversation must not make an
// observation look older than what it already carries.
function laterDay(a: string, b: string): string {
  return a > b ? a : b;
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

  private get tombstonePath(): string {
    return `${this.dir}/${TOMBSTONE_FILE}`;
  }

  private async readTombstones(): Promise<Set<string>> {
    return parseTombstones((await this.fs.read(this.tombstonePath)) ?? "");
  }

  // A tombstoned id does not exist, whether or not its file is still on disk —
  // and it usually is, because the other device keeps pushing it back. One
  // answer for the whole store: if get() handed back an entry that list() and
  // the index refuse to show, update() would rewrite that file and the store
  // would be contradicting itself about the same id.
  async get(id: string): Promise<Observation | null> {
    if ((await this.readTombstones()).has(id)) return null;
    const text = await this.fs.read(this.entryPath(id));
    return text === null ? null : parseObservation(text);
  }

  // All observations, read from the entry files (index-independent) minus the
  // tombstoned ids, newest first. A read never writes the tombstone file: the
  // topic that has none has no deletions, which is the same answer.
  async list(): Promise<Observation[]> {
    return this.readEntries(await this.fs.listDir(this.dir), await this.readTombstones());
  }

  private async readEntries(names: string[], deleted: Set<string>): Promise<Observation[]> {
    const entries: Observation[] = [];
    for (const name of names) {
      const m = ENTRY_FILE.exec(name);
      if (!m || deleted.has(m[1])) continue;
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

  // Dated by the evidence it was anchored to, not by the day the pass ran:
  // `created` is the first day that evidence covers, `updated` the last. The
  // sweep comes back to a thread every half hour for as long as it is owed, so
  // a conversation is distilled days after it happened — on one real store 38
  // of 110 placeable observations carry a date their own evidence does not
  // support, the worst off by 17 days.
  //
  // The clock is the fallback and nothing more: it is reached only where the
  // evidence carries no day at all, which in practice is a live conversation,
  // and there the clock is the right answer because the conversation is now.
  async create(input: RetainInput): Promise<Observation> {
    const clock = isoDate(this.now());
    // Cleaned on the way in, not on the way out. 29 of 140 bodies on the
    // owner's store carry tool-call XML a model wrote while it was mid-call,
    // the newest on 2026-08-27, and every anchor buried in one of those blocks
    // was invisible to every index (residue.ts).
    const cleaned = cleanObservationBody(input.body.trim(), normalizeAnchors(input.anchors));
    const entry: Observation = {
      id: newId(),
      type: input.type,
      summary: oneLine(input.summary),
      body: cleaned.body,
      created: input.observed?.first ?? clock,
      updated: input.observed?.last ?? clock,
      anchors: cleaned.anchors,
      ...(input.bookId ? { bookId: input.bookId } : {}),
    };
    await this.fs.write(this.entryPath(entry.id), serializeObservation(entry));
    await this.rebuildIndex();
    return entry;
  }

  // Update in place: `created` is preserved, `updated` moves to the last day the
  // evidence covers. This is also the evolution path — the distiller rewrites
  // summary/body to carry both the old state and the resolution.
  //
  // `created` stays where it was even when this pass's evidence is older,
  // because it answers when this was first observed, not when the oldest
  // evidence now attached to it happened.
  async update(id: string, patch: ObservationPatch): Promise<Observation | null> {
    const prev = await this.get(id);
    if (!prev) return null;
    // Only a rewritten body is cleaned. One this build already wrote is clean,
    // and one it did not is a file on disk that a correction of some other
    // field must not quietly rewrite — repairing those is migration work.
    // Anchors found in a rewritten body still merge into whatever the entry
    // ends up with, patch or previous.
    const cleaned = cleanObservationBody(
      patch.body !== undefined ? patch.body.trim() : "",
      patch.anchors !== undefined ? normalizeAnchors(patch.anchors) : prev.anchors,
    );
    const entry: Observation = {
      ...prev,
      type: patch.type ?? prev.type,
      summary: patch.summary !== undefined ? oneLine(patch.summary) : prev.summary,
      body: patch.body !== undefined ? cleaned.body : prev.body,
      anchors: cleaned.anchors,
      // Filled in when the entry predates the field; never overwritten, because
      // the session correcting an observation is not always the one it is about.
      ...(prev.bookId ?? patch.bookId ? { bookId: prev.bookId ?? patch.bookId } : {}),
      updated:
        patch.observed === undefined ? isoDate(this.now()) : laterDay(prev.updated, patch.observed.last),
    };
    await this.fs.write(this.entryPath(id), serializeObservation(entry));
    await this.rebuildIndex();
    return entry;
  }

  // The tombstone is written before the file is removed: a tombstone whose entry
  // file is still there is the steady state anyway (the other device pushes it
  // back), while a file removed with no tombstone is exactly the bug above.
  // Deleting an id that is already tombstoned succeeds without writing a second
  // line — asking for something to be gone again is not an error.
  async delete(id: string): Promise<boolean> {
    const text = (await this.fs.read(this.tombstonePath)) ?? "";
    const tombstoned = parseTombstones(text).has(id);
    const onDisk = (await this.fs.read(this.entryPath(id))) !== null;
    if (!tombstoned && !onDisk) return false;
    if (!tombstoned) {
      await this.fs.write(this.tombstonePath, appendTombstone(text, id, isoDate(this.now())));
    }
    if (onDisk) await this.fs.remove(this.entryPath(id));
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
  //
  // A topic with no tombstone file gets an empty one here and nothing else. On a
  // store written before this file existed, an entry on disk and absent from the
  // index cannot be told from one the other device created and synced in before
  // this device last rebuilt — the owner's three arrived by exactly that route —
  // so the migration deletes nothing and infers nothing.
  async rebuildIndex(): Promise<void> {
    const text = await this.fs.read(this.tombstonePath);
    if (text === null) await this.fs.write(this.tombstonePath, "");
    const names = await this.fs.listDir(this.dir);
    const entries = await this.readEntries(names, parseTombstones(text ?? ""));
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
