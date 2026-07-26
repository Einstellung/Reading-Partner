// What the user is told about sync (src/platform/sync/health.ts). Pure, so no
// mocks: every case is a state plus a clock. The table below is the whole
// contract — which states are faults, which are the user's own choice and must
// stay silent, and which fault is loud enough for a toast. Run: bun test.

import { expect, test } from "bun:test";
import {
  syncHealth,
  syncStartAction,
  SYNC_GRACE_MS,
  SYNC_STALE_MS,
  type SyncHealthInput,
} from "../../../src/platform/sync/health";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

// A healthy signed-in device with auto-sync on, started an hour ago and synced
// a minute ago. Every case below is this with a field or two changed.
function input(over: Partial<SyncHealthInput> = {}): SyncHealthInput {
  return {
    configured: true,
    signedIn: true,
    autoSync: true,
    engineStarted: true,
    lastSyncAt: NOW - MINUTE,
    lastError: null,
    startedAt: NOW - 60 * MINUTE,
    now: NOW,
    ...over,
  };
}

test("before initSync has run nothing is known and nothing is said", () => {
  expect(syncHealth(input({ startedAt: null, signedIn: false, autoSync: false }))).toEqual({
    health: "unknown",
    alert: "none",
    message: null,
  });
});

test("a build with no Google client is not a failure", () => {
  const r = syncHealth(input({ configured: false, signedIn: false, autoSync: false }));
  expect(r.health).toBe("not-configured");
  expect(r.alert).toBe("none");
  expect(r.message).toBeNull();
});

test("a build with no Google client stays quiet even with leftover sync state", () => {
  // An old install that later dropped the client id still has autoSync and a
  // lastSyncAt on disk. Nothing can be done about it, so nothing is said.
  const r = syncHealth(input({ configured: false, signedIn: false }));
  expect(r.health).toBe("not-configured");
  expect(r.alert).toBe("none");
});

test("a deliberate sign-out is silent: signOutOfGoogle clears lastSyncAt", () => {
  const r = syncHealth(input({ signedIn: false, lastSyncAt: null }));
  expect(r.health).toBe("signed-out");
  expect(r.alert).toBe("none");
  expect(r.message).toBeNull();
});

test("signed out with auto-sync off is silent whatever the history", () => {
  const r = syncHealth(input({ signedIn: false, autoSync: false }));
  expect(r.health).toBe("signed-out");
  expect(r.alert).toBe("none");
});

test("auto-sync turned off by the user is silent", () => {
  const r = syncHealth(input({ autoSync: false }));
  expect(r.health).toBe("auto-sync-off");
  expect(r.alert).toBe("none");
  expect(r.message).toBeNull();
});

// The reported outage: the credentials file was moved out from under a device
// that had been syncing. autoSync still reads true, no pass ever ran so
// lastError is null, and the app looked healthy for four days.
test("auto-sync on with no credentials after a successful history is an alert", () => {
  const fourDays = 4 * 24 * 60 * MINUTE;
  const r = syncHealth(
    input({
      signedIn: false,
      autoSync: true,
      engineStarted: false,
      lastSyncAt: NOW - fourDays,
      lastError: null,
      startedAt: NOW - MINUTE,
    }),
  );
  expect(r.health).toBe("credentials-missing");
  expect(r.alert).toBe("alert");
  expect(r.message).toContain("signed out of Google");
});

test("the credentials alert does not wait out the grace window", () => {
  // Nothing is running, so waiting proves nothing; it fires on the first
  // evaluation after startup.
  const r = syncHealth(
    input({ signedIn: false, engineStarted: false, lastSyncAt: NOW - MINUTE, startedAt: NOW }),
  );
  expect(r.health).toBe("credentials-missing");
  expect(r.alert).toBe("alert");
});

test("signed in with auto-sync on but no engine running is an alert", () => {
  const r = syncHealth(input({ engineStarted: false }));
  expect(r.health).toBe("engine-stopped");
  expect(r.alert).toBe("alert");
  expect(r.message).toContain("not running");
});

test("a first pass that has not finished yet is not a failure", () => {
  const r = syncHealth(input({ lastSyncAt: null, startedAt: NOW - MINUTE }));
  expect(r.health).toBe("pending");
  expect(r.alert).toBe("none");
});

