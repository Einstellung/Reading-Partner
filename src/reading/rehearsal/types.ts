// A rehearsal (docs/43): a deck the reader gives out loud, over and over, and
// the record of every pass. It is an object of the topic, level with a retell
// rather than owned by one — a retell that produced a deck gets one, and so does
// a deck that was made outside the app and brought in, and the two are the same
// kind of thing with the same history under them.
//
// Not the same thing as reading/retell, which is the AI questioning the reader
// chapter by chapter before there is a deck at all. This is after: passes over a
// finished deck. What the AI eventually says about a pass is not part of this
// layer — nothing can be said about a rehearsal until one has been recorded, so
// recording is what this layer does and all it does.

export const REHEARSAL_VERSION = 1 as const;

// The rehearsal itself: which topic it belongs to, and which deck it is given
// against. Small and rarely rewritten, which is why the runs are a file of their
// own (store.ts) — a rehearsal renamed must not rewrite every word ever spoken
// to it.
export interface Rehearsal {
  version: typeof REHEARSAL_VERSION;
  id: string;
  topicId: string;
  name: string;
  // The deck, AppData-relative. Either a deck the slides pipeline built
  // (slides/<retellId>-<slug>.html) or a copy of one brought in from outside
  // (rehearsals/<id>.html).
  deckFile: string;
  // The retell whose deck this is, or null when the deck came from outside.
  // docs/43: the Rehearse button on a retell and the topic's Rehearsal section
  // are two doors into one object, and this is the only thing that tells them
  // apart afterwards.
  retellId: string | null;
  createdAt: number;
  updatedAt: number;
}

export function newRehearsalId(now: number): string {
  return `${now}`;
}

export interface NewRehearsalFields {
  id: string;
  topicId: string;
  name: string;
  deckFile: string;
  retellId?: string | null;
  now: number;
}

export function newRehearsal(fields: NewRehearsalFields): Rehearsal {
  return {
    version: REHEARSAL_VERSION,
    id: fields.id,
    topicId: fields.topicId,
    name: fields.name.trim() || "Untitled deck",
    deckFile: fields.deckFile,
    retellId: fields.retellId ?? null,
    createdAt: fields.now,
    updatedAt: fields.now,
  };
}

// A load-time check rather than a repair: everything on a rehearsal is required,
// so a file missing any of it is not a rehearsal this build can open and reads as
// null. That includes every rehearsal-<id>.json written before this object
// existed, when the name held a retell id and the contents were a run log — they
// are left on disk, unread and unmigrated, the same way the talk-<id>.json files
// are (reading/retell/store.ts).
export function normalizeRehearsal(raw: unknown): Rehearsal | null {
  const r = raw as Rehearsal | null;
  if (!r || typeof r !== "object") return null;
  if (r.version !== REHEARSAL_VERSION) return null;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.topicId !== "string" || !r.topicId) return null;
  if (typeof r.deckFile !== "string" || !r.deckFile) return null;
  if (!Number.isFinite(r.createdAt)) return null;
  return {
    version: REHEARSAL_VERSION,
    id: r.id,
    topicId: r.topicId,
    name: typeof r.name === "string" && r.name.trim() ? r.name : "Untitled deck",
    deckFile: r.deckFile,
    retellId: typeof r.retellId === "string" && r.retellId ? r.retellId : null,
    createdAt: r.createdAt,
    updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : r.createdAt,
  };
}

export const RUN_LOG_VERSION = 1 as const;

// One slide, for as long as the rehearsal was on it. A page the reader came
// back to is still one entry: `enteredAt` is the first arrival, `leftAt` the
// last departure, and `transcript` holds both visits.
export interface RehearsalPage {
  index: number; // 0-based slide index
  kind: string; // as reported by the deck
  title: string;
  enteredAt: number; // host clock, ms
  leftAt: number | null; // null for the page that was up when the run ended
  transcript: string; // what the reader said while this page was up
}

