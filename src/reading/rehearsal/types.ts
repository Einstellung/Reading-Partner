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

// One pass over the deck. `deckFile` is the deck that was on screen, kept so a
// run can still say what it was given against after the deck is rebuilt or
// replaced; null when the caller did not have one to name.
export interface RehearsalRun {
  id: string;
  ordinal: number; // 1 for this rehearsal's first pass
  rehearsalId: string;
  deckFile: string | null;
  startedAt: number;
  endedAt: number | null;
  pages: RehearsalPage[];
}

export interface RehearsalLog {
  version: typeof RUN_LOG_VERSION;
  rehearsalId: string;
  runs: RehearsalRun[]; // oldest first
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
export function normalizeLog(raw: unknown): RehearsalLog | null {
  const log = raw as RehearsalLog | null;
  if (!log || typeof log !== "object") return null;
  if (log.version !== RUN_LOG_VERSION) return null;
  if (typeof log.rehearsalId !== "string" || !log.rehearsalId) return null;
  if (!Array.isArray(log.runs)) return null;
  const runs: RehearsalRun[] = [];
  const seen = new Set<string>();
  for (const r of log.runs) {
    const run = normalizeRun(r, log.rehearsalId);
    if (!run || seen.has(run.id)) continue;
    seen.add(run.id);
    runs.push(run);
  }
  return { version: RUN_LOG_VERSION, rehearsalId: log.rehearsalId, runs };
}

function normalizeRun(raw: unknown, rehearsalId: string): RehearsalRun | null {
  const run = raw as RehearsalRun | null;
  if (!run || typeof run !== "object") return null;
  if (typeof run.id !== "string" || !run.id) return null;
  if (!Number.isFinite(run.startedAt)) return null;
  const pages: RehearsalPage[] = [];
  for (const p of Array.isArray(run.pages) ? run.pages : []) {
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
  return {
    id: run.id,
    ordinal: Number.isFinite(run.ordinal) && run.ordinal > 0 ? Math.round(run.ordinal) : 1,
    rehearsalId:
      typeof run.rehearsalId === "string" && run.rehearsalId ? run.rehearsalId : rehearsalId,
    deckFile: typeof run.deckFile === "string" && run.deckFile ? run.deckFile : null,
    startedAt: run.startedAt,
    endedAt: Number.isFinite(run.endedAt as number) ? (run.endedAt as number) : null,
    pages,
  };
}

export function emptyLog(rehearsalId: string): RehearsalLog {
  return { version: RUN_LOG_VERSION, rehearsalId, runs: [] };
}
