// The sync engine: one pass reconciles the data channel (pull remote-newer
// files, push local changes, merge what both sides changed) then the books
// channel (upload local-only book blobs, download remote-only ones). A single
// pass runs at a time; overlapping triggers are dropped, and a failure (offline)
// is kept as lastError for the UI and retried on the next tick.
//
// What counts as changed is the file's content hash, never its mtime
// (content.ts). mtime and size stay in the snapshot as the pre-filter that
// keeps a pass from reading every file it lists: they can rule a file out, and
// only what they flag is hashed.
//
// A file both sides changed is merged, not won: the three inputs are the base
// (localStore.ts), this device's content and the other's, and the merged result
// is published above the remote's rev so both devices converge on it. Records
// the merge dropped are journalled locally (sync-trash.jsonl) so a propagated
// delete stays recoverable.
//
// A pass also drains the purge queue first (state.ts): the paths a shipped
// build named as no longer being data at all. That is the one deletion sync
// performs, and it is not the loop's own conclusion about two sides of a file —
// nothing compared decides it.
//
// A pass is per-item, not all-or-nothing (docs/pitfall/52). One file that will
// not transfer must not cost the other fifty or the books channel: on a link
// where every request has a real chance of failing, a pass needing fifty of
// them in a row essentially never completes, and the device sits at "Last sync:
// Never" while each individual request plainly works. What a partial pass must
// never do is claim more than it did — lastSyncAt advances only when nothing
// failed, and only a file that actually landed is snapshotted.
//
// The per-item transfers of the data channel run in a bounded pool
// (DATA_CONCURRENCY) rather than one after another: the channel holds hundreds
// of small files, and one request at a time makes a first sync a queue of
// hundreds of round trips. The merges and the books channel stay serial for
// reasons of their own, written where they are.
//
// Timers: an initial pass on start, a periodic tick every TICK_MS that runs a
// pass when local files changed or PULL_INTERVAL_MS has elapsed since the last
// pull, and an on-demand syncNow(). The app coming back to the front and going
// away drive two more (onForeground/onBackground) — a schedule built on timers
// alone is wrong on a phone, where the timers stop the moment the app is
// backgrounded. All of them funnel through runPass(), so no two passes ever
// overlap; the concurrency inside one is the transfer pool and nothing else.
//
// What tells a tick that local files changed is the app saying so, not a scan.
// This app is the only writer of everything in the sync range, so it already
// knows: every text file lands through the atomic writer and every removal
// through the AppData door, and both announce the path (platform/app). The
// in-range ones go in a dirty set, and a tick with an empty set is over without
// touching the disk. What that replaces read a stat for each of the 273 data
// files four times a minute to conclude, almost always, that nothing had
// happened.
//
// The set is in memory and incomplete by construction: a process that dies
// loses it, a rename announces a destination nothing calls a write (migrate.ts
// moves annotations-<key>.json exactly that way), a directory removed whole
// names the directory and not the files under it, and the next way to write a
// file without saying so has not been invented yet. Missing one change is not a
// slow sync but a file that never syncs, so the full scan stays — as the sweep
// rather than as the schedule. A pass always lists the range and hashes what
// moved, and a pass runs on start, on every return to the foreground, and
// whenever PULL_INTERVAL_MS has elapsed since the last one that got through.
// A change no broadcast covered is therefore late by at most PULL_INTERVAL_MS +
// TICK_MS while the app is open, by the resume floor on a phone that was away,
// and by nothing at all across a restart — but never lost, which is the one
// property the poll had that this must not give up.
//
// Everything the pass touches (backend, fs, books) is injected; the Tauri wiring
// lives in index.ts. reconcile() (reconcile.ts) is the pure decision core.

import { DELETED_BOOKS_FILE, parseDeletedBooks } from "../app/deleted-books";
import { isAuthFailure, isRemoteGone, type SyncBackend } from "./backend";
import type { BookFs } from "./books";
import { hashBytes } from "./content";
import type { BaseStore, TrashJournal } from "./localStore";
import type { MergeFile } from "./merge/contract";
import { mergeFile } from "./merge";
import { isDeadPath } from "./dead-paths";
import { cachedHash, reconcile, type Merge, type Snapshot, type Upload } from "./reconcile";
import { inSyncRange, type LocalFile, type ScannedFile, type SyncFs } from "./syncFs";

export const TICK_MS = 15_000;
export const PULL_INTERVAL_MS = 5 * 60_000;

