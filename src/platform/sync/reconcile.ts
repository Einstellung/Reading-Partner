// The pure heart of the sync engine: given the local files, the remote
// manifest, and the snapshot of the last sync, decide what to upload and what to
// download. No IO — unit-tested directly (tests/sync/reconcile.test.ts).
//
// A file is "locally changed" if its mtime or size differs from the snapshot
// (or it is new). It is "remotely changed" if the manifest rev is ahead of the
// snapshot. When both changed, last-writer-wins by mtime (docs/13): the newer
// mtime keeps its side. Deletions are not propagated in v1 — a file missing
// locally but present remotely is left alone, so nothing is ever destroyed by a
// sync.

import type { Manifest, ManifestEntry } from "./backend";
import type { LocalFile } from "./syncFs";

export type SnapshotEntry = ManifestEntry;
export type Snapshot = Record<string, SnapshotEntry>;

export interface Upload {
  path: string;
  rev: number;
  mtime: number;
  size: number;
}

export interface Download {
  path: string;
  rev: number;
  size: number;
}

export interface Plan {
  uploads: Upload[];
  downloads: Download[];
  // The manifest to write after the uploads land (downloads leave their entries
  // untouched). Equal to the remote manifest when there is nothing to upload.
  nextManifest: Manifest;
}

export function reconcile(local: LocalFile[], remote: Manifest, snap: Snapshot): Plan {
  const localByPath = new Map(local.map((f) => [f.path, f]));
  const paths = new Set<string>([
    ...localByPath.keys(),
    ...Object.keys(remote),
    ...Object.keys(snap),
  ]);

  const uploads: Upload[] = [];
  const downloads: Download[] = [];
  const nextManifest: Manifest = { ...remote };

  for (const path of paths) {
    const loc = localByPath.get(path);
    const rem = remote[path];
    const base = snap[path];

    const localChanged = !!loc && (!base || loc.mtime !== base.mtime || loc.size !== base.size);
    const remoteChanged = !!rem && (!base || rem.rev > base.rev);

    const upload = (): void => {
      if (!loc) return;
      const rev = (rem?.rev ?? base?.rev ?? 0) + 1;
      uploads.push({ path, rev, mtime: loc.mtime, size: loc.size });
      nextManifest[path] = { rev, mtime: loc.mtime, size: loc.size };
    };
    const download = (): void => {
      if (!rem) return;
      downloads.push({ path, rev: rem.rev, size: rem.size });
    };

    if (localChanged && remoteChanged) {
      // Conflict: the newer writer wins. Ties go to the local copy (it is
      // already on disk, so keeping it avoids a needless download).
      if (loc!.mtime >= rem!.mtime) upload();
      else download();
    } else if (localChanged) {
      upload();
    } else if (remoteChanged) {
      download();
    }
    // else: in sync, or only-local-with-no-change, or a remote/snapshot-only
    // entry with no local file (deletion — left as-is).
  }

  return { uploads, downloads, nextManifest };
}
