// The catalogue: one row per kind of data the app keeps, and everything that is
// true of it independent of who reads it — where it sits, what identifies one,
// what it points at, whether it syncs and how it merges, what its deletion is
// tied to, whether a distillation pass reads it (docs/61).
//
// Five hand-written lists used to answer these questions separately and none of
// them was checked against the others: the sync range, the never-infer-delete
// set, the merge strategy table, the dead paths of a deleted book, and the
// distillation arrears. They are derived from this table instead, so a new file
// is one decision made once rather than five decisions nobody reconciles.
//
// Pure data and pure functions. This file imports nothing under src/ except the
// merge vocabulary beside it, and it must stay that way: platform/sync reads the
// table, so anything the table reached for would come back round as a cycle.
//
// Order is priority. resolvePalace takes the first row whose match accepts a
// path, so a specific prefix has to sit above the general one it would
// otherwise be swallowed by. Each row's match is anchored as well, so the two
// agree; tests/palace/table.test.ts holds them to it by asserting that every
// sample is claimed by exactly one row.

import type { FieldGroups, MergeStrategy, RecordShape } from "./merge-types";

export type { FieldGroups, MergeStrategy, RecordShape };

// Which channel carries the file, and so whether the reconcile loop sees it at
// all. "books" is the content-addressed blob channel; "remote-only" is a file
// this device publishes for the others and never pulls back as data.
export type SyncChannel = "data" | "books" | "local" | "remote-only";

export type PalaceDomain =
  | "platform"
  | "reading"
  | "info"
  | "memory"
  | "sync"
  | "legacy"
  | "box";

// What the file's own deletion rides on. "never" means nothing deletes it in
// bulk — either it is a record inside a file that travels, or it is an orphan
// nothing has ever cleaned up.
export type DeleteWith =
  | "book"
  | "retell"
  | "outline"
  | "rehearsal"
  | "observation-tombstone"
  | "never";

// What reclaims the space, per docs/58. "domain-housekeeping" is the domain's
// own sweep of its derived files; the three after-distill rules are the disposal
// a distilled source gets once its cursor has passed it.
export type GcRule =
  | "never"
  | "domain-housekeeping"
  | "after-distill-delete"
  | "after-distill-tail"
  | "after-distill-cold";

// What the id captured out of a path means. "fixed" is a file with one name.
export type PalaceId =
  | "bookId"
  | "topicId"
  | "retellId"
  | "outlineId"
  | "rehearsalId"
  | "runId"
  | "date"
  | "deviceId"
  | "hash"
  | "observationId"
  | "threadId"
  | "labId"
  | "boxItemId"
  | "fixed";

// What a record does when the thing it points at is deleted (docs/61). The
// action is declared beside the reference rather than written into the code that
// runs the cascade, so a new kind that points at a topic decides its own fate in
// the row and the cascade is a fold over the table.
//
//   delete   the record is the deleted thing's own work and goes with it, the
//            way docs/50 deletes: the file, and a remote purge for the ones
//            sync would otherwise bring back.
//   clear    the record only tags it. The tag goes, the record stays.
//   reassign the reference is required, so the record moves to the default
//            topic rather than losing a field it cannot be without.
//   keep     nothing to do, and the row says why: an archival label, a cache
//            that rebuilds, or a field nothing writes yet.
export type RefAction = "delete" | "clear" | "reassign" | "keep";

export interface PalaceRow {
  kind: string;
  domain: PalaceDomain;
  // AppData-relative, forward slashes. `id` is the captured key, or null for a
  // fixed name and for a kind whose files carry no id of their own.
  match(path: string): { id: string | null } | null;
  // One path per id; a directory ends with "/", and everything below it belongs
  // to that id. Absent for fixed names and for content-addressed files, whose
  // name cannot be derived from anything but their own bytes.
  pathFor?(id: string): string;
  // The walker's descend rule, on the row that owns the directory. Only kinds
  // the sync walk has to enter carry one: a directory with no row here is never
  // opened, which is what keeps prep-<id>/pdf/ out of a readDir that could only
  // return files the range rejects.
  dir?: {
    // An exact directory name, or a name prefix when it ends with "-".
    prefix: string;
    // How many levels below AppData the walk may descend.
    depth: number;
    // The only named subdirectory allowed at the second level.
    nested?: string;
  };
  // At least one representative path, and every row needs one: the range, the
  // pull coverage check and the palace guards are all built out of these rather
  // than out of paths written down again beside them.
  samples: readonly string[];
  id: PalaceId;
  // What this kind points at, by kind name and by the field carrying the
  // reference, and what becomes of this record when that thing is deleted.
  // Descriptive except for the topics references, which cascadeOfTopic folds
  // into what deleting a topic does (reading/delete/delete-topic.ts).
  refs: ReadonlyArray<{ kind: string; via: string; onDelete?: RefAction }>;
  sync: SyncChannel;
  // How sync merges two edits of it. Present exactly when sync is "data".
  merge?: MergeStrategy;
  // When merge is "records": where the records sit and what identifies one,
  // read off the writer rather than guessed.
  shape?: RecordShape;
  fieldGroups?: FieldGroups;
  // A tree comparison may never conclude this path was deleted (docs/59 §8.8):
  // it is a cursor or an append-only log, and losing it either re-reads every
  // conversation from zero or brings back a deletion that already travelled.
  neverInferDelete?: true;
  deleteWith: DeleteWith;
  gc: GcRule;
  // The distillation that reads this kind as raw material, and the meta map its
  // cursor is keyed in.
  distill?: {
    unit: "thread" | "book-marks" | "file";
    cursor: "distilledMessages" | "distilledMarks" | "new";
  };
  // This kind's data can be put on the desk. The desk kind name is allowed to
  // differ from the row name; deskKind says which one. Both are set by the
  // package that registers the opener, not here.
  desk?: true;
  deskKind?: string;
  // One line saying what this kind is, in the reader's own terms. It is what the
  // soul is shown when it asks what the palace holds (src/soul/catalogue.ts,
  // docs/71), so a row carries one exactly when the soul is meant to know the
  // kind exists: a cache, a marker, a sync ledger, a failure stamp carries none
  // and the soul never sees it.
  about?: string;
  // The contradiction, the orphan status, or the decision the row settles. One
  // line, and never in the shape of an import statement — the layering test
  // reads comments too (pitfall 144).
  note?: string;
}