// The floor between two passes triggered by the app coming back to the front.
// Returning is the strongest hint that another device moved something, so the
// pull window is skipped — but switching away and back is not a rare gesture
// (a phone flicked between two apps, a desktop window that loses focus to every
// dialog), and one remote listing per flick is not a schedule. Two ticks: a
// device that synced this recently cannot be meaningfully stale, and no amount
// of flapping costs more than the steady 15s tick already does.
export const RESUME_MIN_INTERVAL_MS = 30_000;

// A run of failures this long means the link is down, not that one file is
// awkward. The rest of the pass would only spend its retry budget failing the
// same way, so it is left for the next pass. It is consulted before a transfer
// is dispatched, so a pool that trips it still has whatever it had on the wire:
// the guard exists to save a device from grinding through hundreds of items on
// a dead link, not to make the last few requests exact.
export const MAX_CONSECUTIVE_FAILURES = 3;

// How many data-channel transfers are on the wire at once.
//
// Latency is the entire cost here: the data files average 11 KB, so a pass over
// the current 273 of them is 273 round trips with nothing in between, which
// through a proxy is close to two minutes of first sync on a phone. None of
// that is bandwidth, and none of it gets better by waiting.
//
// The ceiling is memory, not the server: a body handed to the Tauri http plugin
// costs about twenty times its own size while the request is alive
// (docs/pitfall/54), so eight 11 KB files in flight is on the order of 2 MB —
// irrelevant next to what opening one book already costs. Drive's per-user
// rate limits sit far above eight concurrent requests, so they are not what
// picks this number either. Eight is small enough that a data file which grew
// an order of magnitude would still be affordable.
export const DATA_CONCURRENCY = 8;

// Run `task` over every item with at most `limit` of them in flight.
//
// `task` must not reject. A rejection would take the whole Promise.all with it
// and leave its siblings running unobserved, which is precisely the
// all-or-nothing behaviour a pass must not have (docs/pitfall/52) — so every
// caller keeps the try/catch its serial loop had, inside the task.
//
// `stop` is asked before each dispatch and never mid-task: nothing here can
// call back a request that is already on the wire, so a pool that stops costs
// at most the tasks it had already started.
async function runPool<T>(
  items: readonly T[],
  limit: number,
  stop: () => boolean,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !stop()) {
      await task(items[next++]);
    }
  };
  const width = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: width }, () => worker()));
}

// Cap on the failure text kept for the UI: it is shown on one line in Settings,
// and Drive's error bodies run long.
const MESSAGE_LIMIT = 160;

// Whether the books channel runs at all. "mirror" is every shell that can open
// a book: local-only blobs go up, remote-only ones come down. "off" is the
// phone (docs/22), which never opens a PDF and has no way to import one —
// mirroring the library there spends a data plan and a phone's storage on files
// nothing on the device can read. The channel is off in both directions, not
// just the download half, so the policy has one meaning rather than two.
//
// library.json still travels the data channel, so the phone knows which books
// exist; nothing there reads it (docs/22 — no shelf, no reader).
export type BooksPolicy = "mirror" | "off";

export interface EngineDeps {
  backend: SyncBackend;
  fs: SyncFs;
  books: BookFs;
  // Defaults to "mirror": the shells that open books are the ones that existed
  // first, and a caller that has not thought about it gets what it had.
  booksPolicy?: BooksPolicy;
  // The last agreed content of every synced file, for three-way merges.
  base: BaseStore;
  // Where records a merge dropped are kept so a propagated delete stays
  // recoverable. Local only; never synced.
  trash: TrashJournal;
  snapshot: Snapshot;
  // Paths a build has decided must not exist in the remote any more (state.ts).
  // Held by reference like the snapshot, and emptied entry by entry as the
  // deletes land, so a pass that gets through half the list and loses the link
  // comes back for the rest.
  purge?: string[];
  // How two changed copies of a file become one (../merge). Injected like
  // everything else the pass touches, so what the engine does with a merge's
  // copies and dropped records can be pinned without depending on which
  // strategy the merge module happens to apply today.
  merge?: MergeFile;
  // When this device last completed a clean pass, as sync-state.json remembers
  // it from a previous run. Read once at construction and never written here —
  // it is not the time of this pass, and a pass that fails leaves it as it came
  // in. Without it a restarted engine reports "never synced" until its first
  // clean pass, on a device that has been syncing for months.
  restoredLastSyncAt?: number | null;
  now?: () => number;
  // Called after a pass writes files pulled from remote, with their paths, so
  // the shell can refresh the shelf / drop stale caches.
  onPulled?: (changed: string[]) => void;
  // Called whenever a pass finishes (success or failure) so the UI can refresh.
  onStatus?: (status: PassResult) => void;
  // Signed-out signal (a dead refresh token surfaced mid-pass).
  onSignedOut?: () => void;
  // Every local file the app writes or takes away, by AppData-relative path,
  // for as long as the returned undo has not been called. Bound while the
  // engine ticks; the paths it hands over are unfiltered, and which of them are
  // this engine's business is decided here (inSyncRange).
  //
  // Injected rather than imported because the broadcasts are module-level
  // registries in platform/app: an engine that subscribed to them itself could
  // not be run headless, and two engines in one process would hear each other's
  // pulls. Left out entirely, the engine still works — every pass is then a
  // sweep, which is what a test that drives syncNow() directly wants.
  watchLocal?: (listener: (path: string) => void) => () => void;
}