test("a first pass that has not finished long after startup is stalled", () => {
  const r = syncHealth(input({ lastSyncAt: null, startedAt: NOW - SYNC_GRACE_MS - MINUTE }));
  expect(r.health).toBe("stalled");
  expect(r.alert).toBe("alert");
});

test("one failed pass with a recent success is a notice, not an alert", () => {
  const r = syncHealth(input({ lastError: "fetch failed" }));
  expect(r.health).toBe("failing");
  expect(r.alert).toBe("notice");
  expect(r.message).toBe("Last sync failed: fetch failed");
});

test("failing since before the staleness threshold escalates to an alert", () => {
  const r = syncHealth(input({ lastError: "fetch failed", lastSyncAt: NOW - SYNC_STALE_MS - 1 }));
  expect(r.health).toBe("stalled");
  expect(r.alert).toBe("alert");
  expect(r.message).toContain("fetch failed");
});

test("no successful pass for over a day with no error at all is an alert", () => {
  const r = syncHealth(input({ lastSyncAt: NOW - SYNC_STALE_MS - 1 }));
  expect(r.health).toBe("stalled");
  expect(r.alert).toBe("alert");
  expect(r.message).toBe("No sync has succeeded for over a day.");
});

test("an old lastSyncAt right after startup is the app having been closed, not a fault", () => {
  // Reopened after a week away: the first pass has not landed yet, and calling
  // that a failure would fire on every launch.
  const r = syncHealth(input({ lastSyncAt: NOW - 7 * 24 * 60 * MINUTE, startedAt: NOW - MINUTE }));
  expect(r.health).toBe("ok");
  expect(r.alert).toBe("none");
});

test("the same old lastSyncAt once the grace window has passed is stalled", () => {
  const r = syncHealth(
    input({
      lastSyncAt: NOW - 7 * 24 * 60 * MINUTE,
      startedAt: NOW - SYNC_GRACE_MS - MINUTE,
    }),
  );
  expect(r.health).toBe("stalled");
  expect(r.alert).toBe("alert");
});

test("a healthy device says nothing", () => {
  const r = syncHealth(input());
  expect(r.health).toBe("ok");
  expect(r.alert).toBe("none");
  expect(r.message).toBeNull();
});

// --- what startup does with the engine ---------------------------------------

test("startup starts the engine when the credentials and the toggle agree", () => {
  expect(
    syncStartAction({ configured: true, signedIn: true, autoSync: true, lastSyncAt: null }),
  ).toBe("start");
});

test("startup records a reason when auto-sync is on and the credentials are gone", () => {
  expect(
    syncStartAction({ configured: true, signedIn: false, autoSync: true, lastSyncAt: NOW }),
  ).toBe("record-stopped");
});

test("startup stays idle after a deliberate sign-out", () => {
  // signOutOfGoogle leaves autoSync alone (docs/13) but clears lastSyncAt, so
  // the same two flags are not enough to tell the two apart.
  expect(
    syncStartAction({ configured: true, signedIn: false, autoSync: true, lastSyncAt: null }),
  ).toBe("idle");
});

test("startup stays idle with auto-sync off or no Google client", () => {
  expect(
    syncStartAction({ configured: true, signedIn: true, autoSync: false, lastSyncAt: NOW }),
  ).toBe("idle");
  expect(
    syncStartAction({ configured: false, signedIn: false, autoSync: true, lastSyncAt: NOW }),
  ).toBe("idle");
});

test("every quiet state carries no message and every loud one does", () => {
  const cases: SyncHealthInput[] = [
    input({ startedAt: null }),
    input({ configured: false }),
    input({ signedIn: false, lastSyncAt: null }),
    input({ autoSync: false }),
    input({ lastSyncAt: null, startedAt: NOW - MINUTE }),
    input(),
    input({ lastError: "fetch failed" }),
    input({ lastSyncAt: NOW - SYNC_STALE_MS - 1 }),
    input({ signedIn: false, engineStarted: false }),
    input({ engineStarted: false }),
  ];
  for (const c of cases) {
    const r = syncHealth(c);
    expect(r.message === null).toBe(r.alert === "none");
  }
});
