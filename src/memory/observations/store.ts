// The observation store over an injected filesystem, so the whole write path
// runs headless in tests (live.ts binds the Tauri fs). One flat directory under
// AppData for the whole library:
//   observations/<id>.md   — one observation per file (frontmatter + body)
//   observations/index.md  — one line per observation, each naming its topic
//   observations/meta.json — distillation bookkeeping, cursors and rate limits
//   observations/deleted-observations.jsonl — one line per deletion
//
// Flat because an id is already global (m-<16 hex>) and every consumer that
// crossed topics had to walk the directories to get there: resolving a
// statement's evidence, a search that reaches past the book in hand, a night
// pass reading everything. A topic is a field on the record instead — an
// archival label, renamed and merged and split, never a retrieval key (docs/48).
// Which topic a caller wants is a filter over that field, and the index carries
// it so the filter costs no file reads.
//
// The entry files are the source of truth; the index is derived and rebuilt
// after every mutation (the store holds hundreds of observations, not
// millions).

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
  EvidenceDates,
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

// One topic's view of the bookkeeping file. The scalars are that topic's; the
// two cursor maps are the whole store's, because their keys already say what
// they are about — a thread id and a book id, both global.
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

// meta.json as it sits on disk. The two stamps are keyed by topic id, because
// what they mean is per topic and there is now one file for every topic:
// lastDistilledAt is the rate limit isTopicDue waits out (arrears.ts), and one
// shared stamp would make a pass over one topic hold every other topic back.
// The cursor maps are keyed by thread and by book and so need no such split.
interface StoredObservationMeta {
  lastDistilledAt?: Record<string, number>;
  lastAnnotationDistillAt?: Record<string, number>;
  distilledMessages?: Record<string, number>;
  distilledMarks?: Record<string, number>;
}

