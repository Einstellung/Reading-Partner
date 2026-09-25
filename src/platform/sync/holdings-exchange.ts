// Holdings exchange (docs/59): what this device publishes about the files it
// holds, the peer trees it fetches, and the deletions it infers from the
// difference between two of a peer's trees. One pass of the sync engine
// (engine.ts) calls it in three places — pull before the plan, advance after
// the purges, publish at the end of the data channel — and every deletion it
// infers still executes through the engine's purgeDead.

import { isAuthFailure, isRemoteGone, type RemoteState, type SyncBackend } from "./backend";
import { hashBytes } from "./content";
import {
  buildHoldings,
  emptyHoldingsPass,
  holdingsRemoteName,
  isDeviceId,
  parseHoldings,
  renderHoldingsPass,
  sameFiles,
  serializeHoldings,
  summariseHoldingsPass,
  SELF_KEY,
  type Holdings,
  type HoldingsFiles,
  type HoldingsPass,
  type HoldingsStore,
} from "./holdings";
import { inferDeletions } from "./infer-deletions";
import type { PassFailures } from "./pass-failures";
import { inSyncRange, type LocalFile } from "./syncFs";

// A peer's tree this pass fetched, waiting to become the base of the next
// difference (docs/59 §8.4). It may not become one until the deletions its own
// difference produced have actually left this device: a cache advanced over a
// purge that failed differences the peer's tree against itself next pass, and
// the path is never named again.
export interface PeerAdvance {
  device: string;
  bytes: Uint8Array;
  // The rev the listing gave this copy, for peerHoldingsRev.
  rev: number;
  // The paths this peer's difference put in front of purgeDead. Contested paths
  // are not here: nothing was asked of the purge for them, so nothing about
  // them can hold the cache back.
  deletions: string[];
}

export interface HoldingsExchangeDeps {
  backend: SyncBackend;
  // Where the published and the cached peer trees live (holdings.ts). Left out,
  // the exchange neither publishes nor infers.
  store?: HoldingsStore;
  // See EngineDeps.deviceId and EngineDeps.appVersion (engine.ts).
  deviceId?: () => string;
  appVersion?: () => string;
  now: () => number;
}

export class HoldingsExchange {
  private readonly d: HoldingsExchangeDeps;
  private readonly now: () => number;
  // The rev each cached peer holdings was fetched at, so a pass that finds the
  // same rev in the listing fetches nothing (holdings.ts). In memory: it is a
  // request saved, not a fact anything depends on.
  private readonly peerHoldingsRev = new Map<string, number>();
  // What the last pass did with holdings, for holdingsReport().
  private lastHoldings: HoldingsPass = emptyHoldingsPass();

  constructor(deps: HoldingsExchangeDeps) {
    this.d = deps;
    this.now = deps.now;
  }

  // This device's id, or "" when it has none to publish under yet.
  private device(): string {
    const id = this.d.deviceId?.() ?? "";
    return isDeviceId(id) ? id : "";
  }

  private holdingsStore(): HoldingsStore | null {
    return this.device() === "" ? null : (this.d.store ?? null);
  }

  // What this device holds, as this pass scanned it. The paths are exactly the
  // ones inSyncRange admits — the fs is free to hand over more, and a tree that
  // claimed files the other device is not even supposed to have would be a tree
  // whose absences mean nothing.
  //
  // complete is true because there is no other way to get here: a pass whose
  // fs.list() threw ended before this. The field is for the peers that will
  // one day publish a partial scan, and for the reader of the file.
  private selfHoldings(local: LocalFile[]): Holdings {
    const files: HoldingsFiles = {};
    for (const f of local) if (inSyncRange(f.path)) files[f.path] = [f.hash, f.size];
    return buildHoldings({ device: this.device(), at: this.now(), app: this.d.appVersion?.(), files });
  }

  // Fetch every peer holdings whose rev moved, and work out what they say this
  // device should delete. The order is the whole of the safety: the cached copy
  // is read (that is the base), the current one is fetched, the difference is
  // taken, and the cache is not advanced here at all. Advancing it before the
  // difference would erase the base; advancing it before the purge ran would
  // erase it just as surely a moment later, so the fetched copy is handed back
  // and advancePeerHoldings decides after the executing half of the pass.
  async pullPeerHoldings(
    pass: HoldingsPass,
    local: LocalFile[],
    remote: RemoteState,
    failures: PassFailures,
  ): Promise<{ inferred: Set<string>; advances: PeerAdvance[] }> {
    const inferred = new Set<string>();
    const advances: PeerAdvance[] = [];
    const store = this.holdingsStore();
    const listed = this.d.backend.listedHoldings?.();
    if (!store || !listed) return { inferred, advances };
    const me = this.device();

    const localTree = new Map(local.map((f) => [f.path, { hash: f.hash }]));
    const remoteHashes = new Map<string, string>();
    for (const [path, e] of Object.entries(remote)) if (e.hash) remoteHashes.set(path, e.hash);

    for (const device of Object.keys(listed).sort()) {
      // My own copy, coming back from the remote. It says nothing I do not
      // already know, and differencing it against itself would let a device
      // infer deletions from its own past.
      if (device === me) continue;
      const cached = parseHoldings(await store.read(device));
      // The rev of what is cached is not in the file — a holdings answers "what
      // did this device hold", not "where is the remote" (holdings.ts) — so it
      // is remembered here. A restart costs one refetch per peer, which is one
      // request on the first pass of a process and nothing after.
      const knownRev = this.peerHoldingsRev.get(device);
      const fresh = cached !== null && knownRev !== undefined && knownRev >= listed[device].rev;

      let bytes: Uint8Array | null = null;
      if (!fresh) {
        try {
          bytes = await this.d.backend.download(holdingsRemoteName(device));
          failures.succeeded();
        } catch (e) {
          if (isAuthFailure(e)) throw e;
          // One peer's tree that will not fetch is not the pass. Without the
          // current copy there is no difference to take, so this peer is simply
          // not reasoned about until it fetches.
          if (!isRemoteGone(e)) failures.record(`holdings ${device}`, e);
          pass.peers.push({ device, cached, current: null });
          continue;
        }
      }
      const current = bytes === null ? cached : parseHoldings(bytes);
      pass.peers.push({ device, cached, current });

      let deletions: string[] = [];
      if (pass.enabled) {
        const out = inferDeletions({ base: cached, current, local: localTree, remoteHashes });
        deletions = out.deletions;
        for (const path of out.deletions) inferred.add(path);
        pass.contested.push(...out.contested);
      }

      if (bytes !== null) {
        advances.push({ device, bytes, rev: listed[device].rev, deletions });
        pass.fetched += 1;
      }
    }
    pass.inferred = [...inferred].sort();
    return { inferred, advances };
  }

