// The sync engine: one pass reconciles the data channel (pull remote-newer
// files, push local changes, last-writer-wins on conflict) then the books
// channel (upload local-only book blobs, download remote-only ones). A single
// pass runs at a time; overlapping triggers are dropped, and a failure (offline)
// is kept as lastError for the UI and retried on the next tick.
//
// What counts as changed is the file's content hash, never its mtime
// (content.ts). mtime and size stay in the snapshot as the pre-filter that
// keeps the 15s tick from reading every file: they can rule a file out, and
// only what they flag is hashed.
//
// A pass is per-item, not all-or-nothing (docs/pitfall/52). One file that will
// not transfer must not cost the other fifty, the manifest write or the books
// channel: on a link where every request has a real chance of failing, a pass
// needing fifty of them in a row essentially never completes, and the device
// sits at "Last sync: Never" while each individual request plainly works. What
// a partial pass must never do is claim more than it did — lastSyncAt advances
// only when nothing failed, and the manifest only ever names uploads that
// actually landed.
//
// Timers: an initial pass on start, a periodic tick every TICK_MS that runs a
// pass when local files changed or PULL_INTERVAL_MS has elapsed since the last
// pull, and an on-demand syncNow(). All three funnel through runPass(), so
// single-flight is the only concurrency rule.
//
// Everything the pass touches (backend, fs, books) is injected; the Tauri wiring
// lives in index.ts. reconcile() (reconcile.ts) is the pure decision core.

import { isRemoteGone, type Manifest, type SyncBackend } from "./backend";
import type { BookFs } from "./books";
import { hashBytes } from "./content";
import { cachedHash, reconcile, type Snapshot, type Upload } from "./reconcile";
import type { LocalFile, ScannedFile, SyncFs } from "./syncFs";

export const TICK_MS = 15_000;
export const PULL_INTERVAL_MS = 5 * 60_000;

// A run of failures this long means the link is down, not that one file is
// awkward. The rest of the pass would only spend its retry budget failing the
// same way, so it is left for the next pass.
export const MAX_CONSECUTIVE_FAILURES = 3;

// Cap on the failure text kept for the UI: it is shown on one line in Settings,
// and Drive's error bodies run long.
const MESSAGE_LIMIT = 160;

export interface EngineDeps {
  backend: SyncBackend;
  fs: SyncFs;
  books: BookFs;
  snapshot: Snapshot;
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

// Distinguishes a dead-auth failure from an ordinary (offline) one. The auth
// module throws GoogleAuthError; the engine takes no direct dependency on it, so
// this is matched structurally by the thrown error's name.
function isAuthError(e: unknown): boolean {
  return e instanceof Error && e.name === "GoogleAuthError";
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

  private async runPass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emitStatus();
    const failures = new PassFailures();
    try {
      // The layout and the manifest are what the rest of the pass stands on:
      // without them there is nothing to reconcile, so these two still stop it.
      await this.d.backend.ensureLayout();
      const remote = await this.d.backend.listManifest();
      const local = await this.hashLocal(await this.d.fs.list());
      const plan = reconcile(local, remote, this.snapshot);

      // No bytes move for these: the snapshot is only catching up on what it
      // needs to skip the file cheaply next pass.
      for (const cv of plan.converged) {
        this.snapshot[cv.path] = {
          rev: cv.rev,
          mtime: cv.mtime,
          size: cv.size,
          hash: cv.hash,
        };
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
          changed.push(dl.path);
          failures.succeeded();
        } catch (e) {
          if (isAuthError(e)) throw e;
          // Listed in the manifest, absent from the remote. Nothing to pull and
          // nothing a retry can do; deletions are not propagated (docs/13), so
          // the local copy stays as it is.
          if (isRemoteGone(e)) continue;
          failures.record(`download ${dl.path}`, e);
        }
      }

      const landed: Upload[] = [];
      for (const up of plan.uploads) {
        if (failures.halted()) break;
        try {
          const bytes = await this.d.fs.read(up.path);
          await this.d.backend.upload(up.path, bytes, up.mtime);
          landed.push(up);
          failures.succeeded();
        } catch (e) {
          if (isAuthError(e)) throw e;
          failures.record(`upload ${up.path}`, e);
        }
      }

      if (landed.length > 0) {
        // Only what actually landed. A rev published for a file whose bytes
        // never arrived tells every other device it is up to date with content
        // that does not exist, and the writer's own copy stops being offered.
        const next: Manifest = { ...remote };
        for (const up of landed) {
          next[up.path] = { rev: up.rev, mtime: up.mtime, size: up.size, hash: up.hash };
        }
        try {
          await this.d.backend.writeManifest(next);
          // Snapshotted only now: bytes in Drive that the manifest does not name
          // are invisible to every other device, so an unpublished upload has to
          // look unsent and be repeated next pass.
          for (const up of landed) {
            this.snapshot[up.path] = {
              rev: up.rev,
              mtime: up.mtime,
              size: up.size,
              hash: up.hash,
            };
          }
          failures.succeeded();
        } catch (e) {
          if (isAuthError(e)) throw e;
          failures.record("write manifest", e);
        }
      }

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
      if (isAuthError(e)) this.d.onSignedOut?.();
    } finally {
      this.running = false;
      this.emitStatus();
    }
  }

  private async syncBooks(failures: PassFailures): Promise<void> {
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
        if (isAuthError(e)) throw e;
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
