// The resumable state of one day's briefing generation (docs/16). Collecting the
// sources takes minutes on a phone and is the expensive half of a run, so the run
// carries a checkpoint: which sources have settled and the items they gave. Cut
// off — backgrounded and killed, crashed, app closed — the next start picks the
// run up and fetches only what is still owed. Same posture as the notes state
// file (src/reading/notes/types.ts): a derived, rebuildable JSON the pipeline
// reads once at startup and rewrites at every checkpoint.
//
// Pure: the clock, the filesystem, and the fetching are the caller's business.

import type { InfoItem } from "./types";

export const INFO_RUN_VERSION = 1 as const;

// A source the run owes work for. Ids are descriptor ids (docs/17), stable
// across runs, so a checkpoint can name what has already been fetched.
export interface InfoSourceRef {
  id: string;
  name: string;
}

// A source is only ever written back once it has settled, so there is no
// "running" status: a process killed mid-fetch leaves the source pending and the
// resume just fetches it again. (The notes state file needs a running -> pending
// normalization on load because a chapter is marked before its AI call starts;
// here nothing is marked before the fact, so nothing has to be unwound.)
export type SourceRunStatus = "pending" | "done" | "failed";

export interface SourceRun {
  id: string;
  name: string;
  status: SourceRunStatus;
  // How many items it produced; 0 for pending and for a failure.
  items: number;
  error?: string;
}

// How far the run got. Collection is per source; triage is a single AI call, so
// it is all or nothing — a run interrupted while triaging resumes straight into
// the triage call with every collected item already in hand.
export type InfoRunPhase = "collecting" | "triaging";

// Why a parked run is not advancing. Absent means it was cut off mid-flight,
// which is the only case a startup resume may spend tokens on unasked: the user
// asked for this run and never got an answer. A run the user stopped, or one
// that failed, waits for an explicit Generate — which continues from the same
// checkpoint instead of refetching.
export interface RunHalt {
  kind: "stopped" | "failed";
  error?: string;
}

export interface InfoRunState {
  version: typeof INFO_RUN_VERSION;
  // Local YYYY-MM-DD. The briefing is the day's, so a leftover from an earlier
  // day is discarded rather than resumed — yesterday's half-collected news is
  // not worth the tokens to finish.
  date: string;
  startedAt: number;
  updatedAt: number;
  phase: InfoRunPhase;
  sources: SourceRun[];
  // Every item collected so far, article bodies included: the whole point of the
  // checkpoint is that a resume never refetches. It is the same payload the
  // day's article cache and item snapshot are written from when the run ends,
  // which is why the file is heavy and why it is deleted the moment the briefing
  // lands.
  items: InfoItem[];
  // Display name of the source that settled last, for the progress caption.
  lastSettled?: string;
  halt?: RunHalt;
}

export function createRunState(
  date: string,
  now: number,
  sources: InfoSourceRef[],
): InfoRunState {
  return {
    version: INFO_RUN_VERSION,
    date,
    startedAt: now,
    updatedAt: now,
    phase: "collecting",
    sources: sources.map((s) => ({ id: s.id, name: s.name, status: "pending", items: 0 })),
    items: [],
  };
}

// A persisted run worth continuing at startup: this version, today, and cut off
// rather than stopped or failed. Anything else is dead weight — the caller drops
// it (the daily prune deletes the file) and a fresh Generate starts over.
export function isResumable(state: InfoRunState | null, today: string): boolean {
  if (!state) return false;
  if (state.version !== INFO_RUN_VERSION) return false;
  if (state.date !== today) return false;
  return !state.halt;
}

// Reconcile a loaded run with the source list as it stands now: a source the
// user subscribed to since the run started joins as pending (an explicit
// re-collect is expected to include it), and one they removed or disabled is
// dropped if it has not run yet. Sources that already settled stay either way —
// their items are in the checkpoint and refetching them is exactly what the
// checkpoint exists to avoid.
export function syncSources(state: InfoRunState, enabled: InfoSourceRef[]): InfoRunState {
  const live = new Map(enabled.map((s) => [s.id, s]));
  const kept = state.sources.filter((s) => s.status !== "pending" || live.has(s.id));
  const known = new Set(kept.map((s) => s.id));
  const added: SourceRun[] = enabled
    .filter((s) => !known.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, status: "pending" as const, items: 0 }));
  return { ...state, sources: [...kept, ...added] };
}

// Give the sources that failed another go. A source that failed has usually
// failed for a reason the reader has since dealt with (offline, a host down),
// and asking for the briefing again is how they say so — so this belongs to the
// hand-driven Generate, never to an automatic resume, which must not turn one
// interruption into a second round of fetching.
export function retryFailedSources(state: InfoRunState): InfoRunState {
  if (!state.sources.some((s) => s.status === "failed")) return state;
  return {
    ...state,
    sources: state.sources.map((s) =>
      s.status === "failed" ? { ...s, status: "pending" as const, error: undefined } : s,
    ),
  };
}

// What the run still owes, in list order.
export function pendingSources(state: InfoRunState): InfoSourceRef[] {
  return state.sources
    .filter((s) => s.status === "pending")
    .map((s) => ({ id: s.id, name: s.name }));
}

export interface SourceResult {
  id: string;
  items: InfoItem[];
  error?: string;
}

// Fold one settled source into the run: its status, its items appended (deduped
// by item id, so a source that somehow runs twice cannot double the day), and
// the caption. Returns a new state; the caller persists it before the slower
// sources come back.
export function applySourceResult(
  state: InfoRunState,
  result: SourceResult,
  now: number,
): InfoRunState {
  const seen = new Set(state.items.map((it) => it.id));
  const fresh = result.items.filter((it) => !seen.has(it.id));
  let name: string | undefined;
  const sources = state.sources.map((s) => {
    if (s.id !== result.id) return s;
    name = s.name;
    return result.error
      ? { ...s, status: "failed" as const, items: 0, error: result.error }
      : { ...s, status: "done" as const, items: fresh.length, error: undefined };
  });
  return {
    ...state,
    updatedAt: now,
    sources,
    items: fresh.length ? [...state.items, ...fresh] : state.items,
    lastSettled: name ?? state.lastSettled,
  };
}

// Live collection progress derived from the checkpoint, so a resumed run's
// progress bar carries on from where it stopped instead of restarting at zero.
export interface CollectProgress {
  total: number;
  done: number;
  failed: number;
  items: number;
  lastDone: string | null;
}

export function collectProgress(state: InfoRunState): CollectProgress {
  let done = 0;
  let failed = 0;
  for (const s of state.sources) {
    if (s.status === "pending") continue;
    done++;
    if (s.status === "failed") failed++;
  }
  return {
    total: state.sources.length,
    done,
    failed,
    items: state.items.length,
    lastDone: state.lastSettled ?? null,
  };
}