function numberMap(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

// Either width. The migration widens every id from 8 to 16 hex (src/migrate),
// and a device that has not run it yet still holds narrow files — a build that
// could not see those is worse than one that sees both. Narrows to 16 at 0.13,
// when the migration directory is deleted.
const ENTRY_FILE = /^(m-(?:[0-9a-f]{16}|[0-9a-f]{8}))\.md$/;

// A conflict copy sync left beside an entry: `<id>.conflict-<digest>.md`, the
// whole losing version of a file two devices both edited (platform/sync/merge).
// ENTRY_FILE is deliberately narrow enough not to match one — a copy must not
// join the index or a prompt, and must not be rewritten by a later update — but
// nothing else matched them either, so the reader's own writing sat on disk with
// no way to know it was there. This is that way.
// Either width, for as long as ENTRY_FILE is; narrows to 16 at 0.13.
const CONFLICT_FILE = /^(m-(?:[0-9a-f]{16}|[0-9a-f]{8}))\.conflict-[0-9a-f]+\.md$/;

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

// The one directory every observation lives in.
const DIR = "observations";

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

// 16 hex, the same 64-bit shape a message id has (platform/app/threads.ts).
// Eight was 32 bits, and the migration that widens what is already on disk
// (src/migrate) would be undone on the next write by a build still minting
// narrow ones.
function newId(): string {
  return `m-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// `updated` never moves backwards. It is the last day this observation's
// evidence covers, and that evidence is everything ever anchored to it rather
// than only what the newest pass cited — the sweep works through its backlog
// oldest-first, so a pass folding in an older conversation must not make an
// observation look older than what it already carries.
function laterDay(a: string, b: string): string {
  return a > b ? a : b;
}

function appendUnique(existing: readonly string[], added: readonly string[]): string[] {
  const out = [...existing];
  const seen = new Set(existing);
  for (const item of added) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeAnchors(a?: Partial<EvidenceAnchors>): EvidenceAnchors {
  return {
    annotationIds: a?.annotationIds ?? [],
    messageIds: a?.messageIds ?? [],
  };
}

export class ObservationFileStore {
  private dir = DIR;

  constructor(
    private fs: ObservationFs,
    private now: () => number = Date.now,
  ) {}

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
  // store that has none has no deletions, which is the same answer.
  //
  // `topic` filters on the archival label, which is what a caller asking for
  // "this topic's observations" means. Filtering rather than addressing: an
  // entry written before the field existed belongs to no topic and is left out
  // of every topic's list, which is the migration's business to fix, not this
  // read's to guess at.
  async list(topic?: string): Promise<Observation[]> {
    return this.readEntries(await this.fs.listDir(this.dir), await this.readTombstones(), topic);
  }

  private async readEntries(
    names: string[],
    deleted: Set<string>,
    topic?: string,
  ): Promise<Observation[]> {
    const entries: Observation[] = [];
    for (const name of names) {
      const m = ENTRY_FILE.exec(name);
      if (!m || deleted.has(m[1])) continue;
      const text = await this.fs.read(`${this.dir}/${name}`);
      const entry = text === null ? null : parseObservation(text);
      if (entry && (topic === undefined || entry.topic === topic)) entries.push(entry);
    }
    entries.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
    return entries;
  }

  // The conflict copies sitting in the store, oldest name first.
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
      ...(input.topic ? { topic: input.topic } : {}),
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

  // More evidence for an observation that already says what it says. The
  // anchors are appended and de-duplicated, `updated` moves to the last day the
  // new evidence covers, and the body is not touched at all.
  //
  // Separate from update() rather than a call into it, because update() rewrites
  // and re-cleans the body it is given: the caller here has no body to give and
  // is not correcting the text. Anchoring a second conversation to a stuck point
  // the reader is still stuck on is a different act from rewriting what the
  // stuck point says, and only the second one costs a model call.
  //
  // `updated` never moves backwards (laterDay) and falls back to the clock only
  // where the new evidence carries no day, which is a live conversation — the
  // same rule and the same reason as create() and update().
  async appendAnchors(
    id: string,
    anchors: Partial<EvidenceAnchors>,
    observed?: EvidenceDates,
  ): Promise<Observation | null> {
    const prev = await this.get(id);
    if (!prev) return null;
    const entry: Observation = {
      ...prev,
      anchors: {
        annotationIds: appendUnique(prev.anchors.annotationIds, anchors.annotationIds ?? []),
        messageIds: appendUnique(prev.anchors.messageIds, anchors.messageIds ?? []),
      },
      updated: laterDay(prev.updated, observed ? observed.last : isoDate(this.now())),
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

  // The index as a prompt loads it. Without a topic that is the file verbatim,
  // every line naming the topic it belongs to; with one it is that topic's lines
  // with the topic segment dropped, because a prompt built for one topic would
  // print the same id on every line and a model has nothing to do with it.
  async readIndexText(topic?: string): Promise<string> {
    const raw = (await this.fs.read(`${this.dir}/index.md`)) ?? "";
    if (topic === undefined) return raw;
    const mine = parseIndex(raw)
      .filter((e) => e.topic === topic)
      .map(({ topic: _topic, ...rest }) => rest);
    return buildIndex(mine);
  }

  async readIndex(topic?: string): Promise<ObservationIndexEntry[]> {
    return parseIndex(await this.readIndexText(topic));
  }

  // Regenerate the index from the entry files (they are the source of truth),
  // and drop any conflict copy of the index while here — see INDEX_CONFLICT_FILE.
  // An entry's own copies are left alone: those are versions of what the model
  // wrote about the reader, and the panel shows them.
  //
  // A store with no tombstone file gets an empty one here and nothing else. On a
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
      buildIndex(
        entries.map(({ id, type, summary, updated, topic }) => ({
          id,
          type,
          summary,
          updated,
          ...(topic ? { topic } : {}),
        })),
      ),
    );
    for (const name of names) {
      if (INDEX_CONFLICT_FILE.test(name)) await this.fs.remove(`${this.dir}/${name}`);
    }
  }

  private async readStoredMeta(): Promise<StoredObservationMeta> {
    try {
      const raw = await this.fs.read(`${this.dir}/meta.json`);
      if (raw === null) return {};
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        lastDistilledAt: numberMap(parsed.lastDistilledAt),
        lastAnnotationDistillAt: numberMap(parsed.lastAnnotationDistillAt),
        distilledMessages: numberMap(parsed.distilledMessages),
        distilledMarks: numberMap(parsed.distilledMarks),
      };
    } catch {
      return {};
    }
  }

  async getMeta(topicId: string): Promise<ObservationMeta> {
    const stored = await this.readStoredMeta();
    const messages = stored.distilledMessages ?? {};
    const marks = stored.distilledMarks ?? {};
    return {
      lastDistilledAt: stored.lastDistilledAt?.[topicId] ?? null,
      lastAnnotationDistillAt: stored.lastAnnotationDistillAt?.[topicId] ?? null,
      ...(Object.keys(messages).length ? { distilledMessages: messages } : {}),
      ...(Object.keys(marks).length ? { distilledMarks: marks } : {}),
    };
  }

  // Read-modify-write, so a pass over one topic cannot drop another topic's
  // stamp. The cursor maps are written as given: the caller got them from
  // getMeta and merged its own entries into them, which is the same discipline
  // the per-topic file already needed between the transcript and retell paths.
  async setMeta(topicId: string, meta: ObservationMeta): Promise<void> {
    const stored = await this.readStoredMeta();
    const next: StoredObservationMeta = {
      lastDistilledAt: { ...(stored.lastDistilledAt ?? {}) },
      lastAnnotationDistillAt: { ...(stored.lastAnnotationDistillAt ?? {}) },
      distilledMessages: meta.distilledMessages ?? stored.distilledMessages ?? {},
      distilledMarks: meta.distilledMarks ?? stored.distilledMarks ?? {},
    };
    if (meta.lastDistilledAt === null) delete next.lastDistilledAt?.[topicId];
    else next.lastDistilledAt![topicId] = meta.lastDistilledAt;
    if (meta.lastAnnotationDistillAt === null) delete next.lastAnnotationDistillAt?.[topicId];
    else next.lastAnnotationDistillAt![topicId] = meta.lastAnnotationDistillAt;
    await this.fs.write(`${this.dir}/meta.json`, JSON.stringify(next, null, 2));
  }
}

// The three things a distillation pass asks of the store, bound to one topic.
// The pass itself has no topic — it is handed a transcript and an index — so the
// binding happens here rather than being threaded through every call.
export interface TopicPassStore {
  getMeta(): Promise<ObservationMeta>;
  setMeta(meta: ObservationMeta): Promise<void>;
  readIndexText(): Promise<string>;
}

export function topicPassStore(store: ObservationFileStore, topicId: string): TopicPassStore {
  return {
    getMeta: () => store.getMeta(topicId),
    setMeta: (meta) => store.setMeta(topicId, meta),
    readIndexText: () => store.readIndexText(topicId),
  };
}
