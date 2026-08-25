// A rehearsal (docs/31, the third stage): the reader puts the retell's deck on
// screen and gives the whole thing once, start to finish, with the AI silent.
// What that leaves behind is this record — which page was up when, and what was
// said while it was.
//
// Not the same thing as reading/retell, which is the AI questioning the
// reader chapter by chapter before there is a deck at all. This is after: one
// pass over the finished deck, no interruptions, no grading. Feedback and
// distillation are not part of it — nothing can be said about how a retell went
// until the retell has been recorded, so recording is what this layer does and all
// it does.
//
// A retell is given many times. Every run is kept, oldest first, so the second
// pass can be held against the first.

export const REHEARSAL_VERSION = 1 as const;

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
// run can still say what it was given against after the deck is rebuilt; null
// when the caller did not have one to name.
export interface RehearsalRun {
  id: string;
  ordinal: number; // 1 for this retell's first rehearsal
  retellId: string;
  deckFile: string | null;
  startedAt: number;
  endedAt: number | null;
  pages: RehearsalPage[];
}

export interface RehearsalLog {
  version: typeof REHEARSAL_VERSION;
  retellId: string;
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
// run is one retell given again; a lost log is every run there ever was.
export function normalizeLog(raw: unknown): RehearsalLog | null {
  const log = raw as RehearsalLog | null;
  if (!log || typeof log !== "object") return null;
  if (log.version !== REHEARSAL_VERSION) return null;
  if (typeof log.retellId !== "string" || !log.retellId) return null;
  if (!Array.isArray(log.runs)) return null;
  const runs: RehearsalRun[] = [];
  const seen = new Set<string>();
  for (const r of log.runs) {
    const run = normalizeRun(r, log.retellId);
    if (!run || seen.has(run.id)) continue;
    seen.add(run.id);
    runs.push(run);
  }
  return { version: REHEARSAL_VERSION, retellId: log.retellId, runs };
}

function normalizeRun(raw: unknown, retellId: string): RehearsalRun | null {
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
    retellId: typeof run.retellId === "string" && run.retellId ? run.retellId : retellId,
    deckFile: typeof run.deckFile === "string" && run.deckFile ? run.deckFile : null,
    startedAt: run.startedAt,
    endedAt: Number.isFinite(run.endedAt as number) ? (run.endedAt as number) : null,
    pages,
  };
}

export function emptyLog(retellId: string): RehearsalLog {
  return { version: REHEARSAL_VERSION, retellId, runs: [] };
}
