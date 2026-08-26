// Rehearsals on disk:
//   rehearsal-<rehearsalId>.json         — the object (docs/43)
//   runs-rehearsal-<rehearsalId>.json    — the index of its passes, oldest first
//   runs/<rehearsalId>/<runId>.json      — one pass's transcript
//
// The talk itself is not here: the outline is one file of its own
// (reading/talk/store.ts) and this object points at it, because a talk outlives
// any one history of passes over it.
//
// Three files rather than one because they are written at different rates and
// cost different things to lose. The object is a few fields, rewritten when the
// name changes. The index is appended to after every
// pass, and holds nothing that grows with how long the pass was. The transcript
// is the only copy of what the reader actually said, and is written once.
//
// The transcript is out of the index because of sync. Forty minutes of talk is
// twenty or thirty KB of text, and an index that held it would be rewritten
// whole on every pass: recording the tenth pass would re-upload the first nine
// and the other device would download all of them to learn that one pass had
// been added. A pass is over when it is over — nothing ever goes back and edits
// one — so it is exactly the kind of thing that should be written once and then
// stay cold. Same shape a kept article's body already has (reading/
// saved-articles.ts), and the same shape library.json has for books.
//
// Named for the run's own id rather than for a hash of its bytes, which is what
// the article bodies use. A run already has an id, minted on the one device that
// recorded the pass and never handed out twice, so it is already the immutable
// name a hash would have had to invent — and it reads: the file beside a log
// entry is the file that entry names. What content addressing buys and this does
// not is two devices independently producing the same name for the same bytes,
// and the one moment that matters, the split below, has the id on both sides
// anyway.
//
// The runs file is named threads-style — prefixed, so the directory scan that
// finds rehearsals cannot see it. That also keeps the scan away from the
// rehearsal-<retellId>.json files an earlier build wrote, which were run logs
// under a retell's id: they do not parse as an object, so they are skipped, and
// nothing here moves them or migrates them (tests pin it). The set-aside below
// belongs to the runs file alone, for that reason.
//
// All three are in the sync range (platform/sync/syncFs.ts): a rehearsal is a
// trace the reader left and nothing can rebuild it.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import { talkOutlineForRetell } from "../talk/store";
import { runEntryOf } from "./summary";
import {
  emptyLog,
  newRehearsal,
  newRehearsalId,
  normalizeLog,
  normalizeRehearsal,
  normalizeRunPages,
  RUN_LOG_VERSION,
  type BuiltRun,
  type Rehearsal,
  type RehearsalLog,
  type RehearsalPage,
  type RehearsalRun,
  type RehearsalRunEntry,
  type RehearsalRunPages,
} from "./types";

const PREFIX = "rehearsal-";
const RUNS_PREFIX = "runs-";

// Where the transcripts live, one directory per rehearsal, the way article
// bodies and book blobs have one of their own. Not flat in the AppData root:
// these arrive one per pass and never stop arriving, and nesting them by
// rehearsal makes deleting one a directory removed rather than a scan of every
// name in the root.
//
// Deliberately not a name starting with "rehearsal-": that prefix belongs to the
// listing (rehearsalIdOf), and a directory sharing it would be one more name the
// scan has to be taught to skip.
export const RUN_PAGES_DIR = "runs";

// The only shape either id is allowed to have before a path is built from it.
// Both reach here off a log entry, and the log is synced — so the question is
// not "is this a run id" but "is this a plain file name", and anything else is
// treated as a pass whose transcript is not on this device. Same posture as
// BODY_HASH in reading/saved-articles.ts; wider only because a run id is a UUID
// this build minted rather than a hash it can recompute.
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** This rehearsal's transcripts, or null when its id is not a plain name. */
export function runPagesDir(rehearsalId: string): string | null {
  return PATH_SEGMENT.test(rehearsalId) ? `${RUN_PAGES_DIR}/${rehearsalId}` : null;
}

/** One pass's transcript, or null when either id is not a plain name. */
export function runPagesFile(rehearsalId: string, runId: string): string | null {
  const dir = runPagesDir(rehearsalId);
  return dir && PATH_SEGMENT.test(runId) ? `${dir}/${runId}.json` : null;
}

