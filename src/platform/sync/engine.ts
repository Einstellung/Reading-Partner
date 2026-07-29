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
// A pass is per-item, not all-or-nothing (docs/pitfall/52). One file that will
// not transfer must not cost the other fifty or the books channel: on a link
// where every request has a real chance of failing, a pass needing fifty of
// them in a row essentially never completes, and the device sits at "Last sync:
// Never" while each individual request plainly works. What a partial pass must
// never do is claim more than it did — lastSyncAt advances only when nothing
// failed, and only a file that actually landed is snapshotted.
//
// Timers: an initial pass on start, a periodic tick every TICK_MS that runs a
// pass when local files changed or PULL_INTERVAL_MS has elapsed since the last
// pull, and an on-demand syncNow(). The app coming back to the front and going
// away drive two more (onForeground/onBackground) — a schedule built on timers
// alone is wrong on a phone, where the timers stop the moment the app is
// backgrounded. All of them funnel through runPass(), so single-flight is the
// only concurrency rule.
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
// same way, so it is left for the next pass.
export const MAX_CONSECUTIVE_FAILURES = 3;

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
  // How two changed copies of a file become one (../merge). Injected like
  // everything else the pass touches, so what the engine does with a merge's
  // copies and dropped records can be pinned without depending on which
  // strategy the merge module happens to apply today.
  merge?: MergeFile;
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

  record(what: string, e: unknown): void {
    this.count += 1;
    this.streak += 1;
    if (this.first === null) {
      const detail = messageOf(e);
      const line = `${what} failed: ${detail}`;
      this.first = line.length > MESSAGE_LIMIT ? `${line.slice(0, MESSAGE_LIMIT - 1)}…` : line;
    }
  }

  succeeded(): void {
    this.streak = 0;
  }

  halted(): boolean {
    return this.streak >= MAX_CONSECUTIVE_FAILURES;
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
  private lastSyncAt: number | null = null;
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
      for (const dl of plan.downloads) {
        if (failures.halted()) break;
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
          if (isAuthFailure(e)) throw e;
          // Listed a moment ago, gone by the time it was asked for. Nothing to
          // pull and nothing a retry can do; deletions are not propagated
          // (docs/13), so the local copy stays as it is.
          if (isRemoteGone(e)) continue;
          failures.record(`download ${dl.path}`, e);
        }
      }

      // Both sides changed since the base. The merge is what gets published, at
      // a rev above the remote's, so both devices converge on it instead of one
      // of them winning the whole file. A merge that fails is one bad file like
      // any other, never the end of the pass.
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

      for (const up of plan.uploads) {
        if (failures.halted()) break;
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
          if (isAuthFailure(e)) throw e;
          failures.record(`upload ${up.path}`, e);
        }
      }

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
