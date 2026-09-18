// The lagging-desktop notice's state (peer-update.ts): read on mount and after
// sync passes, on phone and tablet platforms only. A desktop is the machine
// being told about, never the one telling.

import { useCallback, useEffect, useState } from "react";
import { isMobilePlatform } from "../../../platform/app/platform";
import {
  laggingDesktopPeers,
  subscribeSyncStatus,
  type LaggingDesktop,
} from "../../../platform/sync";
import { browserPrefStore } from "../base/pref-store";
import {
  dismissPeerUpdate,
  pickPeerUpdate,
  shouldRereadPeers,
  type PeerReadState,
} from "./peer-update";

export function usePeerUpdateNotice(): {
  notice: LaggingDesktop | null;
  dismiss: () => void;
} {
  const [notice, setNotice] = useState<LaggingDesktop | null>(null);

  useEffect(() => {
    if (!isMobilePlatform()) return;
    let alive = true;
    const mountedAt = Date.now();
    const state: PeerReadState = { mountedAt, readAfterSync: null, lastReadAt: mountedAt };
    const read = () => {
      void laggingDesktopPeers()
        .then((lagging) => {
          if (alive) setNotice(pickPeerUpdate(lagging, browserPrefStore(window)));
        })
        .catch(() => {});
    };
    read();
    // Every pass that finishes may have fetched a newer peer tree.
    const unsubscribe = subscribeSyncStatus((s) => {
      const now = Date.now();
      if (!shouldRereadPeers(state, s.lastSyncAt, now)) return;
      state.readAfterSync = s.lastSyncAt;
      state.lastReadAt = now;
      read();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const dismiss = useCallback(() => {
    setNotice((current) => {
      if (current) dismissPeerUpdate(browserPrefStore(window), current);
      return null;
    });
  }, []);

  return { notice, dismiss };
}