export function rehearsalFile(rehearsalId: string): string {
  return `${PREFIX}${rehearsalId}.json`;
}

export function rehearsalRunsFile(rehearsalId: string): string {
  return `${RUNS_PREFIX}${rehearsalFile(rehearsalId)}`;
}

// A rehearsal id out of a file name, or null for anything else in the directory.
// runs-rehearsal-<id>.json does not match: it is prefixed, and the prefix is
// checked at the start of the name.
export function rehearsalIdOf(fileName: string): string | null {
  if (!fileName.startsWith(PREFIX) || !fileName.endsWith(".json")) return null;
  const id = fileName.slice(PREFIX.length, -".json".length);
  return id || null;
}

// Missing is normal. A file this build cannot use reads as null and is left
// exactly where it is — the listing walks the whole directory, and a build that
// moved every file it did not recognize would turn one rename into a pile of
// .bad files.
export async function loadRehearsal(rehearsalId: string): Promise<Rehearsal | null> {
  try {
    const file = rehearsalFile(rehearsalId);
    if (!(await appData.exists(file))) return null;
    return normalizeRehearsal(JSON.parse(await appData.readText(file)) as unknown);
  } catch (e) {
    console.warn("failed to read a rehearsal", rehearsalId, e);
    return null;
  }
}

export async function saveRehearsal(rehearsal: Rehearsal): Promise<void> {
  await writeTextAtomic(rehearsalFile(rehearsal.id), JSON.stringify(rehearsal, null, 2));
}

