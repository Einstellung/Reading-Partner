// Which paths another device deleted, read off two of its holdings (docs/59
// §3). The tree-level counterpart of the three-way content merge: base is the
// peer holdings this device last reasoned from, theirs is the one the peer
// publishes now, ours is the local tree and the snapshot.
//
//   base has P, now has not, local hash = base hash   -> deleted, purge it
//   base has P, now has not, local hash differs       -> the edit wins, contested
//   base has P, now has not, no local copy            -> nothing to do
//   no cached base                                    -> infer nothing
//
// The last line is where all of the safety is, and it is the same discipline as
// MergeInput.base being allowed to be null (merge/contract.ts): without a base
// there is no telling an addition from a deletion, so nothing is concluded. A
// device that has just upgraded, has never pulled this peer's holdings, or
// signed out and back in has no base, records what it sees, and starts
// inferring from the next pass's difference. That costs one pass of latency and
// buys the property that "I have never seen this" can never be read as "the
// other device deleted it".
//
// Nothing here reads a clock, a device name or a listing order: the difference
// of two trees is the whole input, so two devices reach the same conclusion.
//
// Pure: no IO. Unit-tested directly (tests/platform/sync/infer-deletions.test.ts).

import type { Holdings } from "./holdings";
import { NEVER_INFER_DELETE } from "./syncFs";

// Tier 2 of docs/59 §7, wired but not armed. Deleting on inference needs both
// devices to have been publishing holdings for a while — the base a difference
// is taken against is what the previous release accumulated — so the release
// that lands the publishing half must not also be the one that acts on it. The
// next release flips this to true.
export const HOLDINGS_INFER_DELETIONS = false;

export interface LocalTreeEntry {
  // The content hash of the file on this device right now.
  hash: string;
}

export interface InferInput {
  // The peer holdings this device last reasoned from, and the one it publishes
  // now. Either may be null: nothing cached yet, or this pass could not fetch.
  base: Holdings | null;
  current: Holdings | null;
  // Every in-range local file by path, with the hash the pass computed.
  local: ReadonlyMap<string, LocalTreeEntry>;
  // What the remote listing says about each path this pass, by content hash.
  // A path the listing has no hash for is simply not in here.
  remoteHashes: ReadonlyMap<string, string>;
}

export interface InferResult {
  // Paths to feed reconcile's dead() predicate, so they leave through
  // purgeDead: trash, local, remote, snapshot and base, in that order.
  deletions: string[];
  // A delete that met a local edit. The edit is kept and uploaded by the
  // ordinary reconcile path; this is only reported.
  contested: string[];
}

/**
 * What one peer's two holdings say this device should delete. Union the results
 * over the peers: a path only leaves when some peer says it did, and no peer
 * can vote for keeping another peer's deletion — a device that still holds it
 * republishes it on its own next edit, which is the pre-existing behaviour.
 */
export function inferDeletions(input: InferInput): InferResult {
  const deletions: string[] = [];
  const contested: string[] = [];
  const { base, current, local, remoteHashes } = input;

  // No base, no conclusion. An incomplete scan on either side is the same
  // situation: a partial tree's absences are not deletions (docs/59 §2), so it
  // is recorded and not read.
  if (!base || !current || !base.complete || !current.complete) {
    return { deletions, contested };
  }

  const retired = new Set(current.retired);

  for (const path of Object.keys(base.files).sort()) {
    if (path in current.files) continue;
    // A path the sync range gave up in this build, not a file the user
    // deleted. The peer says so explicitly; this device stops syncing it and
    // keeps its copy.
    if (retired.has(path)) continue;
    if (NEVER_INFER_DELETE.has(path)) continue;

    const mine = local.get(path);
    // Gone here too. The snapshot and the merge base are dropped by reconcile's
    // own dropBases; there is nothing for a purge to take.
    if (!mine) continue;

    const wasHash = base.files[path][0];

    // Drive lists eventually (docs/59 §8.2): a holdings can be older than the
    // files beside it. When the listing shows this path at content the peer's
    // base never described, this pass does not know whose content that is —
    // call the path unknown and leave it for a pass where the two agree.
    const listed = remoteHashes.get(path);
    if (listed !== undefined && listed !== wasHash) continue;

    // Delete against edit: the edit wins, the same way a record-level delete
    // loses to a record-level edit (merge/records.ts). The file stays and
    // reconcile uploads it, which is what puts it back in front of the device
    // that deleted it.
    if (mine.hash !== wasHash) {
      contested.push(path);
      continue;
    }

    deletions.push(path);
  }

  return { deletions, contested };
}
