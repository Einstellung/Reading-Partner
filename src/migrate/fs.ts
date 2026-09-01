// The filesystem the steps run against, and the one difference between a dry
// run and a real one.
//
// A dry run and a real run execute the same step code over the same overlay;
// only `writeThrough` differs. That is deliberate — a dry run whose report came
// from a separate code path would be a report about a different program. The
// overlay also lets step 4 read what step 3 wrote on a dry run, so the report
// describes the finished state rather than the first step's.

import type { MigrationFs } from "./types";

export class OverlayFs implements MigrationFs {
  // path -> content, or null for "removed". Everything this run has changed.
  private overlay = new Map<string, string | null>();
  readonly written: string[] = [];
  readonly removed: string[] = [];

  constructor(
    private base: MigrationFs,
    // False on a dry run: the base filesystem is never touched at all, not even
    // opened for writing.
    private writeThrough: boolean,
  ) {}

  async read(path: string): Promise<string | null> {
    if (this.overlay.has(path)) return this.overlay.get(path) ?? null;
    return this.base.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    // A write of bytes the file already holds is not a change. Steps are
    // written to be idempotent, but this is the backstop that makes "running it
    // twice changes nothing" true of the report as well as of the disk.
    if ((await this.read(path)) === content) return;
    this.overlay.set(path, content);
    if (!this.written.includes(path)) this.written.push(path);
    if (this.writeThrough) await this.base.write(path, content);
  }

  async remove(path: string): Promise<void> {
    if ((await this.read(path)) === null) return;
    this.overlay.set(path, null);
    if (!this.removed.includes(path)) this.removed.push(path);
    if (this.writeThrough) await this.base.remove(path);
  }

  async listDir(dir: string): Promise<string[]> {
    const names = new Set(await this.base.listDir(dir));
    for (const [path, content] of this.overlay) {
      const at = path.lastIndexOf("/");
      if ((at < 0 ? "" : path.slice(0, at)) !== dir) continue;
      const name = path.slice(at + 1);
      if (content === null) names.delete(name);
      else names.add(name);
    }
    return [...names].sort();
  }

  async listSubdirs(dir: string): Promise<string[]> {
    // No step creates or removes a directory, so the base answer is the whole
    // answer. The backup directory is written by the runner, outside any step.
    return this.base.listSubdirs(dir);
  }

  // Every path this run changed, for the backup pass.
  touched(): string[] {
    return [...new Set([...this.written, ...this.removed])];
  }
}

// The observation store wants exactly the four operations MigrationFs already
// has; handed the overlay, ObservationFileStore.rebuildIndex writes through the
// same accounting as everything else.
export function asObservationFs(fs: MigrationFs): {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
} {
  return {
    read: (p) => fs.read(p),
    write: (p, c) => fs.write(p, c),
    remove: (p) => fs.remove(p),
    listDir: (p) => fs.listDir(p),
  };
}

// Where a real run copies what it is about to touch. Out of sync range by
// construction: inSyncRange (platform/sync/syncFs.ts) is an allowlist keyed on
// the top path segment — article-bodies, runs, memory-*, prep-* and a fixed set
// of root file names — so "migration-backups" matches nothing and neither does
// anything under it. worthDescending refuses to walk into it for the same
// reason, so a sync scan does not even see the files.
export const BACKUP_ROOT = "migration-backups";

export function backupDirFor(now: number): string {
  return `${BACKUP_ROOT}/${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
}
