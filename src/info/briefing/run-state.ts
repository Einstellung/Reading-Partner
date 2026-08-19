// The resumable state of one day's briefing generation (docs/16, docs/35). A run
// is a funnel of four phases and every one of them costs money or minutes, so
// the checkpoint records what each has already paid for: which sources have been
// discovered, which items have been judged, which bodies have been fetched. Cut
// off — backgrounded and killed, crashed, app closed, stopped — the next start
// picks the run up and pays only for what is still owed. Same posture as the
// notes state file (src/reading/prep/chapters/types.ts): a derived, rebuildable JSON the
// pipeline reads once at startup and rewrites at every checkpoint.
//
// Pure: the clock, the filesystem, and the fetching are the caller's business.

import { capKept, fillMissingVerdicts, type ScreenVerdict, type Selection } from "./screen";
import type { InfoItem } from "../sources/item";

// Bumped for the funnel: a version-1 file is a two-phase run whose `items` are a
// mix of fetched and unfetched, with no verdicts. loadRun rejects it, so the day
// starts over rather than resuming into a shape this file cannot read.
export const INFO_RUN_VERSION = 2 as const;

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

// How far the run got, in funnel order (docs/35):
//
//   discovering — headlines from every source, one request each, no bodies.
//   screening   — one cheap AI call per batch of headlines: fetch this or not.
//   fetching    — article bodies, for the survivors only.
//   triaging    — the one triage call, over what is left.
//
// The first three are checkpointed at a finer grain than the phase (per source,
// per batch, per body); triage is a single AI call, so it is all or nothing.
export type InfoRunPhase = "discovering" | "screening" | "fetching" | "triaging";

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
  // Every item discovered so far, and the bodies fetched for the ones that got
  // that far: the whole point of the checkpoint is that a resume never pays
  // twice. It is the same payload the day's article cache and item snapshot are
  // written from when the run ends, which is why the file is heavy and why it is
  // deleted the moment the briefing lands.
  items: InfoItem[];
  // Screening verdicts by item id. An item absent from this map has not been
  // judged, which is exactly what a resumed run still owes the screen — so a
  // Stop halfway through the batches costs nothing already spent.
  verdicts: Record<string, ScreenVerdict>;
  // Set once every item has a verdict: what goes on to have a body fetched, and
  // how many keeps the cap cut. Its presence is what says screening is finished.
  selection?: Selection;
  // Item ids whose body fetch has settled, either way. A body that would not
  // come is not retried within a run: the item degrades to summary-only, which
  // triage reads as such.
  material: string[];
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
    phase: "discovering",
    sources: sources.map((s) => ({ id: s.id, name: s.name, status: "pending", items: 0 })),
    items: [],
    verdicts: {},
    material: [],
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

// --- seeding from the pool --------------------------------------------------

// What the pool hands a run: the day's candidates, the verdicts already paid
// for, and the ids whose bodies are already on disk with the text to prove it.
// Shaped here rather than imported from item-pool so run-state stays the pure
// state machine it is; the caller does the resolving.
export interface RunSeed {
  items: InfoItem[];
  verdicts: Record<string, ScreenVerdict>;
  bodies: Record<string, { contentHtml?: string; textContent?: string }>;
  // Ids an earlier day already settled (item-pool.ts). The run drops these from
  // what it discovered itself.
  settled: string[];
}

// Fold the pool's draw into a run that has just finished discovering (docs/35).
//
// The run keeps what it discovered itself first — those are the freshest
// headlines and the ones its per-source counters are about — and the pool adds
// everything else the day is owed: items polled hours ago that no briefing has
// seen, and, on a refresh, the items today's briefing already carries.
//
// Nothing already paid for is paid for again. A carried verdict means the screen
// never sees that item; a carried body means the fetch step never asks for it.
// The run's own verdicts win over the pool's, because a verdict it produced this
// run is the more recent judgement of the two.
export function seedRun(state: InfoRunState, seed: RunSeed, now: number): InfoRunState {
  // What the pool settled on an earlier day goes, even when a source just
  // offered it again: a feed is a window days or weeks wide, so rediscovering
  // yesterday's article is the normal case, and judging it a second time is how
  // it gets delivered a second time. A verdict this run already produced wins —
  // dropping the item under it would leave the screen's count talking about
  // something that is no longer there.
  const settled = new Set(seed.settled);
  const kept = settled.size
    ? state.items.filter((it) => !settled.has(it.id) || state.verdicts[it.id] !== undefined)
    : state.items;
  const known = new Set(kept.map((it) => it.id));
  const items = [...kept];
  for (const it of seed.items) {
    if (known.has(it.id)) continue;
    known.add(it.id);
    items.push(it);
  }
  const verdicts = { ...state.verdicts };
  for (const [id, v] of Object.entries(seed.verdicts)) {
    if (!verdicts[id] && known.has(id)) verdicts[id] = v;
  }
  const material = state.material.filter((id) => known.has(id));
  const fetched = new Set(material);
  const withBodies = items.map((it) => {
    const body = seed.bodies[it.id];
    if (!body) return it;
    if (!fetched.has(it.id)) {
      fetched.add(it.id);
      material.push(it.id);
    }
    // An item that already carries its own text (a feed that ships its body)
    // keeps it: the cached copy is the same text through one more hop.
    if (it.textContent) return it;
    return {
      ...it,
      ...(body.contentHtml ? { contentHtml: body.contentHtml } : {}),
      ...(body.textContent ? { textContent: body.textContent, summaryOnly: false } : {}),
    };
  });
  return { ...state, updatedAt: now, items: withBodies, verdicts, material };
}

