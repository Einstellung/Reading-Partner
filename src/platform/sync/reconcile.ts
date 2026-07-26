// The pure heart of the sync engine: given the local files, the remote state,
// and the snapshot of the last sync, decide what to upload and what to
// download. No IO — unit-tested directly (tests/platform/sync/reconcile.test.ts).
//
// A file is "locally changed" when its content hash differs from the snapshot's
// (or it is new). Not when its mtime moved: the app rewrites files with content
// identical to what is already there, and under mtime that read as an edit and
// won a whole-file conflict, wiping the other device's annotations. It is
// "remotely changed" when the remote rev is ahead of the snapshot.
//
// When both changed since the base, neither side wins: the file goes into
// `merges` and the engine merges the three contents the way git does. A whole
// file is the wrong unit to pick a winner at when the file is a collection of
// records — one device's annotations are not an alternative to the other's.
//
// File-level deletions are still not propagated — a file missing locally but
// present remotely is left alone, so nothing is ever destroyed by a sync.
// Record-level deletion inside a file is the merge module's decision.

import type { Manifest, ManifestEntry } from "./backend";
import type { LocalFile } from "./syncFs";

export type SnapshotEntry = ManifestEntry;
export type Snapshot = Record<string, SnapshotEntry>;

export interface Upload {
  path: string;
  rev: number;
  mtime: number;
  size: number;
  hash: string;
}

export interface Download {
  path: string;
  rev: number;
  size: number;
}

// Both sides changed this file since the base. The engine fetches the remote
// content, merges it with the local one over the base, and publishes the result
// at `rev` — above what the remote holds, so the merge is what every device
// converges on rather than one more side of the argument.
export interface Merge {
  path: string;
  rev: number;
}

// Nothing needs to move for this file, and the snapshot does not say so yet:
// both sides already hold the same bytes, or the file was rewritten with the
// content already in it and only its mtime moved. Recording it is what stops
// the pass from re-deciding the same file every fifteen seconds forever.
export interface Converged {
  path: string;
  rev: number;
  mtime: number;
  size: number;
  hash: string;
}

// What to move. Not what to publish: the manifest is composed by the engine
// from the remote it read plus the uploads that actually landed, because only
// the engine knows which of them did.
export interface Plan {
  uploads: Upload[];
  downloads: Download[];
  merges: Merge[];
  converged: Converged[];
  // Paths gone from both sides. Their merge base is what is left of a file
  // nothing holds any more, so it is dropped (localStore.ts).
  dropBases: string[];
}

// The snapshot's hash for a scanned file, when it can be trusted without
// reading it: mtime and size unchanged means the bytes are the ones the last
// sync agreed on. Exported for the engine, which uses it to decide what to
// hash — the 15s tick must not read every file.
export function cachedHash(snap: SnapshotEntry | undefined, f: { mtime: number; size: number }): string | null {
  if (!snap || snap.hash === undefined) return null;
  if (snap.mtime !== f.mtime || snap.size !== f.size) return null;
  return snap.hash;
}

function isLocallyChanged(loc: LocalFile, snap: SnapshotEntry | undefined): boolean {
  if (!snap) return true;
  // A snapshot written before content hashing has none. Until the pass fills it
  // in, fall back to the old mtime/size comparison: calling every file changed
  // would re-push the whole data set over the remote on the first pass after
  // the upgrade.
  if (snap.hash === undefined) return loc.mtime !== snap.mtime || loc.size !== snap.size;
  return loc.hash !== snap.hash;
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
  const merges: Merge[] = [];
  const converged: Converged[] = [];
  const dropBases: string[] = [];

  for (const path of paths) {
    const loc = localByPath.get(path);
    const rem = remote[path];
    const base = snap[path];

    const remoteChanged = !!rem && (!base || rem.rev > base.rev);

    // No local file: a remote/snapshot-only entry. Pull it if it moved; never
    // delete anything (docs/13).
    if (!loc) {
      if (remoteChanged) downloads.push({ path, rev: rem!.rev, size: rem!.size });
      else if (!rem) dropBases.push(path);
      continue;
    }

    // Say the snapshot already holds exactly this, or record that it should.
    const note = (rev: number): void => {
      if (
        base &&
        base.rev === rev &&
        base.hash === loc.hash &&
        base.mtime === loc.mtime &&
        base.size === loc.size
      ) {
        return;
      }
      converged.push({ path, rev, mtime: loc.mtime, size: loc.size, hash: loc.hash });
    };

    // Identical content on both sides. Checked before anything else: two
    // devices that made the same edit, or one that re-saved a file byte for
    // byte, have nothing to exchange and must not be handed to a conflict rule.
    if (rem?.hash !== undefined && rem.hash === loc.hash) {
      note(rem.rev);
      continue;
    }

    const localChanged = isLocallyChanged(loc, base);

    const upload = (): void => {
      const rev = (rem?.rev ?? base?.rev ?? 0) + 1;
      uploads.push({ path, rev, mtime: loc.mtime, size: loc.size, hash: loc.hash });
    };

    if (localChanged && remoteChanged) {
      // Both sides moved. Merge them; do not pick one.
      merges.push({ path, rev: rem!.rev + 1 });
    } else if (localChanged) {
      upload();
    } else if (remoteChanged) {
      downloads.push({ path, rev: rem!.rev, size: rem!.size });
    } else {
      // In sync. The snapshot may still be behind on what it needs to skip the
      // file cheaply next time: the hash of a file synced before hashing
      // existed, or the mtime of a rewrite that changed nothing.
      note(base!.rev);
    }
  }

  return { uploads, downloads, merges, converged, dropBases };
}