// Every rehearsal on disk, newest first. Unreadable files are skipped.
export async function listAllRehearsals(): Promise<Rehearsal[]> {
  let entries;
  try {
    entries = await appData.readDir(".");
  } catch {
    return [];
  }
  const out: Rehearsal[] = [];
  for (const e of entries) {
    if (!e.isFile || !e.name) continue;
    const id = rehearsalIdOf(e.name);
    if (!id) continue;
    const rehearsal = await loadRehearsal(id);
    if (rehearsal) out.push(rehearsal);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listRehearsalsForTopic(topicId: string): Promise<Rehearsal[]> {
  return (await listAllRehearsals()).filter((r) => r.topicId === topicId);
}

export interface StartRehearsalInput {
  topicId: string;
  name: string;
  outlineId: string;
  retellId?: string | null;
  now?: number;
}

/**
 * An id nothing on disk is using, and the moment it stands for. The id is the
 * creation time; if the name is taken the next free millisecond is used, which
 * also steps over a rehearsal-<retellId>.json an earlier build left behind under
 * the same name.
 *
 */
export async function reserveRehearsalId(now = Date.now()): Promise<{ id: string; at: number }> {
  let at = now;
  while (await appData.exists(rehearsalFile(newRehearsalId(at)))) at += 1;
  return { id: newRehearsalId(at), at };
}

// Create a rehearsal and write it.
export async function startRehearsal(input: StartRehearsalInput): Promise<Rehearsal> {
  const { id, at } = await reserveRehearsalId(input.now ?? Date.now());
  const rehearsal = newRehearsal({
    id,
    topicId: input.topicId,
    name: input.name,
    outlineId: input.outlineId,
    retellId: input.retellId ?? null,
    now: at,
  });
  await saveRehearsal(rehearsal);
  return rehearsal;
}

/**
 * The rehearsal of one outline, made if this is the first time. One outline has
 * one rehearsal: docs/44 makes a run "which segments were given this time" and
 * not "the nth pass", so every pass over a talk belongs to one history and a
 * second object would split it.
 */
export async function rehearsalForOutline(input: {
  topicId: string;
  outlineId: string;
  name: string;
  retellId?: string | null;
  now?: number;
}): Promise<Rehearsal> {
  const now = input.now ?? Date.now();
  const existing = (await listAllRehearsals()).find((r) => r.outlineId === input.outlineId);
  if (!existing) {
    return startRehearsal({
      topicId: input.topicId,
      name: input.name,
      outlineId: input.outlineId,
      retellId: input.retellId ?? null,
      now,
    });
  }
  if (existing.name === input.name) return existing;
  const next: Rehearsal = { ...existing, name: input.name, updatedAt: now };
  await saveRehearsal(next);
  return next;
}

/**
 * The rehearsal of a retell's talk, made if this is the first time. Both doors
 * into a rehearsal end here (docs/43): the Rehearse button on the retell's
 * header and the topic's Rehearsal section are asking for the same object, and
 * pressing Rehearse twice must not leave two histories behind.
 *
 * The outline goes through the same find-or-create (reading/talk/store.ts), so a
 * retell whose conversation has not arranged anything yet gets an empty outline
 * rather than a second one. Whether that door should be open before there is
 * anything on the outline is the screen's question, not this one's.
 *
 * The name is refreshed on the way through, because it follows the retell.
 */
export async function rehearsalForRetell(input: {
  topicId: string;
  retellId: string;
  name: string;
  now?: number;
}): Promise<Rehearsal> {
  const now = input.now ?? Date.now();
  const outline = await talkOutlineForRetell({
    topicId: input.topicId,
    retellId: input.retellId,
    name: input.name,
    now,
  });
  return rehearsalForOutline({
    topicId: input.topicId,
    outlineId: outline.id,
    name: input.name,
    retellId: input.retellId,
    now,
  });
}

export async function renameRehearsal(
  rehearsalId: string,
  name: string,
  now = Date.now(),
): Promise<Rehearsal | null> {
  const existing = await loadRehearsal(rehearsalId);
  if (!existing) return null;
  const trimmed = name.trim();
  if (!trimmed) return existing;
  const next: Rehearsal = { ...existing, name: trimmed, updatedAt: now };
  await saveRehearsal(next);
  return next;
}

// Where a runs file that would not parse is kept. Out of the sync range, so a
// device that could not read the file does not push its rescue copy at the
// others.
function badFile(rehearsalId: string): string {
  return `${rehearsalRunsFile(rehearsalId)}.bad`;
}

/**
 * This rehearsal's index of passes, oldest first — the rows, without the
 * transcripts. A rehearsal that has never been given reads as
 * an empty log, and so does one whose file this build cannot use — but in that
 * case the bytes are moved aside first, so the empty log the caller gets is
 * never the only copy left. That is the shape docs/29 recorded on
 * slides/retells.json: parse fails, the loader returns empty, the next write
 * commits the empty version over the top, and every entry is gone with no error
 * anywhere.
 *
 * A file that is there and would not open raises. Nothing can be moved aside —
 * nothing is known to be wrong with the bytes — so the raise is the only thing
 * standing between the failed read and the overwrite. The three callers all
 * have somewhere to put it: the two lists show what they already have, and
 * finishRun reports the pass as not recorded.
 */
export async function loadRehearsalRuns(rehearsalId: string): Promise<RehearsalLog> {
  const file = rehearsalRunsFile(rehearsalId);
  let text: string;
  try {
    if (!(await appData.exists(file))) return emptyLog(rehearsalId);
    text = await appData.readText(file);
  } catch (e) {
    // An IO error says nothing is wrong with the file itself, so nothing is
    // moved. An empty log is not the answer either: appendRun goes through
    // here, and answering empty would let one failed read replace every pass
    // ever given with the one being recorded — on a file the other device
    // syncs (platform/sync/syncFs.ts).
    console.warn("failed to read the runs of", rehearsalId, e);
    throw new Error(`${file} could not be read`);
  }
  let log: RehearsalLog | null = null;
  try {
    log = normalizeLog(JSON.parse(text) as unknown);
  } catch (e) {
    console.warn("failed to parse the runs of", rehearsalId, e);
  }
  if (log) return log;
  await setAside(rehearsalId);
  return emptyLog(rehearsalId);
}

async function setAside(rehearsalId: string): Promise<void> {
  const file = rehearsalRunsFile(rehearsalId);
  try {
    await appData.rename(file, badFile(rehearsalId));
    console.warn(`${file} could not be read; kept as ${badFile(rehearsalId)} and started over`);
  } catch (e) {
    console.warn(`${file} could not be read and could not be moved aside`, e);
  }
}

/**
 * One pass's transcript. An empty list is the answer for a pass whose file is
 * not there, and for one whose file will not open or will not parse.
 *
 * Not an error and not a set-aside, unlike the log above. The log is what says
 * the pass happened, and it is still here; what is missing is what was said,
 * which no write of this build's is about to overwrite — the file is written
 * once, under a name nothing else will ever use. The one thing that must not
 * happen is the pass disappearing from the history because its transcript
 * would not open.
 *
 * A pass that predates the split still carries its pages in the entry, and they
 * are the answer when there is no file to open.
 */
export async function loadRunPages(entry: RehearsalRunEntry): Promise<RehearsalPage[]> {
  const inlined = entry.pages ?? [];
  const file = runPagesFile(entry.rehearsalId, entry.id);
  if (!file) return inlined;
  try {
    if (!(await appData.exists(file))) return inlined;
    const pages = normalizeRunPages(JSON.parse(await appData.readText(file)) as unknown);
    if (pages) return pages;
    console.warn(`${file} is not a transcript this build can read`);
  } catch (e) {
    console.warn("failed to read the transcript of", entry.id, e);
  }
  return inlined;
}

/** One pass, row and transcript together. */
export async function loadRehearsalRun(entry: RehearsalRunEntry): Promise<RehearsalRun> {
  return { ...entry, pages: await loadRunPages(entry) };
}

// Write one pass's transcript. False when there is nowhere to put it, which is
// the caller's cue to leave the pages in the log entry rather than lose them.
//
// A file already there holds this pass's transcript: the name is the run's own
// id and a run is recorded once, so a second write has nothing to add. Skipping
// it is not only an optimisation — never rewriting the file is the whole of what
// lets sync treat it as cold.
async function writeRunPages(
  rehearsalId: string,
  runId: string,
  pages: readonly RehearsalPage[],
): Promise<boolean> {
  const file = runPagesFile(rehearsalId, runId);
  if (!file) return false;
  if (await appData.exists(file)) return true;
  const contents: RehearsalRunPages = {
    version: RUN_LOG_VERSION,
    rehearsalId,
    runId,
    pages: [...pages],
  };
  await writeTextAtomic(file, JSON.stringify(contents, null, 2));
  return true;
}

async function writeLog(log: RehearsalLog): Promise<void> {
  await writeTextAtomic(rehearsalRunsFile(log.rehearsalId), JSON.stringify(log, null, 2));
}

/**
 * Add one run to its rehearsal's log and write it. The ordinal is assigned here —
 * one past the highest already on disk — because it is a property of the log
 * and not of the run: a caller counting for itself would give two runs the same
 * number the first time one is recorded from a stale list. Returns the entry as
 * it was stored, ordinal included.
 *
 * The transcript is written first and the log second. The other order leaves a
 * row pointing at a file that was never written — a pass in the history with
 * nothing under it, for good. This order leaves at worst a transcript nothing
 * points at, which costs one cold upload and nothing else.
 *
 * The log read comes before either write, so a read that failed stops the whole
 * thing: appendRun is the caller that would otherwise commit an empty log over
 * every pass there ever was (see loadRehearsalRuns).
 */
export async function appendRun(run: BuiltRun): Promise<RehearsalRunEntry> {
  const log = await loadRehearsalRuns(run.rehearsalId);
  const ordinal = log.runs.reduce((max, r) => Math.max(max, r.ordinal), 0) + 1;
  const wrote = await writeRunPages(run.rehearsalId, run.id, run.pages);
  const entry = runEntryOf({ ...run, ordinal });
  // Nowhere to put the transcript means the run's id is not a name a file can
  // have. Keeping the pages in the entry is the one answer that loses nothing;
  // it cannot happen to a run this app recorded, whose id is a UUID.
  const stored: RehearsalRunEntry = wrote ? entry : { ...entry, pages: [...run.pages] };
  await writeLog({ ...log, runs: [...log.runs, stored] });
  return stored;
}

/**
 * Lift every transcript still sitting in one rehearsal's log into a file of its
 * own. Answers with how many passes moved.
 *
 * Idempotent by shape, not by a marker on disk: an entry this has already been
 * through carries no `pages` key, so a second run finds nothing to move and
 * writes nothing at all — not the same bytes again, nothing, so it costs no sync
 * revision and no merge.
 *
 * Two devices converge without coordinating. Both start from the same entries
 * (the log merges entry by entry, platform/sync/merge/contract.ts), the counts
 * are a pure function of the pages, and the file name is the run's own id — so
 * both write the same transcript to the same path and the same row into the log,
 * and the merge is handed two identical entries rather than a conflict.
 *
 * An entry whose inlined transcript was empty keeps whatever counts it already
 * had and gets no file: there is nothing in it to store, and a build that did
 * not know about the split writes `pages: []` back on every append — writing an
 * empty transcript over a real one would be the one destructive thing here.
 */
export async function splitRehearsalRunPages(rehearsalId: string): Promise<number> {
  const log = await loadRehearsalRuns(rehearsalId);
  let moved = 0;
  const next: RehearsalRunEntry[] = [];
  for (const entry of log.runs) {
    if (!("pages" in entry)) {
      next.push(entry);
      continue;
    }
    const { pages = [], ...rest } = entry;
    if (pages.length === 0) {
      next.push(rest);
      moved += 1;
      continue;
    }
    if (!(await writeRunPages(rehearsalId, entry.id, pages))) {
      next.push(entry);
      continue;
    }
    next.push(runEntryOf({ ...rest, pages }));
    moved += 1;
  }
  if (moved === 0) return 0;
  await writeLog({ ...log, runs: next });
  return moved;
}

/**
 * The same over every rehearsal on this device. One log that will not open costs
 * its own passes and nothing else — the rest still move, and the one that did
 * not is tried again next start-up.
 */
export async function splitRehearsalRunPagesEverywhere(): Promise<number> {
  let moved = 0;
  for (const rehearsal of await listAllRehearsals()) {
    try {
      moved += await splitRehearsalRunPages(rehearsal.id);
    } catch (e) {
      console.warn("failed to split the transcripts of", rehearsal.id, e);
    }
  }
  return moved;
}

// The split, run at most once per process. The shell calls it on the way up and
// React runs its effects twice under StrictMode; two passes over the same log
// would produce the same bytes, but they would race each other's write.
let splitRun: Promise<number> | null = null;
export function splitRehearsalRunPagesOnce(): Promise<number> {
  return (splitRun ??= splitRehearsalRunPagesEverywhere());
}

/**
 * Drop a rehearsal: the object, the index of its passes, every transcript under
 * it, and the rescue copy if there is one. Not the outline — a talk outlives the
 * history of one set of passes over it.
 */
export async function deleteRehearsal(rehearsalId: string): Promise<void> {
  const files = [
    rehearsalFile(rehearsalId),
    rehearsalRunsFile(rehearsalId),
    badFile(rehearsalId),
  ];
  for (const file of files) {
    try {
      if (await appData.exists(file)) await appData.remove(file);
    } catch (e) {
      console.warn("failed to delete", file, e);
    }
  }
  // The transcripts go as a directory: one per pass, and there is no list of
  // them left to walk once the index above is gone.
  const dir = runPagesDir(rehearsalId);
  if (!dir) return;
  try {
    if (await appData.exists(dir)) await appData.removeDir(dir);
  } catch (e) {
    console.warn("failed to delete", dir, e);
  }
}

/**
 * Drop the rehearsal of a retell's talk, when the retell itself is deleted. It
 * is a history of passes over a talk nobody will ever open again.
 */
export async function deleteRehearsalsForRetell(retellId: string): Promise<void> {
  for (const r of await listAllRehearsals()) {
    if (r.retellId === retellId) await deleteRehearsal(r.id);
  }
}
