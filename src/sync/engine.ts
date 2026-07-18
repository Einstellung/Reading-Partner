// The sync engine: one pass reconciles the data channel (pull remote-newer
// files, push local changes, last-writer-wins on conflict) then the books
// channel (upload local-only book blobs, download remote-only ones). A single
// pass runs at a time; overlapping triggers are dropped, and a failure (offline)
// is kept as lastError for the UI and retried on the next tick.
//
// Timers: an initial pass on start, a periodic tick every TICK_MS that runs a
// pass when local files changed or PULL_INTERVAL_MS has elapsed since the last
// pull, and an on-demand syncNow(). All three funnel through runPass(), so
// single-flight is the only concurrency rule.
//
// Everything the pass touches (backend, fs, books) is injected; the Tauri wiring
// lives in index.ts. reconcile() (reconcile.ts) is the pure decision core.

import type { SyncBackend } from "./backend";
import type { BookFs } from "./books";
import { reconcile, type Snapshot } from "./reconcile";
import type { LocalFile, SyncFs } from "./syncFs";

export const TICK_MS = 15_000;
export const PULL_INTERVAL_MS = 5 * 60_000;

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

  private async hasLocalChange(): Promise<boolean> {
    let local: LocalFile[];
    try {
      local = await this.d.fs.list();
    } catch {
      return false;
    }
    const seen = new Set<string>();
    for (const f of local) {
      seen.add(f.path);
      const base = this.snapshot[f.path];
      if (!base || f.mtime !== base.mtime || f.size !== base.size) return true;
    }
    return false;
  }

  private emitStatus(): void {
    this.d.onStatus?.(this.status());
  }

  private async runPass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emitStatus();
    try {
      await this.d.backend.ensureLayout();
      const remote = await this.d.backend.listManifest();
      const local = await this.d.fs.list();
      const plan = reconcile(local, remote, this.snapshot);

      const changed: string[] = [];
      // Pull first so library.json is current before the books channel reads it.
      for (const dl of plan.downloads) {
        const bytes = await this.d.backend.download(dl.path);
        await this.d.fs.write(dl.path, bytes);
        const st = await this.d.fs.stat(dl.path);
        this.snapshot[dl.path] = { rev: dl.rev, mtime: st?.mtime ?? 0, size: bytes.length };
        changed.push(dl.path);
      }
      for (const up of plan.uploads) {
        const bytes = await this.d.fs.read(up.path);
        await this.d.backend.upload(up.path, bytes, up.mtime);
        this.snapshot[up.path] = { rev: up.rev, mtime: up.mtime, size: up.size };
      }
      if (plan.uploads.length > 0) await this.d.backend.writeManifest(plan.nextManifest);

      await this.syncBooks();

      this.lastPullAt = this.now();
      this.lastSyncAt = this.now();
      this.lastError = null;
      if (changed.length > 0) this.d.onPulled?.(changed);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      if (isAuthError(e)) this.d.onSignedOut?.();
    } finally {
      this.running = false;
      this.emitStatus();
    }
  }

  private async syncBooks(): Promise<void> {
    const hashes = await this.d.books.listHashes();
    for (const hash of hashes) {
      const [localHas, remoteHas] = await Promise.all([
        this.d.books.has(hash),
        this.d.backend.hasBook(hash),
      ]);
      if (localHas && !remoteHas) {
        await this.d.backend.uploadBook(hash, await this.d.books.read(hash));
      } else if (!localHas && remoteHas) {
        await this.d.books.write(hash, await this.d.backend.downloadBook(hash));
      }
    }
  }

  // Exposed for persistence: the current snapshot to write into sync-state.json.
  currentSnapshot(): Snapshot {
    return this.snapshot;
  }
}