  // Move each peer's cached tree up to the copy this pass read — but only for a
  // peer whose whole difference actually left this device. One purge that
  // failed holds that peer's cache where it is, so the next pass takes the same
  // difference, names the same paths, and does the same thing; an advance here
  // would leave the next pass differencing the peer's tree against itself, with
  // the file on this device and nothing left that could ever name it (docs/59
  // §8.4 promises one pass late, not forever).
  //
  // Deferred to after the purges rather than remembered as a list of pending
  // deletions: the difference is recomputable from two trees this device
  // already has, and a persisted list would be a second thing that has to stay
  // true across a crash.
  async advancePeerHoldings(
    advances: readonly PeerAdvance[],
    purged: ReadonlySet<string>,
  ): Promise<void> {
    const store = this.holdingsStore();
    if (!store) return;
    for (const a of advances) {
      if (!a.deletions.every((path) => purged.has(path))) continue;
      // The rev is claimed only for a copy that actually landed on disk.
      // Claiming it for a write that failed would leave this device
      // differencing against a base it no longer has and never fetching
      // again — safe, in that it infers nothing, and silent, which is worse.
      const stored = await store.write(a.device, a.bytes).then(
        () => true,
        () => false,
      );
      if (stored) this.peerHoldingsRev.set(a.device, a.rev);
    }
  }

  // Publish this device's tree, but only when it is not the tree (or the
  // build) already published: an idle pass must stay at one request (docs/59 §2), and
  // everything in the file that is not a path or a hash — `at` above all —
  // would make every pass an upload.
  //
  // Not gated on the pass being clean. What this says is what this device
  // holds, not that the remote agrees with it, and a device on a link where no
  // pass is ever wholly clean (docs/pitfall/52) would otherwise never tell the
  // others anything.
  async publishHoldings(
    pass: HoldingsPass,
    local: LocalFile[],
    failures: PassFailures,
  ): Promise<void> {
    const store = this.holdingsStore();
    if (!store) return;
    const mine = this.selfHoldings(local);
    pass.self = mine;
    const last = parseHoldings(await store.read(SELF_KEY));
    // A new build republishes once even over the same tree: the app field is
    // how a phone tells that this desktop is behind (peer-versions.ts), and an
    // update that left the tree alone would otherwise go on reading as the old
    // version.
    if (last && sameFiles(last.files, mine.files) && last.app === mine.app) return;

    const name = holdingsRemoteName(mine.device);
    const bytes = serializeHoldings(mine);
    const rev = (this.d.backend.listedHoldings?.()[mine.device]?.rev ?? 0) + 1;
    try {
      await this.d.backend.upload(name, bytes, {
        rev,
        mtime: mine.at,
        hash: await hashBytes(bytes),
      });
      failures.succeeded();
    } catch (e) {
      if (isAuthFailure(e)) throw e;
      failures.record(`publish ${name}`, e);
      return;
    }
    // Only after it landed: the local copy is what says "the others have seen
    // this tree", and claiming that for an upload that failed would skip the
    // republish the next pass owes.
    await store.write(SELF_KEY, bytes).catch(() => {});
    pass.published = true;
  }

  /** Everything this device knows about holdings after the last pass, as text:
   * my tree, each peer's, and what was inferred from them. The one thing that
   * makes a wrong deletion on two real devices attributable (docs/59 §7). */
  holdingsReport(): string {
    return renderHoldingsPass(this.lastHoldings);
  }

  // Keep what this pass did with holdings for holdingsReport().
  finishPass(holdings: HoldingsPass): void {
    this.lastHoldings = holdings;
    // A pass that neither published nor fetched a tree says nothing, which is
    // what a steady pass is. The line is the only record of an inferred
    // deletion outside the trash journal, so it is not conditional on a debug
    // flag nobody has turned on.
    if (holdings.published || holdings.inferred.length > 0 || holdings.fetched > 0) {
      console.info(summariseHoldingsPass(holdings));
    }
  }
}
