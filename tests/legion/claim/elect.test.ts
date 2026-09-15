// Which machine runs a kind (src/legion/claim, docs/55). Every device runs the
// same election over the same files and has to reach the same answer, so these
// are pure functions of the claims and the clock. Run: bun test.
//
// The first half is info's collector election (docs/36) moved here whole: the
// rules about uptime, ties, forfeiting and standing down did not change when
// the claim stopped being about collecting. The second half is what capabilities
// added.

import { expect, test } from "bun:test";
import {
  CLAIM_SYNC_GRACE_MS,
  FORFEIT_MS,
  electFor,
  isElectedFor,
  mayClaim,
  registerKindCapabilities,
  type DeviceClaim,
} from "../../../src/legion/claim";

const NOW = 1_800_000_000_000;

// Nothing this machine has to be able to do: the kind every device with a claim
// is a candidate for.
const ANY = "test-any";
// And one that asks for a machine feature.
const NEEDS_WEBVIEW = "test-needs-webview";

function claim(deviceId: string, over: Partial<DeviceClaim> = {}): DeviceClaim {
  return {
    deviceId,
    deviceName: deviceId,
    platform: "linux",
    claimedAt: NOW - 60_000,
    heartbeatAt: NOW,
    capabilities: [],
    ...over,
  };
}

// Registered once, at import, and never cleared: the registry is one map for
// the process, and a test file that emptied it would take the kinds another
// file's module registered with it (tests/... order independence).
registerKindCapabilities(ANY, []);
registerKindCapabilities(NEEDS_WEBVIEW, ["webview-fetch"]);

test("nobody claiming means nobody runs it", () => {
  expect(electFor(ANY, [], NOW)).toBeNull();
});

test("the machine that has been claiming longest runs it", () => {
  const old = claim("desk", { claimedAt: NOW - 86_400_000 });
  const fresh = claim("laptop", { claimedAt: NOW - 1_000 });
  expect(electFor(ANY, [fresh, old], NOW)).toBe("desk");
  expect(isElectedFor(ANY, [fresh, old], "laptop", NOW)).toBe(false);
});

test("a tie is broken the same way on both machines", () => {
  const a = claim("aaa", { claimedAt: NOW - 1_000 });
  const b = claim("bbb", { claimedAt: NOW - 1_000 });
  expect(electFor(ANY, [a, b], NOW)).toBe("aaa");
  expect(electFor(ANY, [b, a], NOW)).toBe("aaa");
});

test("a machine that is not a candidate is out at once", () => {
  const off = claim("desk", { claimedAt: null });
  const other = claim("laptop", { claimedAt: NOW - 1_000 });
  expect(electFor(ANY, [off, other], NOW)).toBe("laptop");
  expect(electFor(ANY, [off], NOW)).toBeNull();
});

test("a claim goes on holding through a quiet night and forfeits after a day", () => {
  const asleep = claim("desk", {
    claimedAt: NOW - 86_400_000,
    heartbeatAt: NOW - 3 * 60 * 60_000,
  });
  const awake = claim("laptop", { claimedAt: NOW - 1_000 });
  expect(electFor(ANY, [asleep, awake], NOW)).toBe("desk");
  const dead = { ...asleep, heartbeatAt: NOW - FORFEIT_MS - 60_000 };
  expect(electFor(ANY, [dead, awake], NOW)).toBe("laptop");
});

// --- capabilities ------------------------------------------------------------

test("with both machines able to run it, the longest claiming one does", () => {
  const old = claim("desk", { claimedAt: NOW - 86_400_000, capabilities: ["webview-fetch"] });
  const fresh = claim("laptop", { claimedAt: NOW - 1_000, capabilities: ["webview-fetch"] });
  expect(electFor(NEEDS_WEBVIEW, [fresh, old], NOW)).toBe("desk");
});

test("with no machine able to run it, nobody does", () => {
  const a = claim("phone", { claimedAt: NOW - 86_400_000 });
  const b = claim("tablet", { claimedAt: NOW - 1_000 });
  expect(electFor(NEEDS_WEBVIEW, [a, b], NOW)).toBeNull();
  // And the same two machines are still candidates for work that asks for
  // nothing: a device is not out of the election, it is out of this one.
  expect(electFor(ANY, [a, b], NOW)).toBe("phone");
});

// Uptime decides between machines that can do the work. It does not promote one
// that cannot.
test("the machine that can run it wins however late it came up", () => {
  const long = claim("phone", { claimedAt: NOW - 86_400_000 });
  const late = claim("desk", { claimedAt: NOW - 1_000, capabilities: ["webview-fetch"] });
  expect(electFor(NEEDS_WEBVIEW, [long, late], NOW)).toBe("desk");
});

test("a machine needs every capability the kind asked for, not one of them", () => {
  registerKindCapabilities("test-needs-two", ["webview-fetch", "always-on"]);
  const half = claim("desk", { capabilities: ["webview-fetch"] });
  const whole = claim("server", { capabilities: ["always-on", "webview-fetch"] });
  expect(electFor("test-needs-two", [half], NOW)).toBeNull();
  expect(electFor("test-needs-two", [half, whole], NOW)).toBe("server");
});

// legion only knows the kinds a domain declared. Answering "any of them" for a
// kind nobody registered would put work on a machine that never said it could
// take it.
test("a kind nobody registered has no machine to run it", () => {
  expect(electFor("test-unregistered", [claim("desk")], NOW)).toBeNull();
});

// --- claiming ---------------------------------------------------------------

test("a machine with no account claims straight away", () => {
  expect(mayClaim({ syncing: false, pulledAt: null, startedAt: NOW, now: NOW })).toBe(true);
});

test("a synced machine waits for its first pull", () => {
  expect(mayClaim({ syncing: true, pulledAt: null, startedAt: NOW, now: NOW + 60_000 })).toBe(false);
  expect(mayClaim({ syncing: true, pulledAt: NOW + 30_000, startedAt: NOW, now: NOW + 60_000 })).toBe(
    true,
  );
});

// A machine that never works because it is waiting for a file it will never
// receive is worse than two machines working.
test("a pull that never lands stops holding it back after the grace period", () => {
  const now = NOW + CLAIM_SYNC_GRACE_MS;
  expect(mayClaim({ syncing: true, pulledAt: null, startedAt: NOW, now })).toBe(true);
});
