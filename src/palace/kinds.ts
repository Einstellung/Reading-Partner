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

export type PalaceDomain = "platform" | "reading" | "info" | "memory" | "sync" | "legacy";

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
  | "fixed";

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
  // reference. Descriptive: nothing derives from it yet.
  refs: ReadonlyArray<{ kind: string; via: string }>;
  sync: SyncChannel;
  // How sync merges two edits of it. Present exactly when sync is "data".
  merge?: MergeStrategy;
  // When merge is "records": where the records sit and what identifies one.
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
    fieldGroups: [["defaultProviderId", "defaultModelId"]],
    deleteWith: "never",
    gc: "never",
    note: "provider and model only mean anything as a pair, so the fields strategy settles them together (pitfall 237)",
  },
  {
    kind: "topics",
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
    refs: [{ kind: "topics", via: "topicId" }],
    sync: "local",
    deleteWith: "never",
    gc: "domain-housekeeping",
    note: "append-only local log, under a topic id or one of the reserved ids",
  },

  // -- marks and conversations ---------------------------------------------
  {
    kind: "annotations",
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
  // The three specific thread keys sit above the general one, and the general
  // one refuses their prefixes as well, so the two orders agree.
  {
    kind: "retell-thread",
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
    note: "deleting a retell drops retell-<id>.json alone today, so this is registered and not yet wired",
  },
  {
    kind: "talk-thread",
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
    distill: { unit: "thread", cursor: "new" },
    note: "registered and not yet wired: nothing reads it and nothing deletes it with its outline",
  },
  {
    kind: "info-thread",
    domain: "info",
    match: keyed(new RegExp(`^threads-info-(${DATE})\\.json$`)),
    pathFor: (id: string) => `threads-info-${id}.json`,
    samples: ["threads-info-2026-07-21.json"],
    id: "date",
    refs: [{ kind: "info-briefing-published", via: "date" }],
    sync: "data",
    merge: "records",
    shape: MAP_THREADS,
    deleteWith: "never",
    gc: "never",
    distill: { unit: "thread", cursor: "distilledMessages" },
    note: "a day's briefing conversations; the unit is one thread, not the file, and the onboarding thread id repeats across days (pitfall 209)",
  },
  {
    kind: "reading-thread",
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
    note: "orphan: a pasted screenshot is neither synced nor ever deleted",
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
    note: "orphan: a downloaded paper's cache is keyed by a synthetic prep path, so deleting the book leaves it behind",
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
    domain: "reading",
    match: keyed(/^retell-(.+)\.json$/),
    pathFor: (id: string) => `retell-${id}.json`,
    samples: ["retell-1754400000000.json"],
    id: "retellId",
    refs: [
      { kind: "library", via: "materials[].bookId" },
      { kind: "topics", via: "topicId" },
    ],
    sync: "data",
    merge: "opaque",
    deleteWith: "book",
    gc: "never",
    note: "opaque today; it dies with a book only when every one of its materials was that book",
  },
  {
    kind: "outline",
    domain: "reading",
    match: keyed(/^outline-(.+)\.json$/),
    pathFor: (id: string) => `outline-${id}.json`,
    samples: ["outline-1754400000000.json"],
    id: "outlineId",
    refs: [{ kind: "retell", via: "retellId" }],
    sync: "data",
    merge: "records",
    shape: { kind: "array", container: "segments", idField: "id" },
    deleteWith: "retell",
    gc: "never",
  },
  {
    kind: "rehearsal",
    domain: "reading",
    match: keyed(/^rehearsal-(.+)\.json$/),
    pathFor: (id: string) => `rehearsal-${id}.json`,
    samples: ["rehearsal-1754400000000.json"],
    id: "rehearsalId",
    refs: [{ kind: "outline", via: "outlineId" }],
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
  },
  {
    kind: "rehearsal-run",
    domain: "reading",
    match: keyed(new RegExp(`^runs/(${SEG})/${SEG}\\.json$`)),
    dir: { prefix: "runs", depth: 2 },
    samples: ["runs/1754400000000/8f1c0a52-3b7d-4c1e-9a2f-0d5e6b7c8a90.json"],
    id: "rehearsalId",
    refs: [{ kind: "rehearsal", via: "rehearsalId" }],
    sync: "data",
    merge: "opaque",
    deleteWith: "rehearsal",
    gc: "never",
    distill: { unit: "file", cursor: "new" },
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
    domain: "reading",
    match: fixed("saved-articles.json"),
    samples: ["saved-articles.json"],
    id: "fixed",
    refs: [
      { kind: "topics", via: "topicId" },
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
    note: "named for the hash of its own bytes, so a file is written once and never revised and two devices never conflict",
  },

  // -- memory ---------------------------------------------------------------
  {
    kind: "observation",
    domain: "memory",
    match: keyed(/^observations\/(m-[0-9a-f]{16})\.md$/),
    pathFor: (id: string) => `observations/${id}.md`,
    dir: { prefix: "observations", depth: 1 },
    samples: ["observations/m-ab12cd34ef567890.md"],
    id: "observationId",
    refs: [{ kind: "topics", via: "topicId" }],
    sync: "data",
    merge: "prose",
    deleteWith: "observation-tombstone",
    gc: "never",
    note: "the row that owns observations/, so it carries the walk's descend rule for the whole flat directory",
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
    refs: [],
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
    note: "the profile's old name, kept in range so a device on the old build stays in step",
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
  },
  {
    kind: "info-collector",
    domain: "info",
    match: keyed(/^info-collector-(.+)\.json$/),
    pathFor: (id: string) => `info-collector-${id}.json`,
    samples: ["info-collector-4d9f1b0a.json"],
    id: "deviceId",
    refs: [],
    sync: "data",
    merge: "opaque",
    deleteWith: "never",
    gc: "never",
    note: "one per device and written by that device alone, so there is never a merge to do",
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
    note: "the day's own triage output, derived and rebuilt rather than carried between devices",
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