export interface PassResult {
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  snapshot: Snapshot;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// What failed in one pass, and whether to keep going. Every line the user reads
// about a partial pass is composed here, so it names the file rather than the
// URL: "download annotations-<hash>.json failed: …" is diagnosable, the Drive
// media URL alone is not.
class PassFailures {
  count = 0;
  private first: string | null = null;
  private streak = 0;
  private auth: unknown = null;

  record(what: string, e: unknown): void {
    this.count += 1;
    this.streak += 1;
    if (this.first === null) {
      const detail = messageOf(e);
      const line = `${what} failed: ${detail}`;
      this.first = line.length > MESSAGE_LIMIT ? `${line.slice(0, MESSAGE_LIMIT - 1)}…` : line;
    }
  }

  // A dead token is not one awkward file: every request left in the pass would
  // only spend itself learning the same thing, which on the data channel is two
  // hundred more requests into the same wall. The serial loops throw it on the
  // spot; a pool cannot, because it has siblings on the wire that nothing can
  // call back — so it is kept here, dispatch stops at once, the in-flight tasks
  // are left to settle, and rethrowAuthFailure() puts the pass exactly where
  // the serial `throw` used to put it. Siblings that fail the same way after it
  // are dropped rather than recorded: they are one condition, not several
  // faults, and the pass reports the auth error itself either way.
  recordAuth(e: unknown): void {
    if (this.auth === null) this.auth = e;
  }

  rethrowAuthFailure(): void {
    if (this.auth !== null) throw this.auth;
  }

  succeeded(): void {
    this.streak = 0;
  }

  halted(): boolean {
    return this.auth !== null || this.streak >= MAX_CONSECUTIVE_FAILURES;
  }

  message(): string | null {
    if (this.count === 0) return null;
    if (this.count === 1) return this.first;
    return `${this.count} items failed; first: ${this.first}`;
  }
}

export class SyncEngine {
  private readonly d: EngineDeps;
  private readonly now: () => number;
  private snapshot: Snapshot;
  private running = false;
  private lastSyncAt: number | null;
  private lastError: string | null = null;
  private lastPullAt = 0;
  // When the last pass began, whatever triggered it and whether it succeeded.
  // Only the resume floor reads it: what it has to know is when this device
  // last asked the remote anything, not when it last got a clean answer.
  private lastPassAt = 0;
  // Book blobs this process has already asked the remote to delete, so a
  // tombstone list that only grows does not cost a Drive search per book per
  // pass (syncBooks).
  private readonly booksRemoved = new Set<string>();
  // The parsed tombstone and the hash of the bytes it was parsed from.
  private deadCache: { hash: string; books: Set<string> } | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  // In-range paths the app has changed since the running pass started. Empty is
  // the whole of "there is nothing to send"; see the top of this file for why
  // that is allowed to be wrong and what catches it when it is.
  private dirty = new Set<string>();
  // Writes this engine has on the wire right now, by path. A pull and a merge
  // land through the same atomic writer every store uses, so they announce
  // themselves exactly like a user's edit; this is what tells the two apart.
  private readonly selfWrites = new Map<string, number>();
  private unwatch: (() => void) | null = null;

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.snapshot = deps.snapshot;
    this.lastSyncAt = deps.restoredLastSyncAt ?? null;
    // From construction rather than from start(): there is no window in which
    // this engine exists and is not keeping the record, and listening costs one
    // string test per write whether or not anything ticks. stop() gives it back,
    // which is what keeps a signed-out engine from outliving itself in the
    // registry (index.ts drops the object right after).
    this.unwatch = deps.watchLocal?.((path) => this.noteLocalChange(path)) ?? null;
  }

