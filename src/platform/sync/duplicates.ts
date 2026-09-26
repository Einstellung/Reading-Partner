// Folding a name's duplicate copies back into one (backend.ts, RemoteDuplicate).
//
// The listing already chose one copy per name, the same one on every device, so
// nothing disagrees about which content a name holds. What is left is the other
// copies' content: each could hold writes the chosen one never saw, so it is
// merged into the chosen copy with no base — which the merge contract answers
// by keeping both sides — the result is published above every rev in play, and
// only then are the extras deleted. The local file is not touched here; the
// bumped rev is what brings the merged content down through the ordinary plan.
//
// An extra that has gone by the time it is fetched stops the whole name: the
// device that deleted it had merged it first, and publishing the chosen copy
// without it would overwrite that merge with less.

import {
  isAuthFailure,
  isRemoteGone,
  type RemoteState,
  type SyncBackend,
} from "./backend";
import { hashBytes } from "./content";
import type { TrashJournal } from "./localStore";
import type { MergeFile } from "./merge/contract";
import type { PassFailures } from "./pass-failures";
import type { Snapshot } from "./reconcile";

export interface AbsorbDeps {
  backend: SyncBackend;
  merge: MergeFile;
  snapshot: Snapshot;
  trash: TrashJournal;
  // Where a merge's conflict copies go, as in any other merge: beside the file,
  // on this device, to be uploaded by the plan like any new file.
  writeLocal: (path: string, bytes: Uint8Array) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  now: () => number;
}

// Runs before the local scan, so a conflict copy written here is scanned and
// uploaded by the same pass. `remote` is updated in place to what was published.
export async function absorbDuplicates(
  d: AbsorbDeps,
  remote: RemoteState,
  failures: PassFailures,
): Promise<void> {
  const { backend } = d;
  if (!backend.listedDuplicates || !backend.downloadExtra || !backend.removeExtra) return;
  for (const dup of backend.listedDuplicates()) {
    const chosen = remote[dup.name];
    if (!chosen) continue;
    if (failures.halted()) return;
    try {
      let merged = await backend.download(dup.name);
      for (const handle of dup.extras) {
        const extra = await backend.downloadExtra(handle);
        const out = d.merge({ path: dup.name, base: null, local: merged, remote: extra });
        for (const copy of out.copies) {
          if (await d.exists(copy.path)) continue;
          await d.writeLocal(copy.path, copy.bytes);
        }
        if (out.dropped.length > 0) {
          await d.trash.append(
            out.dropped.map((r) => ({ at: d.now(), path: dup.name, id: r.id, record: r.record })),
          );
        }
        merged = out.merged;
      }
      const published = {
        rev: Math.max(chosen.rev, d.snapshot[dup.name]?.rev ?? 0) + 1,
        // The chosen copy's, so two devices absorbing at once publish the same
        // metadata as well as the same bytes.
        mtime: chosen.mtime,
        hash: await hashBytes(merged),
      };
      await backend.upload(dup.name, merged, published);
      remote[dup.name] = { ...published, size: merged.length };
      for (const handle of dup.extras) await backend.removeExtra(handle);
      failures.succeeded();
    } catch (e) {
      if (isAuthFailure(e)) throw e;
      if (isRemoteGone(e)) continue;
      failures.record(`deduplicate ${dup.name}`, e);
    }
  }
}