// --- match helpers ---------------------------------------------------------

type Match = (path: string) => { id: string | null } | null;

function fixed(name: string): Match {
  return (path) => (path === name ? { id: null } : null);
}

// The first capture group is the id.
function keyed(re: RegExp): Match {
  return (path) => {
    const m = re.exec(path);
    return m ? { id: m[1] ?? null } : null;
  };
}

// A whole subtree, with no id of its own.
function subtree(prefix: string): Match {
  return (path) => (path.startsWith(prefix) ? { id: null } : null);
}

// The content hash a book, a kept article body and a cover are all filed under:
// sha256 truncated to sixteen bytes (platform/app/content-hash.ts).
const HEX32 = "[0-9a-f]{32}";
// The only shape an id inside runs/ may have, restated from
// reading/rehearsal/store.ts: both segments come off a synced index, so a name
// that is not a plain one never becomes a path.
const SEG = "[A-Za-z0-9][A-Za-z0-9_-]{0,63}";
const DATE = "\\d{4}-\\d{2}-\\d{2}";

const MAP_THREADS: RecordShape = { kind: "map", container: "threads", idField: null };
const ARRAY_ID: RecordShape = { kind: "array", container: null, idField: "id" };
const LINES: RecordShape = { kind: "lines", container: null, idField: null };

// --- the table -------------------------------------------------------------