  start(): void {
    if (this.tickTimer) return;
    // For an engine that was stopped and started again — a fresh one has been
    // listening since it was constructed. Before the first pass either way: a
    // file written while that pass runs has to land in the set rather than in
    // the gap in front of it.
    this.unwatch ??= this.d.watchLocal?.((path) => this.noteLocalChange(path)) ?? null;
    void this.runPass();
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    // Nothing runs passes any more, so a set that kept filling would only be a
    // record of edits nobody asked this engine to send. What is already in it
    // stays: a restart begins with a pass over everything regardless.
    this.unwatch?.();
    this.unwatch = null;
  }

  // The app wrote or removed a file. Out-of-range paths are the common case
  // (book blobs, thumbnails, the event log, sync's own state) and cost one
  // string test each.
  private noteLocalChange(path: string): void {
    if (!inSyncRange(path)) return;
    // This engine's own pull or merge landing, not somebody's edit. The test is
    // not "the path is in this pass's plan" — a path stays in the plan for the
    // whole pass, so an edit made anywhere in those seconds would be thrown
    // away with it. It is whether a write of ours to that exact path is on the
    // wire at the instant the broadcast arrives, which is one IPC wide.
    //
    // The credit is consumed rather than merely read, so that a user's write
    // that happens to land inside that window is not lost: it takes the credit,
    // our own write finds none left, and the path ends up dirty either way. Who
    // gets attributed to which is not knowable and does not matter — the count
    // of unexplained writes is what decides.
    const mine = this.selfWrites.get(path) ?? 0;
    if (mine > 0) {
      this.selfWrites.set(path, mine - 1);
      return;
    }
    this.dirty.add(path);
  }

  // Write a file the pass itself produced (a download, a merge, a merge's
  // copy). The credit is handed back in a finally, so a write that throws — or
  // one that lands through a route that announces nothing — cannot leave a path
  // permanently deaf to the user's next edit.
  private async writeLocal(path: string, bytes: Uint8Array): Promise<void> {
    this.selfWrites.set(path, (this.selfWrites.get(path) ?? 0) + 1);
    try {
      await this.d.fs.write(path, bytes);
    } finally {
      const left = (this.selfWrites.get(path) ?? 0) - 1;
      if (left > 0) this.selfWrites.set(path, left);
      else this.selfWrites.delete(path);
    }
  }

  status(): PassResult {
    return {
      running: this.running,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      snapshot: this.snapshot,
    };
  }

  // Manual "Sync now": always runs a full pass (unless one is already running).
  async syncNow(): Promise<void> {
    await this.runPass();
  }

  // The app came back to the front. Which events those are is the wiring's
  // business (platform/app/lifecycle.ts); what matters here is that the periodic
  // schedule is the wrong one to come back to: a pull is due once every
  // PULL_INTERVAL_MS, so a device that was away would sit on the other device's
  // work for up to five minutes while its user looks straight at it. On a phone
  // it is worse than late — the timers do not run at all while the app is
  // backgrounded, so the five minutes only start when the user returns.
  //
  // Live only while the engine is ticking: the caller binds these hooks when it
  // starts the engine and unbinds them when it stops, so auto-sync off means
  // nothing runs here either.
  async onForeground(): Promise<void> {
    if (this.now() - this.lastPassAt < RESUME_MIN_INTERVAL_MS) return;
    await this.runPass();
  }

  // The app is going away. Local writes have their own pagehide flush, so
  // nothing is lost either way; what this saves is the change sitting on one
  // device until it is next opened, which on a phone can be days.
  //
  // A whole pass rather than the uploads alone: publishing needs the rev the
  // remote is at, and a file the other device also changed has to be merged
  // rather than overwritten. A pass that the platform freezes half-way is the
  // case the per-item design already covers — only what landed is claimed.
  //
  // Leaving is the one edge that has to stay cheap (docs/pitfall/69 — a desktop
  // window reports it every time it loses focus to a dialog), so what says there
  // is nothing to send is the dirty set and nothing else. Deliberately not a
  // sweep point: an edit no broadcast covered waits for the next return to the
  // front, which is the earliest moment its absence could be noticed anyway.
  async onBackground(): Promise<void> {
    if (this.running) return;
    if (this.dirty.size === 0) return;
    await this.runPass();
  }