// --- what to do when the app opens -------------------------------------------

// The briefing is a daily ritual with no button any more (docs/35), so opening
// the app is what triggers it. Three answers, and the interesting ones are the
// refusals:
//
//   resume   — a run was cut off mid-flight and never got to say why. The user
//              asked for it and never got an answer; finishing it is owed.
//   generate — today has no briefing and no run behind it. Collect one.
//   none     — today's briefing is already here, or a run for today is parked
//              because the user stopped it or it failed. A parked run has spent
//              the reader's money once; the next spend is theirs to ask for,
//              which they do through the companion.
export type StartupAction = "resume" | "generate" | "none";

export function startupAction(input: {
  briefing: { date: string } | null;
  run: InfoRunState | null;
  today: string;
}): StartupAction {
  if (isResumable(input.run, input.today)) return "resume";
  if (input.run && input.run.date === input.today && input.run.halt) return "none";
  if (input.briefing && input.briefing.date === input.today) return "none";
  return "generate";
}

// --- screening --------------------------------------------------------------

// The items the screen has not judged yet, in discovery order.
export function unscreenedItems(state: InfoRunState): InfoItem[] {
  return state.items.filter((it) => !state.verdicts[it.id]);
}

// Fold one screening batch into the run. Every id in the batch gets a verdict
// whether or not the model returned one (fillMissingVerdicts), so a batch that
// lands can never leave an item in limbo — which is what lets the resume treat
// "has a verdict" as "already paid for".
export function applyVerdicts(
  state: InfoRunState,
  batchIds: string[],
  verdicts: ScreenVerdict[],
  now: number,
): InfoRunState {
  const next = { ...state.verdicts };
  for (const v of fillMissingVerdicts(batchIds, verdicts)) next[v.id] = v;
  return { ...state, updatedAt: now, verdicts: next };
}

// Close the screening phase: rank the keeps, apply the ceiling, and record the
// selection. Deterministic given the verdicts, so a run cut off right here
// reproduces the same selection on the way back in.
export function finishScreening(
  state: InfoRunState,
  max: number,
  now: number,
): InfoRunState {
  const keptIds: string[] = [];
  const confidence = new Map<string, number>();
  for (const it of state.items) {
    const v = state.verdicts[it.id];
    if (!v || !v.keep) continue;
    keptIds.push(it.id);
    confidence.set(it.id, v.confidence);
  }
  return {
    ...state,
    updatedAt: now,
    phase: "fetching",
    selection: capKept(keptIds, confidence, max),
  };
}

// --- material ---------------------------------------------------------------

// The selected items, in discovery order. Empty before screening finishes.
export function selectedItems(state: InfoRunState): InfoItem[] {
  const ids = new Set(state.selection?.ids ?? []);
  return state.items.filter((it) => ids.has(it.id));
}

// The selected items still owed a body fetch.
export function pendingBodies(state: InfoRunState): InfoItem[] {
  const done = new Set(state.material);
  return selectedItems(state).filter((it) => !done.has(it.id));
}

// Fold one fetched body back into the run and mark it paid for.
export function applyBody(state: InfoRunState, item: InfoItem, now: number): InfoRunState {
  return {
    ...state,
    updatedAt: now,
    items: state.items.map((it) => (it.id === item.id ? item : it)),
    material: state.material.includes(item.id) ? state.material : [...state.material, item.id],
  };
}

// --- progress ---------------------------------------------------------------

// Live funnel progress derived from the checkpoint, so a resumed run's progress
// carries on from where it stopped instead of restarting at zero. One shape for
// all four phases: the UI reads the fields its current phase cares about.
export interface CollectProgress {
  // Discovery: sources.
  total: number;
  done: number;
  failed: number;
  // Items discovered so far.
  items: number;
  lastDone: string | null;
  // Screening: items judged, and how they went.
  screened: number;
  kept: number;
  dropped: number;
  // Keeps the ceiling cut. Carried through to the UI on purpose — a truncation
  // nobody is told about is a briefing that quietly lost part of the day.
  cappedOut: number;
  // Material: bodies fetched, out of how many were selected.
  bodies: number;
  bodiesTotal: number;
}

export function emptyProgress(items = 0): CollectProgress {
  return {
    total: 0,
    done: 0,
    failed: 0,
    items,
    lastDone: null,
    screened: 0,
    kept: 0,
    dropped: 0,
    cappedOut: 0,
    bodies: 0,
    bodiesTotal: 0,
  };
}

export function collectProgress(state: InfoRunState): CollectProgress {
  let done = 0;
  let failed = 0;
  for (const s of state.sources) {
    if (s.status === "pending") continue;
    done++;
    if (s.status === "failed") failed++;
  }
  let screened = 0;
  let kept = 0;
  for (const v of Object.values(state.verdicts)) {
    screened++;
    if (v.keep) kept++;
  }
  const selection = state.selection;
  return {
    total: state.sources.length,
    done,
    failed,
    items: state.items.length,
    lastDone: state.lastSettled ?? null,
    screened,
    // Once the selection is settled the cap is part of the answer: what goes on
    // is selection.ids, and everything else was dropped one way or the other.
    kept: selection ? selection.ids.length : kept,
    dropped: selection ? state.items.length - selection.ids.length : screened - kept,
    cappedOut: selection?.cappedOut ?? 0,
    bodies: state.material.length,
    bodiesTotal: selection?.ids.length ?? 0,
  };
}
