// The sync engine: one pass reconciles the data channel (pull remote-newer
// files, push local changes, merge what both sides changed) then the books
// channel (upload local-only book blobs, download remote-only ones). A single
// pass runs at a time; overlapping triggers are dropped, and a failure (offline)
// is kept as lastError for the UI and retried on the next tick.
//
// What counts as changed is the file's content hash, never its mtime
// (content.ts). mtime and size stay in the snapshot as the pre-filter that
// keeps the 15s tick from reading every file: they can rule a file out, and
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
// Everything the pass touches (backend, fs, books) is injected; the Tauri wiring
// lives in index.ts. reconcile() (reconcile.ts) is the pure decision core.

import { isAuthFailure, isRemoteGone, type SyncBackend } from "./backend";
import type { BookFs } from "./books";
import { hashBytes } from "./content";
import type { BaseStore, TrashJournal } from "./localStore";
import type { MergeFile } from "./merge/contract";
import { mergeFile } from "./merge";
import { cachedHash, reconcile, type Merge, type Snapshot, type Upload } from "./reconcile";
import type { LocalFile, ScannedFile, SyncFs } from "./syncFs";

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
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: EngineDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.snapshot = deps.snapshot;
    this.lastSyncAt = deps.restoredLastSyncAt ?? null;
  }

  start(): void {
    if (this.tickTimer) return;
    void this.runPass();
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
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
  // rather than overwritten. Nothing changed locally means nothing to send, and
  // finding that out costs no requests. A pass that the platform freezes
  // half-way is the case the per-item design already covers — only what landed
  // is claimed.
  async onBackground(): Promise<void> {
    if (this.running) return;
    if (!(await this.hasLocalChange())) return;
    await this.runPass();
  }

  // Periodic wake-up: pass only when there is something to do — local edits, or
  // it has been long enough since the last remote pull.
  private async tick(): Promise<void> {
    if (this.running) return;
    const due = this.now() - this.lastPullAt >= PULL_INTERVAL_MS;
    if (!due && !(await this.hasLocalChange())) return;
    await this.runPass();
  }

  // Cheap on purpose: this runs every TICK_MS. mtime/size rule a file out
  // without reading it, and only what they flag is hashed — which is what keeps
  // a rewrite that changed nothing from waking a pass every 15 seconds.
  private async hasLocalChange(): Promise<boolean> {
    let scanned: ScannedFile[];
    try {
      scanned = await this.d.fs.list();
    } catch {
      return false;
    }
    for (const f of scanned) {
      const snap = this.snapshot[f.path];
      if (!snap) return true;
      if (snap.mtime === f.mtime && snap.size === f.size) continue;
      // Moved, and no hash to compare it against (a snapshot from before
      // hashing): let a pass look properly.
      if (snap.hash === undefined) return true;
      try {
        if ((await hashBytes(await this.d.fs.read(f.path))) !== snap.hash) return true;
      } catch {
        // Unreadable right now; a pass could not move it either.
      }
    }
    return false;
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

    await this.d.fs.write(mg.path, out.merged);
    for (const copy of out.copies) {
      // Never overwrite: a copy is named from its own content, so a path that
      // already exists holds those exact bytes — and if it somehow does not, it
      // is someone's file and this is not the code that gets to replace it.
      if ((await this.d.fs.stat(copy.path)) !== null) continue;
      await this.d.fs.write(copy.path, copy.bytes);
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

  private async runPass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastPassAt = this.now();
    this.emitStatus();
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
      const plan = reconcile(local, remote, this.snapshot);
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
      // Pull first so library.json is current before the books channel reads it.
      await runPool(plan.downloads, DATA_CONCURRENCY, () => failures.halted(), async (dl) => {
        try {
          const bytes = await this.d.backend.download(dl.path);
          await this.d.fs.write(dl.path, bytes);
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

      await this.syncBooks(failures);

      // A pass that got this far pulled what it could, so the next one is due on
      // the normal schedule rather than on the next 15s tick.
      this.lastPullAt = this.now();
      // Only a clean pass counts as a sync: health's staleness check reads
      // lastSyncAt as "everything this device holds is mirrored".
      if (failures.count === 0) this.lastSyncAt = this.now();
      this.lastError = failures.message();
      if (changed.length > 0) this.d.onPulled?.(changed);
    } catch (e) {
      this.lastError = messageOf(e);
      if (isAuthFailure(e)) this.d.onSignedOut?.();
    } finally {
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
  private async syncBooks(failures: PassFailures): Promise<void> {
    // Before listHashes, not inside the loop: under "off" the channel does not
    // exist, so it does not read library.json either.
    if ((this.d.booksPolicy ?? "mirror") === "off") return;
    const hashes = await this.d.books.listHashes();
    for (const hash of hashes) {
      if (failures.halted()) break;
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