  // Periodic wake-up: pass only when there is something to do — local edits, or
  // it has been long enough since the last remote pull. Free in the steady
  // state, which is what it is in nearly every one of the four times a minute
  // it fires: an empty set is answered without a stat, a read or a request.
  //
  // Public so a test can drive the schedule without waiting on a real timer.
  async tick(): Promise<void> {
    if (this.running) return;
    const due = this.now() - this.lastPullAt >= PULL_INTERVAL_MS;
    if (!due && this.dirty.size === 0) return;
    await this.runPass();
  }

  // Fill in the content hash of every scanned file. The snapshot supplies it
  // for free when mtime and size still match, so a steady pass reads only the
  // files that actually moved. A file that will not read is dropped from the
  // pass entirely: it cannot be uploaded, and list() already tolerates one
  // vanishing mid-scan.
  private async hashLocal(scanned: ScannedFile[]): Promise<LocalFile[]> {
    const out: LocalFile[] = [];
    for (const f of scanned) {
      const known = cachedHash(this.snapshot[f.path], f);
      if (known !== null) {
        out.push({ ...f, hash: known });
        continue;
      }
      try {
        out.push({ ...f, hash: await hashBytes(await this.d.fs.read(f.path)) });
      } catch {
        // skipped
      }
    }
    return out;
  }

  private emitStatus(): void {
    this.d.onStatus?.(this.status());
  }

  // A base is an optimisation for the next conflict, never a reason to fail the
  // file that produced it: a pass that moved the bytes correctly and could not
  // write the base has still done its job, and the merge contract accepts a
  // missing base.
  private async setBase(path: string, bytes: Uint8Array): Promise<void> {
    await this.d.base.write(path, bytes).catch(() => {});
  }

  // What a landed upload leaves behind: the snapshot says what this device is
  // in step with, the base says what both sides now agree the content is.
  private async record(up: Upload, bytes: Uint8Array): Promise<void> {
    this.snapshot[up.path] = { rev: up.rev, mtime: up.mtime, size: up.size, hash: up.hash };
    await this.setBase(up.path, bytes);
  }

  private async rebase(path: string): Promise<void> {
    try {
      await this.d.base.write(path, await this.d.fs.read(path));
    } catch {
      // see setBase
    }
  }

  // One three-way merge, start to finish: fetch the other side, merge it with
  // this one over the base, and get the result onto disk and into Drive.
  //
  // The local write comes before the upload on purpose. The merged bytes are
  // the only copy that holds both sides' work, and a merge whose upload dies is
  // repeated next pass; a merge whose local write never happened has thrown
  // that work away.
  private async mergeOne(mg: Merge): Promise<{ up: Upload; bytes: Uint8Array }> {
    const remote = await this.d.backend.download(mg.path);
    const local = await this.d.fs.read(mg.path);
    const base = await this.d.base.read(mg.path);
    const out = (this.d.merge ?? mergeFile)({ path: mg.path, base, local, remote });

    await this.writeLocal(mg.path, out.merged);
    for (const copy of out.copies) {
      // Never overwrite: a copy is named from its own content, so a path that
      // already exists holds those exact bytes — and if it somehow does not, it
      // is someone's file and this is not the code that gets to replace it.
      if ((await this.d.fs.stat(copy.path)) !== null) continue;
      await this.writeLocal(copy.path, copy.bytes);
    }
    if (out.dropped.length > 0) {
      // Record-level deletes do propagate, so the only thing standing between
      // the user and a silently vanished record is this journal.
      await this.d.trash.append(
        out.dropped.map((d) => ({ at: this.now(), path: mg.path, id: d.id, record: d.record })),
      );
    }

    const st = await this.d.fs.stat(mg.path);
    const up: Upload = {
      path: mg.path,
      rev: mg.rev,
      mtime: st?.mtime ?? 0,
      size: out.merged.length,
      hash: await hashBytes(out.merged),
    };
    await this.d.backend.upload(up.path, out.merged, {
      rev: up.rev,
      mtime: up.mtime,
      hash: up.hash,
    });
    return { up, bytes: out.merged };
  }