// One pass over the deck, as it comes out of the build step: the pages and the
// times, before the store has numbered it or counted anything off it.
//
// `deckFile` is the deck that was on screen, kept so a run can still say what it
// was given against after the deck is rebuilt or replaced; null when the caller
// did not have one to name.
export interface BuiltRun {
  id: string;
  ordinal: number; // 1 for this rehearsal's first pass; the store assigns it
  rehearsalId: string;
  deckFile: string | null;
  startedAt: number;
  endedAt: number | null;
  pages: RehearsalPage[];
}

// One pass as the log carries it: everything a list of passes shows, and nothing
// that grows with how long the pass was. The transcript is not here — it is one
// file per pass (store.ts) — so recording the tenth pass does not rewrite the
// nine before it.
export interface RehearsalRunEntry {
  id: string;
  ordinal: number;
  rehearsalId: string;
  deckFile: string | null;
  startedAt: number;
  endedAt: number | null;
  // The last moment this pass has any record of: endedAt when it was ended
  // properly, and the last thing that happened on a page when it was cut short
  // (the app was closed, the process died). Denormalized because the length is
  // the number a list shows, and the pages that used to answer it are no longer
  // in this file.
  lastMomentAt: number;
  // What a row says about the pages, counted once, when the run was written.
  // Same reason: drawing ten rows must not open ten transcripts.
  pagesTotal: number;
  pagesSpoken: number;
  wordsSpoken: number;
  // Where the transcript used to sit, before it moved into a file of its own.
  // Still read: a log written by a build that predates the split carries it, and
  // so does one synced from a device still on that build. Nothing here writes
  // it, and summary.ts counts off it when it is there.
  pages?: RehearsalPage[];
}

// One pass with its transcript: the entry, plus the pages read back from the
// file beside it. What an opened row shows.
export interface RehearsalRun extends RehearsalRunEntry {
  pages: RehearsalPage[];
}

// One pass's transcript, as its own file holds it. The two ids are written so a
// file that has come loose from its log still says what it is; nothing reads
// them back, because the log is what says which file to open.
export interface RehearsalRunPages {
  version: typeof RUN_LOG_VERSION;
  rehearsalId: string;
  runId: string;
  pages: RehearsalPage[];
}

export interface RehearsalLog {
  version: typeof RUN_LOG_VERSION;
  rehearsalId: string;
  runs: RehearsalRunEntry[]; // oldest first
}

// What the deck and the microphone report while a run is in progress. The
// build step (build.ts) turns a list of these into a run; nothing accumulates
// state during the run itself, so a run that ends badly still yields whatever
// was collected before it did.
export type RehearsalEvent =
  | { kind: "slide"; at: number; index: number; slideKind: string; title: string }
  | { kind: "utterance"; at: number; endedAt: number; text: string }
  | { kind: "end"; at: number };

// A load-time repair, in the same posture as normalizeRetell: a file this build
// cannot use at all reads as null (the store then moves it aside), while one
// odd run inside a usable file is dropped rather than losing the rest. A lost
// run is one pass given again; a lost log is every pass there ever was.
//
// The transcripts sit in files of their own now, and the same posture holds one
// level down: a pass whose file will not open loses its transcript and keeps its
// row (store.ts), because the row is what says the pass happened.
export function normalizeLog(raw: unknown): RehearsalLog | null {
  const log = raw as RehearsalLog | null;
  if (!log || typeof log !== "object") return null;
  if (log.version !== RUN_LOG_VERSION) return null;
  if (typeof log.rehearsalId !== "string" || !log.rehearsalId) return null;
  if (!Array.isArray(log.runs)) return null;
  const runs: RehearsalRunEntry[] = [];
  const seen = new Set<string>();
  for (const r of log.runs) {
    const run = normalizeRunEntry(r, log.rehearsalId);
    if (!run || seen.has(run.id)) continue;
    seen.add(run.id);
    runs.push(run);
  }
  // Oldest first, whatever order the file had them in. Appending keeps that
  // order on its own, but a merge does not: two devices that each recorded a
  // pass land on one order by content (platform/sync/merge/text.ts), and it is
  // not the order the passes happened in. Sorted by when the pass started rather
  // than by ordinal, because those two devices both minted the same ordinal.
  runs.sort((a, b) => a.startedAt - b.startedAt || a.ordinal - b.ordinal);
  return { version: RUN_LOG_VERSION, rehearsalId: log.rehearsalId, runs };
}

