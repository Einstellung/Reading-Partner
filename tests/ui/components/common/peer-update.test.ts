// The lagging-desktop notice: its sentence, the per-version dismissal and when
// the peer trees are read again (src/ui/components/common/peer-update.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import type { LaggingDesktop } from "../../../../src/platform/sync/peer-versions";
import {
  dismissPeerUpdate,
  peerUpdateText,
  pickPeerUpdate,
  PEER_REREAD_MS,
  shouldRereadPeers,
} from "../../../../src/ui/components/common/peer-update";
import type { PrefStore } from "../../../../src/ui/components/base/pref-store";

function memStore(): PrefStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const mac: LaggingDesktop = { device: "d-mac", platform: "macos", version: "0.19.2", target: "0.20.1" };
const pc: LaggingDesktop = { device: "d-pc", platform: "windows", version: "0.18.0", target: "0.20.1" };

test("the sentence names the machine, its version and the target", () => {
  expect(peerUpdateText(mac)).toBe(
    "Your Mac is on 0.19.2. Open Reading Partner there to update to 0.20.1.",
  );
  expect(peerUpdateText(pc)).toContain("Your Windows PC is on 0.18.0");
  expect(peerUpdateText({ ...mac, platform: "linux" })).toContain("Your Linux computer");
});

test("a dismissal hides that device until a newer target", () => {
  const store = memStore();
  expect(pickPeerUpdate([mac, pc], store)).toBe(mac);
  dismissPeerUpdate(store, mac);
  expect(pickPeerUpdate([mac, pc], store)).toBe(pc);
  dismissPeerUpdate(store, pc);
  expect(pickPeerUpdate([mac, pc], store)).toBeNull();
  // The next release asks again, even though the Mac is on the same build.
  expect(pickPeerUpdate([{ ...mac, target: "0.20.2" }], store)).toEqual({ ...mac, target: "0.20.2" });
});

test("no storage, or storage that throws, still shows the notice", () => {
  expect(pickPeerUpdate([mac], null)).toBe(mac);
  const broken: PrefStore = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(pickPeerUpdate([mac], broken)).toBe(mac);
  expect(() => dismissPeerUpdate(broken, mac)).not.toThrow();
});

test("the first pass after mount rereads, later ones at most every ten minutes", () => {
  const mountedAt = 1_000_000;
  const fresh = { mountedAt, readAfterSync: null, lastReadAt: mountedAt };
  // The previous session's pass, restored from disk: the mount read covered it.
  expect(shouldRereadPeers(fresh, mountedAt - 5, mountedAt + 1)).toBe(false);
  expect(shouldRereadPeers(fresh, null, mountedAt + 1)).toBe(false);
  expect(shouldRereadPeers(fresh, mountedAt + 10, mountedAt + 10)).toBe(true);

  const after = { mountedAt, readAfterSync: mountedAt + 10, lastReadAt: mountedAt + 10 };
  expect(shouldRereadPeers(after, mountedAt + 10, mountedAt + PEER_REREAD_MS * 2)).toBe(false);
  expect(shouldRereadPeers(after, mountedAt + 20, mountedAt + 20)).toBe(false);
  expect(shouldRereadPeers(after, mountedAt + 20, mountedAt + 10 + PEER_REREAD_MS)).toBe(true);
});