export const PALACE = [
  // -- the shelf ------------------------------------------------------------
  {
    kind: "library",
    about: "A book on the reader's shelf.",
    domain: "reading",
    match: fixed("library.json"),
    samples: ["library.json"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "records",
    shape: { kind: "map", container: "books", idField: null },
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "book-pdf",
    domain: "reading",
    match: keyed(new RegExp(`^library/(${HEX32})\\.pdf$`)),
    pathFor: (id: string) => `library/${id}.pdf`,
    samples: ["library/0123456789abcdef0123456789abcdef.pdf"],
    id: "bookId",
    refs: [{ kind: "library", via: "hash" }],
    sync: "books",
    deleteWith: "book",
    gc: "never",
    desk: true,
    deskKind: "book",
    note: "the authoritative copy of the file, on the content-addressed channel and never on the data one",
  },
  {
    kind: "book-epub",
    domain: "reading",
    match: keyed(new RegExp(`^library/(${HEX32})\\.epub$`)),
    pathFor: (id: string) => `library/${id}.epub`,
    samples: ["library/0123456789abcdef0123456789abcdef.epub"],
    id: "bookId",
    refs: [{ kind: "library", via: "hash" }],
    sync: "books",
    deleteWith: "book",
    gc: "never",
    desk: true,
    deskKind: "book",
    note: "the same row as book-pdf for the other format; a book id is a hash of bytes, so only one of the two names exists per id",
  },
  {
    kind: "reading-state",
    domain: "reading",
    match: fixed("reading-state.json"),
    samples: ["reading-state.json"],
    id: "fixed",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "data",
    merge: "records",
    shape: { kind: "map", container: "states", idField: null },
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "settings",
    domain: "platform",
    match: fixed("settings.json"),
    samples: ["settings.json"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "fields",
    fieldGroups: [
      ["defaultProviderId", "defaultModelId", "everydayModelId", "briefingModelId"],
    ],
    deleteWith: "never",
    gc: "never",
    note: "a model id only means anything under its own provider, so the fields strategy settles the provider and every model id together (pitfall 237). briefingModelId is the name everydayModelId had before docs/75 and is still in older devices' files",
  },
  {
    kind: "topics",
    about: "A topic: the reader's frame for a set of books and articles.",
    domain: "reading",
    match: fixed("topics.json"),
    samples: ["topics.json"],
    id: "fixed",
    refs: [{ kind: "library", via: "files[].hash" }],
    sync: "data",
    merge: "records",
    shape: { kind: "array", container: "topics", idField: "id" },
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "deleted-books",
    domain: "reading",
    match: fixed("deleted-books.jsonl"),
    samples: ["deleted-books.jsonl"],
    id: "fixed",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "data",
    merge: "records",
    shape: LINES,
    neverInferDelete: true,
    deleteWith: "never",
    gc: "never",
    note: "a file-level delete does not travel, so the deletion travels as a record and is never dropped (pitfall 208)",
  },

  // -- this machine ---------------------------------------------------------
  {
    kind: "device",
    domain: "platform",
    match: fixed("device.json"),
    samples: ["device.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "per-device settings: one machine starting with the computer says nothing about another",
  },
  {
    kind: "events",
    domain: "platform",
    match: keyed(/^events-(.+)\.jsonl$/),
    pathFor: (id: string) => `events-${id}.jsonl`,
    samples: ["events-topic1.jsonl", "events-ai.jsonl"],
    id: "topicId",
    refs: [{ kind: "topics", via: "<the file name>", onDelete: "delete" }],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "append-only local log, under a topic id or one of the reserved ids",
  },

  // -- marks and conversations ---------------------------------------------
  {
    kind: "annotations",
    about: "The marks the reader made in one book.",
    domain: "reading",
    match: keyed(/^annotations-(.+)\.json$/),
    pathFor: (id: string) => `annotations-${id}.json`,
    samples: ["annotations-abc123.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "data",
    merge: "records",
    shape: ARRAY_ID,
    deleteWith: "book",
    gc: "never",
    distill: { unit: "book-marks", cursor: "distilledMarks" },
  },
  {
    kind: "supplements",
    about: "The documents one book picked up from its own conversation.",
    domain: "reading",
    match: keyed(/^supplements-(.+)\.json$/),
    pathFor: (id: string) => `supplements-${id}.json`,
    samples: ["supplements-abc123.json"],
    id: "bookId",
    refs: [
      { kind: "library", via: "bookId" },
      { kind: "library", via: "items[].hash" },
    ],
    sync: "data",
    merge: "records",
    shape: { kind: "array", container: "items", idField: "hash" },
    deleteWith: "book",
    gc: "never",
    note: "references only; each supplement is a library document of its own, and deleting the book deletes them too (docs/67)",
  },
  // The three specific thread keys sit above the general one, and the general
  // one refuses their prefixes as well, so the two orders agree.
  {
    kind: "retell-thread",
    about: "The conversation held over a retelling.",
    domain: "reading",
    match: keyed(/^threads-retell-(.+)\.json$/),
    pathFor: (id: string) => `threads-retell-${id}.json`,
    samples: ["threads-retell-1754400000000.json"],
    id: "retellId",
    refs: [{ kind: "retell", via: "retellId" }],
    sync: "data",
    merge: "records",
    shape: MAP_THREADS,
    deleteWith: "retell",
    gc: "never",
    distill: { unit: "thread", cursor: "distilledMessages" },
    note: "dies with the retell through the deletion log (platform/sync/dead-paths.ts)",
  },
  {
    kind: "talk-thread",
    about: "The conversation held over a talk's outline.",
    domain: "reading",
    match: keyed(/^threads-talk-(.+)\.json$/),
    pathFor: (id: string) => `threads-talk-${id}.json`,
    samples: ["threads-talk-1754400000000.json"],
    id: "outlineId",
    refs: [{ kind: "outline", via: "outlineId" }],
    sync: "data",
    merge: "records",
    shape: MAP_THREADS,
    deleteWith: "outline",
    gc: "never",
    distill: { unit: "thread", cursor: "distilledMessages" },
    note: "dies with the outline through the deletion log (platform/sync/dead-paths.ts); the distiller reads it (reading/distill/source.ts)",
  },
  {
    kind: "info-thread",
    about: "The conversation held over one day's briefing.",
    domain: "info",
    match: keyed(new RegExp(`^threads-info-(${DATE})\\.json$`)),
    pathFor: (id: string) => `threads-info-${id}.json`,
    samples: ["threads-info-2026-07-21.json"],
    id: "date",
    refs: [
      { kind: "info-briefing-published", via: "date" },
      { kind: "topics", via: "threads[].topicId", onDelete: "clear" },
    ],
    sync: "data",
    merge: "records",
    shape: MAP_THREADS,
    deleteWith: "never",
    gc: "never",
    distill: { unit: "thread", cursor: "distilledMessages" },
    note: "a day's briefing conversations; the unit is one thread, not the file, and the onboarding thread id repeats across days (pitfall 209)",
  },
  {
    kind: "conversation",
    about: "The conversation held at the door, with nothing on the desk; one file a day.",
    domain: "platform",
    match: keyed(new RegExp(`^conversation-(${DATE})\\.json$`)),
    pathFor: (id: string) => `conversation-${id}.json`,
    samples: ["conversation-2026-09-10.json"],
    id: "date",
    refs: [{ kind: "topics", via: "threads[].topicId", onDelete: "clear" }],
    sync: "data",
    merge: "records",
    shape: MAP_THREADS,
    deleteWith: "never",
    gc: "never",
    distill: { unit: "thread", cursor: "distilledMessages" },
    note: "the door: what the reader says to the soul with nothing on the desk, one file per day",
  },
  {
    kind: "reading-thread",
    about: "The conversation held over a book.",
    domain: "reading",
    match: keyed(/^threads-(?!retell-|talk-|info-)(.+)\.json$/),
    pathFor: (id: string) => `threads-${id}.json`,
    samples: ["threads-abc123.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "data",
    merge: "records",
    shape: MAP_THREADS,
    deleteWith: "book",
    gc: "never",
    distill: { unit: "thread", cursor: "distilledMessages" },
    note: "the book is what goes on the desk, not the thread file",
  },
  {
    kind: "thread-images",
    domain: "platform",
    match: keyed(/^images\/threads\/([^/]+)\//),
    samples: ["images/threads/t1/photo.png"],
    id: "threadId",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "not synced; deleted with its thread (use-call.ts) and with the book the thread is filed under (reading/delete)",
  },

  // -- prep material --------------------------------------------------------
  // Two kinds of material live under one directory and only one of them is ever
  // filled in: paper notes at the top with the plan state, chapter spines a
  // level down under chapters/ with a state of their own.
  {
    kind: "prep-state",
    domain: "reading",
    match: keyed(/^prep-([^/]+)\/(?:chapters\/)?state\.json$/),
    pathFor: (id: string) => `prep-${id}/`,
    dir: { prefix: "prep-", depth: 2, nested: "chapters" },
    samples: ["prep-deadbeef/state.json", "prep-deadbeef/chapters/state.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "data",
    merge: "fields",
    deleteWith: "book",
    gc: "never",
    note: "the row that owns prep-<bookId>/, so it carries the walk's descend rule for all three prep kinds",
  },
  {
    kind: "prep-note",
    domain: "reading",
    match: keyed(/^prep-([^/]+)\/(?:chapters\/)?[^/]+\.md$/),
    pathFor: (id: string) => `prep-${id}/`,
    samples: [
      "prep-deadbeef/attention-is-all-you-need.md",
      "prep-deadbeef/chapters/chapter-01.md",
    ],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "data",
    merge: "prose",
    deleteWith: "book",
    gc: "never",
  },
  {
    kind: "prep-cache",
    domain: "reading",
    match: keyed(/^prep-([^/]+)\//),
    pathFor: (id: string) => `prep-${id}/`,
    samples: ["prep-deadbeef/pdf/some-paper.pdf", "prep-deadbeef/cache/raster.png"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "local",
    deleteWith: "book",
    gc: "domain-housekeeping",
    note: "everything else nested under prep-<bookId>/: downloaded PDFs above all, megabytes and re-fetchable",
  },

  // -- derived caches -------------------------------------------------------
  {
    kind: "soul-sequence",
    domain: "platform",
    match: fixed("soul-sequence.json"),
    samples: ["soul-sequence.json"],
    id: "fixed",
    refs: [{ kind: "topics", via: "spans[].topicId", onDelete: "keep" }],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "the time index over every conversation file, rebuilt by scanning them; a cache, so it does not travel, and a span's topic is whatever the file it was read off says now",
  },
  {
    kind: "fulltext",
    domain: "reading",
    match: keyed(new RegExp(`^fulltext-(${HEX32})\\.json$`)),
    pathFor: (id: string) => `fulltext-${id}.json`,
    samples: ["fulltext-0123456789abcdef0123456789abcdef.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "local",
    deleteWith: "book",
    gc: "domain-housekeeping",
  },
  {
    kind: "fulltext-prep",
    domain: "reading",
    match: keyed(/^fulltext-(.+)\.json$/),
    samples: ["fulltext-1a2b3c4d.json"],
    id: "hash",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "keyed by a synthetic prep path (prep/papers/store.ts), so reading/delete finds it through the prep state before the prep directory goes",
  },
  // Not a derived cache, which is why it sits among them with a different
  // deletion and a different life: an EPUB's position blocks are cut once, on
  // the first read, and never again. The [p.N] strings the AI has already
  // written into chapter files and notes point into this table, and nothing
  // rewrites those, so recutting the book would move all of them (docs/39 §1).
  {
    kind: "pagination",
    domain: "reading",
    match: keyed(/^pagination-(.+)\.json$/),
    pathFor: (id: string) => `pagination-${id}.json`,
    samples: ["pagination-0123456789abcdef0123456789abcdef.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "data",
    merge: "opaque",
    deleteWith: "book",
    gc: "never",
    note: "written once and never rewritten (a version-1 table is replaced by a version-2 one exactly once, docs/64), so two devices that cut it independently keep whichever copy this one already has",
  },
  {
    kind: "figures",
    domain: "reading",
    match: keyed(/^figures-(.+)\.json$/),
    pathFor: (id: string) => `figures-${id}.json`,
    samples: ["figures-abc123.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "local",
    deleteWith: "book",
    gc: "domain-housekeeping",
  },
  // covers/: the failure markers are matched first, because a marker's name is
  // a key with ".failed.json" on the end and the plain names would claim it.
  {
    kind: "cover-failure-unreadable",
    domain: "reading",
    match: keyed(/^covers\/path-([0-9a-f]+)\.failed\.json$/),
    samples: ["covers/path-1a2b3c4d.failed.json"],
    id: "hash",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "orphan: a file whose bytes would not read has no book id, so it is filed under a hash of its path and no delete finds it",
  },
  {
    kind: "cover-failure",
    domain: "reading",
    match: keyed(new RegExp(`^covers/(${HEX32})\\.failed\\.json$`)),
    pathFor: (id: string) => `covers/${id}.failed.json`,
    samples: ["covers/0123456789abcdef0123456789abcdef.failed.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "local",
    deleteWith: "book",
    gc: "domain-housekeeping",
  },
  {
    kind: "cover-image",
    domain: "reading",
    match: keyed(new RegExp(`^covers/(${HEX32})\\.jpg$`)),
    pathFor: (id: string) => `covers/${id}.jpg`,
    samples: ["covers/0123456789abcdef0123456789abcdef.jpg"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "local",
    deleteWith: "book",
    gc: "domain-housekeeping",
  },
  {
    kind: "cover-meta",
    domain: "reading",
    match: keyed(new RegExp(`^covers/(${HEX32})\\.json$`)),
    pathFor: (id: string) => `covers/${id}.json`,
    samples: ["covers/0123456789abcdef0123456789abcdef.json"],
    id: "bookId",
    refs: [{ kind: "library", via: "bookId" }],
    sync: "local",
    deleteWith: "book",
    gc: "domain-housekeeping",
  },

  // -- retells, talks, rehearsals ------------------------------------------
  {
    kind: "retell",
    about: "A retelling the reader is working out from what they have read.",
    domain: "reading",
    match: keyed(/^retell-(.+)\.json$/),
    pathFor: (id: string) => `retell-${id}.json`,
    samples: ["retell-1754400000000.json"],
    id: "retellId",
    refs: [
      { kind: "library", via: "materials[].bookId" },
      { kind: "topics", via: "topicId", onDelete: "delete" },
    ],
    sync: "data",
    merge: "opaque",
    deleteWith: "book",
    gc: "never",
    desk: true,
    note: "opaque today; it dies with a book only when every one of its materials was that book",
  },
  {
    kind: "outline",
    about: "The outline of a talk, section by section.",
    domain: "reading",
    match: keyed(/^outline-(.+)\.json$/),
    pathFor: (id: string) => `outline-${id}.json`,
    samples: ["outline-1754400000000.json"],
    id: "outlineId",
    refs: [
      { kind: "retell", via: "retellId" },
      { kind: "topics", via: "topicId", onDelete: "delete" },
    ],
    sync: "data",
    merge: "records",
    shape: { kind: "array", container: "segments", idField: "id" },
    deleteWith: "retell",
    gc: "never",
    desk: true,
    note: "the segments are what two devices edit at once; the spine beside them is a wrapper key and merges as fields",
  },
  {
    kind: "rehearsal",
    domain: "reading",
    match: keyed(/^rehearsal-(.+)\.json$/),
    pathFor: (id: string) => `rehearsal-${id}.json`,
    samples: ["rehearsal-1754400000000.json"],
    id: "rehearsalId",
    refs: [
      { kind: "outline", via: "outlineId" },
      { kind: "topics", via: "topicId", onDelete: "delete" },
    ],
    sync: "data",
    merge: "opaque",
    deleteWith: "outline",
    gc: "never",
    note: "opaque today; turning it into records is a behaviour change and not part of this pass",
  },
  {
    kind: "rehearsal-runs-bad",
    domain: "reading",
    match: keyed(/^runs-rehearsal-(.+)\.json\.bad$/),
    samples: ["runs-rehearsal-1754400000000.json.bad"],
    id: "rehearsalId",
    refs: [{ kind: "rehearsal", via: "rehearsalId" }],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "the rescue copy a run index that would not parse is moved to, for a person to look at",
  },
  {
    kind: "rehearsal-runs",
    domain: "reading",
    match: keyed(/^runs-rehearsal-(.+)\.json$/),
    pathFor: (id: string) => `runs-rehearsal-${id}.json`,
    samples: ["runs-rehearsal-1754400000000.json"],
    id: "rehearsalId",
    refs: [{ kind: "rehearsal", via: "rehearsalId" }],
    sync: "data",
    merge: "records",
    shape: { kind: "array", container: "runs", idField: "id" },
    deleteWith: "rehearsal",
    gc: "never",
    note: "a row is a pass that happened and nothing edits one, so two devices that each gave the talk a turn keep both; it could only be records once the transcripts moved out of it",
  },
  {
    kind: "rehearsal-run",
    domain: "reading",
    match: keyed(new RegExp(`^runs/(${SEG})/${SEG}\\.json$`)),
    pathFor: (id: string) => `runs/${id}/`,
    dir: { prefix: "runs", depth: 2 },
    samples: ["runs/1754400000000/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json"],
    id: "rehearsalId",
    refs: [{ kind: "rehearsal", via: "rehearsalId" }],
    sync: "data",
    merge: "opaque",
    deleteWith: "rehearsal",
    gc: "never",
    distill: { unit: "file", cursor: "distilledMessages" },
    note: "one immutable transcript per pass; judged by where it sits, because its own name is a run id",
  },
  {
    kind: "rehearsal-deck",
    domain: "reading",
    match: keyed(/^rehearsals\/(.+)\.html$/),
    samples: ["rehearsals/1754400000000.html"],
    id: "rehearsalId",
    refs: [{ kind: "rehearsal", via: "rehearsalId" }],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "tens of megabytes of self-contained HTML, imported on the machine it is rehearsed on",
  },
  {
    kind: "talk-legacy",
    domain: "legacy",
    match: keyed(/^talk-(.+)\.json$/),
    samples: ["talk-1737000000000.json"],
    id: "outlineId",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "orphan: an older build's talk file, nothing reads it",
  },
  {
    kind: "slides-legacy",
    domain: "legacy",
    match: subtree("slides/"),
    samples: ["slides/retells.json", "slides/1737000000000/slide-01.html"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "orphan: the slide decks an older build generated",
  },

  // -- kept articles --------------------------------------------------------
  {
    kind: "saved-articles",
    about: "An article the reader kept from a briefing.",
    domain: "reading",
    match: fixed("saved-articles.json"),
    samples: ["saved-articles.json"],
    id: "fixed",
    refs: [
      { kind: "topics", via: "topicId", onDelete: "reassign" },
      { kind: "article-body", via: "bodyHash" },
    ],
    sync: "data",
    merge: "records",
    shape: ARRAY_ID,
    deleteWith: "never",
    gc: "never",
    desk: true,
  },
  {
    kind: "article-body",
    domain: "reading",
    match: keyed(new RegExp(`^article-bodies/(${HEX32})\\.json$`)),
    dir: { prefix: "article-bodies", depth: 1 },
    samples: ["article-bodies/0123456789abcdef0123456789abcdef.json"],
    id: "hash",
    refs: [],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
    note: "named for the hash of its own bytes, so a file is written once and never revised and two devices never conflict; un-keeping the last record that points at one deletes it, locally and from Drive",
  },

  // -- memory ---------------------------------------------------------------
  {
    kind: "observation",
    about: "An observation the memory distilled from a conversation.",
    domain: "memory",
    match: keyed(/^observations\/(m-[0-9a-f]{16})\.md$/),
    pathFor: (id: string) => `observations/${id}.md`,
    dir: { prefix: "observations", depth: 1 },
    samples: ["observations/m-ab12cd34ef567890.md"],
    id: "observationId",
    refs: [{ kind: "topics", via: "topic", onDelete: "keep" }],
    sync: "data",
    merge: "prose",
    deleteWith: "observation-tombstone",
    gc: "never",
    note: "the row that owns observations/, so it carries the walk's descend rule for the whole flat directory; its topic is an archival label and not a retrieval key (docs/48), so a deleted topic leaves the observation alone (docs/50)",
  },
  {
    kind: "observation-index",
    domain: "memory",
    match: fixed("observations/index.md"),
    samples: ["observations/index.md"],
    id: "fixed",
    refs: [{ kind: "observation", via: "observationId" }],
    sync: "data",
    merge: "prose",
    deleteWith: "never",
    gc: "never",
    note: "derived from the entry files, and rebuilt rather than merged into",
  },
  {
    kind: "observation-meta",
    domain: "memory",
    match: fixed("observations/meta.json"),
    samples: ["observations/meta.json"],
    id: "fixed",
    refs: [{ kind: "topics", via: "lastDistilledAt{}", onDelete: "clear" }],
    sync: "data",
    merge: "cursors",
    neverInferDelete: true,
    deleteWith: "never",
    gc: "never",
    note: "every distillation cursor; the lower of two watermarks is the safe one, so it merges as cursors and not as fields",
  },
  {
    kind: "observation-tombstones",
    domain: "memory",
    match: fixed("observations/deleted-observations.jsonl"),
    samples: ["observations/deleted-observations.jsonl"],
    id: "fixed",
    refs: [{ kind: "observation", via: "observationId" }],
    sync: "data",
    merge: "records",
    shape: LINES,
    neverInferDelete: true,
    deleteWith: "never",
    gc: "never",
    note: "a deletion only survives by travelling as a record (pitfall 208)",
  },
  {
    kind: "observation-misc",
    domain: "memory",
    match: keyed(/^observations\/([^/]+)$/),
    samples: ["observations/m-ab12cd34ef567890.conflict-1a2b3c4d.md"],
    id: "observationId",
    refs: [],
    sync: "data",
    merge: "prose",
    deleteWith: "never",
    gc: "never",
    note: "the conflict copies a merge parks beside an entry, and anything else flat in the directory",
  },
  {
    kind: "statements",
    about: "What the memory holds about the reader: how they read, what they are working on.",
    domain: "memory",
    match: fixed("statements.json"),
    samples: ["statements.json"],
    id: "fixed",
    refs: [{ kind: "observation", via: "evidence[]" }],
    sync: "data",
    merge: "records",
    shape: { kind: "array", container: "statements", idField: "id" },
    neverInferDelete: true,
    deleteWith: "never",
    gc: "never",
    note: "two devices offline both add to it — a dream pass here, something the reader said there — and opaque would park one of the two in a conflict copy nobody opens",
  },
  {
    kind: "memory-usage",
    domain: "memory",
    match: keyed(/^memory-usage-(.+)\.jsonl$/),
    pathFor: (id: string) => `memory-usage-${id}.jsonl`,
    samples: ["memory-usage-4d9f1b0a.jsonl"],
    id: "deviceId",
    refs: [{ kind: "statements", via: "statementId" }],
    sync: "data",
    merge: "records",
    shape: LINES,
    deleteWith: "never",
    gc: "never",
    note: "written by its own device alone, so the union of the lines is the whole history",
  },
  {
    kind: "model-calls",
    domain: "memory",
    match: keyed(/^model-calls-(.+)\.jsonl$/),
    pathFor: (id: string) => `model-calls-${id}.jsonl`,
    samples: ["model-calls-4d9f1b0a.jsonl"],
    id: "deviceId",
    // A spend line names the topic it was spent on; a deleted topic keeps its history.
    refs: [{ kind: "topics", via: "topicId", onDelete: "keep" }],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "a line per call and nothing collecting them: synced it would be a per-device file that only ever grows. What a machine spent is the machine's, and the cap (memory/usage/model-calls.ts) is what keeps it bounded",
  },
  {
    kind: "user-profile",
    domain: "memory",
    match: fixed("user-profile.md"),
    samples: ["user-profile.md"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "prose",
    deleteWith: "never",
    gc: "never",
    note: "orphan: retired at 0.18 (docs/48) — nothing reads or writes it, and a file an older install left behind is neither migrated nor deleted, so it stays registered and in range",
  },
  {
    kind: "info-profile-legacy",
    domain: "memory",
    match: fixed("info-profile.md"),
    samples: ["info-profile.md"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "prose",
    deleteWith: "never",
    gc: "never",
    note: "orphan: the profile's old name, retired with it at 0.18 — kept in range so a device on the old build stays in step",
  },
  {
    kind: "profile-guess-state",
    domain: "memory",
    match: fixed("profile-guess.json"),
    samples: ["profile-guess.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "orphan: the guess pass's stamp, retired with the pass at 0.18 (docs/48) — nothing writes it and nothing deletes it",
  },
  {
    kind: "dream-state",
    domain: "memory",
    match: fixed("dream-state.json"),
    samples: ["dream-state.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
  },

  // -- info -----------------------------------------------------------------
  {
    kind: "info-feedback",
    domain: "info",
    match: fixed("info-feedback.jsonl"),
    samples: ["info-feedback.jsonl"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "records",
    shape: LINES,
    neverInferDelete: true,
    deleteWith: "never",
    gc: "after-distill-tail",
  },
  {
    kind: "info-sources",
    domain: "info",
    match: fixed("info-sources.json"),
    samples: ["info-sources.json"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "records",
    shape: ARRAY_ID,
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "info-labs",
    domain: "info",
    match: fixed("info-labs.json"),
    samples: ["info-labs.json"],
    id: "fixed",
    refs: [
      { kind: "info-sources", via: "sourceId" },
      { kind: "topics", via: "charter.topicId", onDelete: "keep" },
    ],
    sync: "data",
    merge: "records",
    shape: { kind: "array", container: "labs", idField: "id" },
    deleteWith: "never",
    gc: "never",
    note: "the reader's research rooms (docs/63): authored in conversation, so records-merged on the room id rather than last-writer-wins over the list; the charter's topic is null in everything written this release, so nothing of a deleted topic's is here to clear",
  },
  {
    kind: "info-meals",
    domain: "info",
    match: fixed("info-meals.json"),
    samples: ["info-meals.json"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
    note: "the week's dinners, the list derived from them and the nights that went differently (docs/73): one record, merged whole, because a per-field merge would assemble a week that never existed on either device",
  },
  {
    kind: "info-meals-photos",
    domain: "info",
    match: fixed("info-meals-photos.json"),
    samples: ["info-meals-photos.json"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "records",
    shape: { kind: "map", container: "photos", idField: null },
    deleteWith: "never",
    gc: "never",
    note: "the photographs the meals line found for dishes and ingredients (docs/73 图片), keyed by what was searched for and outliving every week; its own file because the run that writes it is on the PC minutes after the phone wrote the week; records-merged per key, so the run's new entries and the phone dropping a picture that will not load both survive a crossing sync",
  },
  {
    kind: "info-picture",
    domain: "info",
    match: keyed(/^info-picture-(lab-[0-9a-f]{8})\.json$/),
    pathFor: (id: string) => `info-picture-${id}.json`,
    samples: ["info-picture-lab-4d9f1b0a.json"],
    id: "labId",
    refs: [{ kind: "info-labs", via: "labId" }],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
    note: "one room's standing picture, written only by the device holding the collector claim, so there are never two halves to reconcile",
  },
  {
    kind: "info-cables",
    domain: "info",
    match: keyed(new RegExp(`^info-cables-(${DATE})\\.json$`)),
    pathFor: (id: string) => `info-cables-${id}.json`,
    samples: ["info-cables-2026-07-21.json"],
    id: "date",
    refs: [{ kind: "info-labs", via: "labId" }],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "the day's kept items as evidence: synced because a picture's judgments cite cable ids, and kept for thirty days after the bodies are gone",
  },
  {
    kind: "info-briefing-published",
    domain: "info",
    match: fixed("info-briefing.json"),
    samples: ["info-briefing.json"],
    id: "fixed",
    refs: [{ kind: "info-bodies-published", via: "itemId" }],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
    desk: true,
    deskKind: "info-briefing",
    note: "what the collector publishes for the readers: a fixed name replaced whole, so nothing grows by the day",
  },
  {
    kind: "info-bodies-published",
    domain: "info",
    match: fixed("info-bodies.json"),
    samples: ["info-bodies.json"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "info-pool-marks",
    domain: "info",
    match: fixed("info-pool-marks.json"),
    samples: ["info-pool-marks.json"],
    id: "fixed",
    refs: [],
    sync: "data",
    merge: "records",
    shape: { kind: "map", container: "marks", idField: null },
    deleteWith: "never",
    gc: "never",
    note: "what the collector has already put in a briefing (docs/35): not derived, and it travels so a machine taking over collection does not send the same item twice",
  },
  {
    kind: "claim",
    domain: "memory",
    match: keyed(/^legion\/claim\/(.+)\.json$/),
    pathFor: (id: string) => `legion/claim/${id}.json`,
    samples: ["legion/claim/4d9f1b0a.json"],
    id: "deviceId",
    refs: [],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
    note: "what a device says it is and what it can do (src/legion/claim, docs/55). One per device and written by that device alone, so there is never a merge to do",
  },
  {
    kind: "info-collector-legacy",
    domain: "legacy",
    match: keyed(/^info-collector-(.+)\.json$/),
    samples: ["info-collector-4d9f1b0a.json"],
    id: "deviceId",
    refs: [],
    // Off the channel: nothing reads it any more, so carrying it between
    // devices is a request per pass spent on a file nobody opens.
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "orphan: the claim before it moved to legion/claim/ (docs/55). An older build still writes one; a device that upgrades writes the new path and leaves this behind",
  },
  {
    kind: "info-ask",
    domain: "info",
    match: keyed(/^info-ask-(.+)\.json$/),
    pathFor: (id: string) => `info-ask-${id}.json`,
    samples: ["info-ask-4d9f1b0a.json"],
    id: "deviceId",
    refs: [],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "info-daily-briefing",
    domain: "info",
    match: keyed(new RegExp(`^briefing-(${DATE})\\.json$`)),
    pathFor: (id: string) => `briefing-${id}.json`,
    samples: ["briefing-2026-07-21.json"],
    id: "date",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "the day boxed by room, derived and rebuilt rather than carried between devices",
  },
  {
    kind: "info-daily-articles",
    domain: "info",
    match: keyed(new RegExp(`^info-articles-(${DATE})\\.json$`)),
    pathFor: (id: string) => `info-articles-${id}.json`,
    samples: ["info-articles-2026-07-21.json"],
    id: "date",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
  },
  {
    kind: "info-daily-items",
    domain: "info",
    match: keyed(new RegExp(`^info-items-(${DATE})\\.json$`)),
    pathFor: (id: string) => `info-items-${id}.json`,
    samples: ["info-items-2026-07-21.json"],
    id: "date",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
  },
  {
    kind: "info-daily-run",
    domain: "info",
    match: keyed(new RegExp(`^info-run-(${DATE})\\.json$`)),
    pathFor: (id: string) => `info-run-${id}.json`,
    samples: ["info-run-2026-07-21.json"],
    id: "date",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
  },
  {
    kind: "info-daily-pool",
    domain: "info",
    match: keyed(new RegExp(`^info-pool-(${DATE})\\.json$`)),
    pathFor: (id: string) => `info-pool-${id}.json`,
    samples: ["info-pool-2026-07-21.json"],
    id: "date",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
  },
  {
    kind: "info-pool-polled",
    domain: "info",
    match: fixed("info-pool-polled.json"),
    samples: ["info-pool-polled.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "info-site-sessions",
    domain: "info",
    match: fixed("info-site-sessions.json"),
    samples: ["info-site-sessions.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "cookies never leave the machine that signed in",
  },
  {
    kind: "info-source-health",
    domain: "info",
    match: fixed("info-source-health.json"),
    samples: ["info-source-health.json"],
    id: "fixed",
    refs: [{ kind: "info-sources", via: "sourceId" }],
    sync: "local",
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "info-daily-round",
    domain: "info",
    match: fixed("info-daily-round.json"),
    samples: ["info-daily-round.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
  },

  // -- sync's own files -----------------------------------------------------
  {
    kind: "sync-auth",
    domain: "sync",
    match: fixed("sync-auth.json"),
    samples: ["sync-auth.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "run",
    about: "A piece of work handed off to be done out of sight, and how far it has got.",
    domain: "memory",
    match: keyed(new RegExp(`^legion/runs/(r-${HEX32})\\.json$`)),
    pathFor: (id: string) => `legion/runs/${id}.json`,
    dir: { prefix: "legion", depth: 2, nested: "runs" },
    samples: ["legion/runs/r-0123456789abcdef0123456789abcdef.json"],
    id: "runId",
    refs: [],
    sync: "data",
    merge: "lattice",
    neverInferDelete: true,
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "one run per file, written by whichever device is executing it and by whichever one delegated it, so the merge is a join and not a three-way (src/legion/run/merge.ts). It is the row that owns legion/, and the descend rule names runs/ so the bell directory beside it — machine-local — is never walked. Never-infer-delete because the hot layer is folded into the ledger at different times on different devices, and a fold the peer has not done yet would read as a deletion (docs/55)",
  },
  {
    kind: "ledger",
    domain: "memory",
    match: keyed(/^legion\/ledger\/(\d{4}-\d{2}-\d{2})\.jsonl$/),
    pathFor: (id: string) => `legion/ledger/${id}.jsonl`,
    dir: { prefix: "legion", depth: 2, nested: "ledger" },
    samples: ["legion/ledger/2026-09-15.jsonl"],
    id: "date",
    refs: [],
    sync: "data",
    merge: "records",
    shape: LINES,
    neverInferDelete: true,
    deleteWith: "never",
    gc: "never",
    note: "the cold layer a finished run folds into, one file per day of endedAt in UTC, one line per run (src/legion/ledger, docs/55). The line is canonical, so two devices that folded the same run wrote the same bytes and the union of lines is one line. It is also the tombstone that authorises deleting the hot run file, so it is never inferred away and never collected: dropping a line brings the run it deleted back (pitfall 208)",
  },
  {
    kind: "bell",
    domain: "memory",
    match: subtree("legion/bell/"),
    samples: ["legion/bell/run-done-r-4f2a91.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "one bell per file, the soul's inbox on this device (src/legion/bell). Machine-local runtime, like the session beside it: a bell is addressed to the soul running here, and the words it produces travel as a conversation (docs/55)",
  },
  {
    kind: "run-brief",
    domain: "memory",
    match: subtree("legion/briefs/"),
    samples: ["legion/briefs/0f5c2f1a-9c1e-4f6f-9a02-3c7d5b1e8a44.md"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "what the soul wrote when it delegated, one file per run, frozen at creation (docs/68). Machine-local: today's only kind is a `local` run, which lives and dies on the device that asked for it, so the brief has nowhere else to be",
  },
  {
    kind: "run-output",
    domain: "memory",
    match: subtree("legion/outputs/"),
    samples: ["legion/outputs/r-0123456789abcdef0123456789abcdef.md"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "what a run came back with, one file per run, named by the run's id. The box item points at it rather than holding it (docs/60, docs/68); machine-local for the same reason the brief beside it is",
  },
  {
    kind: "schedule-state",
    domain: "memory",
    match: subtree("legion/schedule/"),
    samples: ["legion/schedule/fired.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "which anchor this device last rang a wake bell for (src/legion/schedule, docs/55). Machine-local: two devices agreeing on who fires is the election's job, and this is only how one device does not fire twice for the same hour",
  },
  {
    kind: "session",
    domain: "memory",
    match: subtree("session/"),
    samples: ["session/--session--/2026-09-14T03-13-13-451Z_01a09de7.jsonl"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "the harness keeps one append-only JSONL per session (platform/app/session-fs.ts). A process start settles the previous session and begins a fresh one; the group keeps its newest five files (legion/execute/harness.ts). Machine-local runtime: a device that loses it starts the next run from a fresh session, and the conversation the reader sees is a projection of it that travels on its own (docs/55, docs/71)",
  },

  // -- the red box ----------------------------------------------------------
  {
    kind: "box-item",
    about: "Something a delivery put in front of the reader, and whether they have got to it.",
    domain: "box",
    match: keyed(/^box\/(b-[0-9a-f]{32})\.json$/),
    pathFor: (id: string) => `box/${id}.json`,
    dir: { prefix: "box", depth: 1 },
    samples: ["box/b-0123456789abcdef0123456789abcdef.json"],
    id: "boxItemId",
    refs: [{ kind: "run", via: "runId" }],
    sync: "data",
    merge: "lattice",
    neverInferDelete: true,
    deleteWith: "never",
    gc: "never",
    note: "one item per file, born on whichever device made the delivery and moved along by whichever one the reader was holding, so the merge is a join and not a three-way (src/box/merge.ts). The cover is written once and the state is the only thing that changes, which is what keeps the box off a second shared mutable file (docs/60). Never-infer-delete because nothing deletes an item today, so an absence on one device is a partial tree and not a deletion; the fold into memory is later and, like the ledger's, will have to carry its own tombstone (pitfall 208). gc never for the same reason: there is nothing yet that an item has been folded into",
  },

  {
    kind: "sync-state",
    domain: "sync",
    match: fixed("sync-state.json"),
    samples: ["sync-state.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
  },
  {
    kind: "sync-trash",
    domain: "sync",
    match: fixed("sync-trash.jsonl"),
    samples: ["sync-trash.jsonl"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
  },
  {
    kind: "sync-base",
    domain: "sync",
    match: subtree("sync-base/"),
    samples: ["sync-base/library.json", "sync-base/prep-deadbeef/chapters/state.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "the merge base mirrors the whole range; syncing the record of what was last agreed would be circular",
  },
  {
    kind: "sync-holdings",
    domain: "sync",
    match: keyed(/^sync-holdings\/([^/]+)\.json$/),
    samples: ["sync-holdings/self.json", "sync-holdings/d-3f9a1c.json"],
    id: "deviceId",
    refs: [{ kind: "holdings", via: "deviceId" }],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "the local cache of what each device says it holds",
  },
  {
    kind: "holdings",
    domain: "sync",
    match: keyed(/^holdings-(.+)\.json$/),
    pathFor: (id: string) => `holdings-${id}.json`,
    samples: ["holdings-d-3f9a1c.json"],
    id: "deviceId",
    refs: [],
    sync: "remote-only",
    deleteWith: "never",
    gc: "never",
    note: "each device's tree snapshot, published to the remote folder and taken out by name before reconcile sees one (docs/59)",
  },
  {
    kind: "credentials",
    domain: "platform",
    match: fixed("credentials.json"),
    samples: ["credentials.json"],
    id: "fixed",
    refs: [],
    sync: "local",
    deleteWith: "never",
    gc: "never",
    note: "plaintext provider tokens stay on the device rather than widening their exposure to the user's Drive",
  },
] as const satisfies readonly PalaceRow[];

export type PalaceKind = (typeof PALACE)[number]["kind"];
