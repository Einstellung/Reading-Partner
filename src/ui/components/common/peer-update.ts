// The notice a phone or iPad shows when a desktop is on an older build
// (platform/sync/peer-versions.ts decides which): its sentence, which one to
// show, and the dismissal.
//
// A dismissal is remembered per device and per version it asked for, in
// localStorage: it is this device's view choice, and a newer release asks
// again.

import type { LaggingDesktop } from "../../../platform/sync";
import type { PrefStore } from "../base/pref-store";

const DISMISS_PREFIX = "shell.peerUpdateDismissed.";

const DESKTOP_NAMES: Record<string, string> = {
  macos: "Mac",
  windows: "Windows PC",
  linux: "Linux computer",
};

export function peerUpdateText(l: LaggingDesktop): string {
  const name = DESKTOP_NAMES[l.platform] ?? "computer";
  return `Your ${name} is on ${l.version}. Open Reading Partner there to update to ${l.target}.`;
}

function dismissedTarget(store: PrefStore | null, device: string): string | null {
  try {
    return store?.getItem(DISMISS_PREFIX + device) ?? null;
  } catch {
    return null;
  }
}

/** The one notice to show: the first lagging desktop not dismissed for the
 * version it is behind, or null. */
export function pickPeerUpdate(
  lagging: readonly LaggingDesktop[],
  store: PrefStore | null,
): LaggingDesktop | null {
  return lagging.find((l) => dismissedTarget(store, l.device) !== l.target) ?? null;
}

export function dismissPeerUpdate(store: PrefStore | null, l: LaggingDesktop): void {
  try {
    store?.setItem(DISMISS_PREFIX + l.device, l.target);
  } catch {
    // Full or disabled storage: the notice is gone for this session anyway.
  }
}

// How often a finished sync pass may trigger another read of the cached peer
// trees. The first pass after mount always does: that is the one that fetched
// whatever changed while the app was closed.
export const PEER_REREAD_MS = 10 * 60_000;

export interface PeerReadState {
  // When the notice mounted and read the cache for the first time. A lastSyncAt
  // older than this is the previous session's, restored from disk, and says
  // nothing the mount read did not already see.
  mountedAt: number;
  // The lastSyncAt the last read followed, null for the mount read.
  readAfterSync: number | null;
  lastReadAt: number;
}

export function shouldRereadPeers(state: PeerReadState, lastSyncAt: number | null, now: number): boolean {
  if (lastSyncAt === null || lastSyncAt < state.mountedAt) return false;
  if (lastSyncAt === state.readAfterSync) return false;
  if (state.readAfterSync === null) return true;
  return now - state.lastReadAt >= PEER_REREAD_MS;
}