// The pages of one run, out of whatever shape they were found in. Never null: a
// page that makes no sense is dropped and the rest of the pass stands, which is
// the same trade one level up.
export function normalizePages(raw: unknown): RehearsalPage[] {
  const pages: RehearsalPage[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const index = Math.round(Number(p?.index));
    if (!Number.isFinite(index) || index < 0) continue;
    if (!Number.isFinite(p.enteredAt)) continue;
    pages.push({
      index,
      kind: typeof p.kind === "string" ? p.kind : "",
      title: typeof p.title === "string" ? p.title : "",
      enteredAt: p.enteredAt,
      leftAt: Number.isFinite(p.leftAt as number) ? (p.leftAt as number) : null,
      transcript: typeof p.transcript === "string" ? p.transcript : "",
    });
  }
  pages.sort((a, b) => a.index - b.index);
  return pages;
}

// One transcript file. Null when the bytes are not this writer's shape at all;
// the caller then reads the pass as having no transcript rather than moving
// anything aside — the file is written once and the other device still holds it.
export function normalizeRunPages(raw: unknown): RehearsalPage[] | null {
  const file = raw as RehearsalRunPages | null;
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  if (file.version !== RUN_LOG_VERSION) return null;
  if (!Array.isArray(file.pages)) return null;
  return normalizePages(file.pages);
}

// The moment a pass stopped, for an entry written before that was a field of its
// own. A run cut short has no endedAt, and the last thing that happened is still
// on its pages.
function lastMomentFrom(startedAt: number, endedAt: number | null, pages: RehearsalPage[]): number {
  if (endedAt !== null) return endedAt;
  let last = startedAt;
  for (const p of pages) last = Math.max(last, p.enteredAt, p.leftAt ?? p.enteredAt);
  return last;
}

// A stored count, or 0. Not derived from the pages here: only summary.ts knows
// how a word is counted, and it is the one thing that reads these back — an
// entry that still carries its pages is counted off them there.
function count(value: unknown): number {
  return Number.isFinite(value) && (value as number) >= 0 ? Math.round(value as number) : 0;
}

function normalizeRunEntry(raw: unknown, rehearsalId: string): RehearsalRunEntry | null {
  const run = raw as RehearsalRunEntry | null;
  if (!run || typeof run !== "object") return null;
  if (typeof run.id !== "string" || !run.id) return null;
  if (!Number.isFinite(run.startedAt)) return null;
  // Only when the key is really there. An entry whose pages have been split out
  // must come back without one, or the split below would find something to do on
  // every pass and rewrite the whole log each time.
  const inlined = "pages" in run ? normalizePages(run.pages) : null;
  const endedAt = Number.isFinite(run.endedAt as number) ? (run.endedAt as number) : null;
  const entry: RehearsalRunEntry = {
    id: run.id,
    ordinal: Number.isFinite(run.ordinal) && run.ordinal > 0 ? Math.round(run.ordinal) : 1,
    rehearsalId:
      typeof run.rehearsalId === "string" && run.rehearsalId ? run.rehearsalId : rehearsalId,
    deckFile: typeof run.deckFile === "string" && run.deckFile ? run.deckFile : null,
    startedAt: run.startedAt,
    endedAt,
    lastMomentAt: Number.isFinite(run.lastMomentAt)
      ? run.lastMomentAt
      : lastMomentFrom(run.startedAt, endedAt, inlined ?? []),
    pagesTotal: count(run.pagesTotal),
    pagesSpoken: count(run.pagesSpoken),
    wordsSpoken: count(run.wordsSpoken),
  };
  if (inlined !== null) entry.pages = inlined;
  return entry;
}

export function emptyLog(rehearsalId: string): RehearsalLog {
  return { version: RUN_LOG_VERSION, rehearsalId, runs: [] };
}