  // Files that were already in sync when the base landed have none, and neither
  // does one whose base the user deleted. Nothing moves them, so nothing else
  // would ever write it: seed it from disk, which is what both sides agree on
  // whenever the local hash still matches the snapshot's.
  private async seedBases(local: LocalFile[], moved: Set<string>): Promise<void> {
    for (const f of local) {
      if (moved.has(f.path)) continue;
      const snap = this.snapshot[f.path];
      if (!snap || snap.hash !== f.hash) continue;
      try {
        if (await this.d.base.has(f.path)) continue;
      } catch {
        continue;
      }
      await this.rebase(f.path);
    }
  }

  // Delete what a build has decided is not data any more, and forget everything
  // this device remembered about it. The queue is the only record that the
  // decision was made, so an entry comes off it exactly when its delete has
  // landed — a failure leaves the entry where it is for the next pass.
  //
  // This is not the reconcile loop reaching a new conclusion: no comparison
  // decides anything here, and a file only ever gets here because code that
  // shipped said so by name (docs/13 — a sync still never destroys a file on its
  // own reading of the two sides).
  private async drainPurge(failures: PassFailures): Promise<void> {
    const queue = this.d.purge;
    if (!queue || queue.length === 0) return;
    for (const path of [...queue]) {
      if (failures.halted()) return;
      try {
        await this.d.backend.remove(path);
      } catch (e) {
        if (isAuthFailure(e)) throw e;
        failures.record(`delete ${path}`, e);
        continue;
      }
      failures.succeeded();
      const at = queue.indexOf(path);
      if (at !== -1) queue.splice(at, 1);
      delete this.snapshot[path];
      await this.d.base.remove(path).catch(() => {});
    }
  }

  // The books the reader deleted, as this device's copy of the tombstone knows
  // them (platform/app/deleted-books.ts). Read through the pass's own fs rather
  // than through readDeletedBooks: it is an in-range file like any other, and
  // the pass reads every other file it acts on this way. A file that will not
  // read is no tombstones — a pass that cannot read it must not conclude that
  // every book is deleted.
  //
  // Taken from the scan, and cached on the content hash the scan already
  // produced, so a steady pass reads nothing: the file is absent on most
  // devices, and where it exists it changes only when a book is deleted. A
  // tombstone this pass pulls is therefore acted on by the next one — the
  // download lands after the plan is made either way, and fifteen seconds is not
  // a property anything here needs.
  private async deadBooks(local: LocalFile[]): Promise<Set<string>> {
    const f = local.find((l) => l.path === DELETED_BOOKS_FILE);
    if (!f) return new Set();
    if (this.deadCache?.hash === f.hash) return this.deadCache.books;
    try {
      const books = parseDeletedBooks(
        new TextDecoder().decode(await this.d.fs.read(DELETED_BOOKS_FILE)),
      );
      this.deadCache = { hash: f.hash, books };
      return books;
    } catch {
      return new Set();
    }
  }

  // Take one dead path off both sides. The local copy goes first and is
  // journalled on the way out: the device that deleted the book has nothing left
  // to lose, but a device that spent the week editing these annotations offline
  // is losing that week's work here, and sync-trash.jsonl is the thirty days it
  // stays recoverable in (localStore.ts).
  //
  // The remote delete failing is not the pass's problem to solve twice: the
  // tombstone is still there next pass, and reconcile will name the path again.
  private async purgeDead(
    path: string,
    inRemote: boolean,
    failures: PassFailures,
  ): Promise<boolean> {
    let bytes: Uint8Array | null = null;
    try {
      bytes = await this.d.fs.read(path);
    } catch {
      // Not on this device, or unreadable. Either way there is nothing to
      // journal and nothing to delete.
    }
    if (bytes !== null) {
      await this.d.trash
        .append([
          { at: this.now(), path, id: path, record: new TextDecoder().decode(bytes) },
        ])
        .catch(() => {});
      await this.d.fs.remove(path).catch(() => {});
    }
    if (inRemote) {
      try {
        await this.d.backend.remove(path);
      } catch (e) {
        if (isAuthFailure(e)) throw e;
        failures.record(`delete ${path}`, e);
        return bytes !== null;
      }
      failures.succeeded();
    }
    delete this.snapshot[path];
    await this.d.base.remove(path).catch(() => {});
    return bytes !== null;
  }

  private async runPass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastPassAt = this.now();
    this.emitStatus();
    // Take what is dirty now and start a fresh set in the same breath. Every
    // write from here on lands in the new one and survives this pass however
    // long it runs — which is the whole point: a file edited while the pass is
    // uploading its previous content would otherwise be cleared by a pass that
    // never saw the edit, and that edit would sit on the device until the next
    // sweep. Everything claimed here was on disk before the pass listed the
    // range, so this pass is the one that answers for it.
    const claimed = [...this.dirty];
    this.dirty.clear();
    let clean = false;
    const failures = new PassFailures();
    try {
      // The layout and the remote listing are what the rest of the pass stands
      // on: without them there is nothing to reconcile, so these two still stop
      // it.
      await this.d.backend.ensureLayout();
      // Before the listing: a path still in the remote when it is listed would
      // be reconciled against, and a path this pass is about to delete has no
      // business in a plan.
      await this.drainPurge(failures);
      const remote = await this.d.backend.listRemote();
      const local = await this.hashLocal(await this.d.fs.list());
      // Read before the plan is made: the tombstone is what turns "this file is
      // only on one side" from something to copy into something to take away
      // (dead-paths.ts).
      const dead = await this.deadBooks(local);
      const plan = reconcile(local, remote, this.snapshot, (path) => isDeadPath(path, dead));
      await this.d.trash.prune(this.now()).catch(() => {});

      // No bytes move for these: the snapshot is only catching up on what it
      // needs to skip the file cheaply next pass. The base does move — the
      // agreed content is whatever is on disk right now.
      for (const cv of plan.converged) {
        this.snapshot[cv.path] = {
          rev: cv.rev,
          mtime: cv.mtime,
          size: cv.size,
          hash: cv.hash,
        };
        await this.rebase(cv.path);
      }
      for (const path of plan.dropBases) {
        await this.d.base.remove(path).catch(() => {});
      }

      const changed: string[] = [];

      // Before the transfers, like drainPurge and for the same reason: a path
      // this pass is about to take away has no business in one. The paths are
      // reported as changed so the caches keyed by book drop what they hold
      // (pull-routes.ts) — a deleted file is as good a reason as a pulled one.
      for (const path of plan.purges) {
        if (failures.halted()) break;
        if (await this.purgeDead(path, remote[path] !== undefined, failures)) changed.push(path);
      }

      // Pull first so library.json is current before the books channel reads it.
      await runPool(plan.downloads, DATA_CONCURRENCY, () => failures.halted(), async (dl) => {
        try {
          const bytes = await this.d.backend.download(dl.path);
          await this.writeLocal(dl.path, bytes);
          const st = await this.d.fs.stat(dl.path);
          this.snapshot[dl.path] = {
            rev: dl.rev,
            mtime: st?.mtime ?? 0,
            size: bytes.length,
            hash: await hashBytes(bytes),
          };
          // Both sides are known to hold these bytes now: that is the base a
          // later conflict gets to reason from.
          await this.setBase(dl.path, bytes);
          changed.push(dl.path);
          failures.succeeded();
        } catch (e) {
          if (isAuthFailure(e)) {
            failures.recordAuth(e);
            return;
          }
          // Listed a moment ago, gone by the time it was asked for. Nothing to
          // pull and nothing a retry can do; deletions are not propagated
          // (docs/13), so the local copy stays as it is.
          if (isRemoteGone(e)) return;
          failures.record(`download ${dl.path}`, e);
        }
      });
      failures.rethrowAuthFailure();

      // Both sides changed since the base. The merge is what gets published, at
      // a rev above the remote's, so both devices converge on it instead of one
      // of them winning the whole file. A merge that fails is one bad file like
      // any other, never the end of the pass.
      //
      // Serial, unlike the transfers on either side of it: a merge is not a
      // round trip but a read-modify-write over local files, the base store and
      // the trash journal, and a pass only ever has a handful. There is no
      // queue of latency here to win back.
      for (const mg of plan.merges) {
        if (failures.halted()) break;
        try {
          const { up, bytes } = await this.mergeOne(mg);
          this.record(up, bytes);
          // The local file changed, so the shell has to reload it.
          changed.push(mg.path);
          failures.succeeded();
        } catch (e) {
          if (isAuthFailure(e)) throw e;
          if (isRemoteGone(e)) continue;
          failures.record(`merge ${mg.path}`, e);
        }
      }

      await runPool(plan.uploads, DATA_CONCURRENCY, () => failures.halted(), async (up) => {
        try {
          const bytes = await this.d.fs.read(up.path);
          await this.d.backend.upload(up.path, bytes, {
            rev: up.rev,
            mtime: up.mtime,
            hash: up.hash,
          });
          // An upload carries its own rev, so what landed is published the
          // moment it lands. There is no second request that could leave bytes
          // in Drive no other device can see.
          await this.record(up, bytes);
          failures.succeeded();
        } catch (e) {
          if (isAuthFailure(e)) {
            failures.recordAuth(e);
            return;
          }
          failures.record(`upload ${up.path}`, e);
        }
      });
      failures.rethrowAuthFailure();

      await this.seedBases(
        local,
        new Set([
          ...plan.converged.map((c) => c.path),
          ...plan.downloads.map((d) => d.path),
          ...plan.uploads.map((u) => u.path),
          ...plan.merges.map((m) => m.path),
        ]),
      );

      await this.syncBooks(failures, dead);

      // A pass that got this far pulled what it could, so the next one is due on
      // the normal schedule rather than on the next 15s tick.
      this.lastPullAt = this.now();
      // Only a clean pass counts as a sync: health's staleness check reads
      // lastSyncAt as "everything this device holds is mirrored".
      clean = failures.count === 0;
      if (clean) this.lastSyncAt = this.now();
      this.lastError = failures.message();
      if (changed.length > 0) this.d.onPulled?.(changed);
    } catch (e) {
      this.lastError = messageOf(e);
      if (isAuthFailure(e)) this.d.onSignedOut?.();
    } finally {
      // Anything less than a clean pass has not answered for what it claimed:
      // the pool stops dispatching on a dead link, and a file whose upload
      // failed is exactly the file the next tick has to come back for. Put them
      // back rather than leave them to the sweep. A clean pass reconciled every
      // one of them against a listing taken after the swap, so it is done with
      // them — including a path that was claimed because it was deleted, which
      // no plan ever moves and which would otherwise stay dirty forever.
      if (!clean) for (const path of claimed) this.dirty.add(path);
      this.running = false;
      this.emitStatus();
    }
  }

  // One book at a time, and it stays that way whatever the data channel does.
  // A blob handed to the http plugin costs about twenty times its own size in
  // memory while the request is alive (docs/pitfall/54): 26 MB peaked at 400 MB
  // on an iPad and got the webview killed by jetsam, which is why the upload is
  // chunked at all. Chunking bounds one book's peak; two books at once
  // multiplies whatever that peak is, and the device that needs this channel
  // most is the one with the least memory to lose.
  private async syncBooks(failures: PassFailures, dead: ReadonlySet<string>): Promise<void> {
    // Before listHashes, not inside the loop: under "off" the channel does not
    // exist, so it does not read library.json either — nor does it delete
    // anything from the remote, since a shell that never mirrors a book has no
    // standing to say a blob should go.
    if ((this.d.booksPolicy ?? "mirror") === "off") return;
    // A deleted book is normally gone from library.json too, so listHashes will
    // not name it; the blob it left in Drive is what has to be asked for by
    // name. Once per process: removeBook is idempotent, and a hash that is
    // already gone costs one search every time it is retried.
    for (const hash of dead) {
      if (failures.halted()) break;
      if (this.booksRemoved.has(hash)) continue;
      try {
        await this.d.backend.removeBook(hash);
        this.booksRemoved.add(hash);
        failures.succeeded();
      } catch (e) {
        if (isAuthFailure(e)) throw e;
        if (isRemoteGone(e)) {
          this.booksRemoved.add(hash);
          continue;
        }
        failures.record(`delete book ${hash}`, e);
      }
    }
    const hashes = await this.d.books.listHashes();
    for (const hash of hashes) {
      if (failures.halted()) break;
      // Still in library.json on this device — the record delete has not
      // arrived yet, or this is the device that has not run the domain half.
      // Mirroring it either way would put the blob straight back.
      if (dead.has(hash)) continue;
      try {
        const [localHas, remoteHas] = await Promise.all([
          this.d.books.has(hash),
          this.d.backend.hasBook(hash),
        ]);
        if (localHas && !remoteHas) {
          await this.d.backend.uploadBook(hash, await this.d.books.read(hash));
        } else if (!localHas && remoteHas) {
          await this.d.books.write(hash, await this.d.backend.downloadBook(hash));
        }
        failures.succeeded();
      } catch (e) {
        if (isAuthFailure(e)) throw e;
        if (isRemoteGone(e)) continue;
        failures.record(`book ${hash}`, e);
      }
    }
  }

  // Exposed for persistence: the current snapshot to write into sync-state.json.
  currentSnapshot(): Snapshot {
    return this.snapshot;
  }
}
