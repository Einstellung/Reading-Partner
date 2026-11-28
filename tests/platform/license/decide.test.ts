// The license decision table (src/platform/license/decide.ts): what a verified
// answer, a missing session or an unreachable server amounts to, with the
// 7-day grace counted from the server's issue time. Run: bun test.

import { expect, test } from "bun:test";
import {
  decideGate,
  lockActions,
  shouldRecheck,
  viewOfPayload,
  withinGrace,
} from "../../../src/platform/license/decide";
import type { LicensePayload, LicenseStatus } from "../../../src/platform/license/signed";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2027, 1, 1, 12);

function payload(status: LicenseStatus, over: Partial<LicensePayload> = {}): LicensePayload {
  return { v: 1, userId: "u1", status, trialEndsAt: NOW + 10 * DAY, issuedAt: NOW - DAY, ...over };
}

test("open and purchased open the app", () => {
  expect(viewOfPayload(payload("open"), NOW)).toEqual({ view: "open" });
  expect(viewOfPayload(payload("purchased", { trialEndsAt: NOW - 100 * DAY }), NOW)).toEqual({
    view: "open",
  });
});

test("a trial is open until its end, and expired from that moment", () => {
  expect(viewOfPayload(payload("trial"), NOW)).toEqual({ view: "open" });
  const ending = payload("trial", { trialEndsAt: NOW });
  expect(viewOfPayload(ending, NOW - 1)).toEqual({ view: "open" });
  expect(viewOfPayload(ending, NOW)).toEqual({ view: "locked", reason: "expired", userId: "u1" });
});

test("a trial with no end date is not a trial", () => {
  expect(viewOfPayload(payload("trial", { trialEndsAt: null }), NOW)).toEqual({
    view: "locked",
    reason: "expired",
    userId: "u1",
  });
});

test("expired and banned lock", () => {
  expect(viewOfPayload(payload("expired"), NOW)).toEqual({ view: "locked", reason: "expired", userId: "u1" });
  expect(viewOfPayload(payload("banned"), NOW)).toEqual({ view: "locked", reason: "banned", userId: "u1" });
});

test("the grace is seven days from the issue time", () => {
  expect(withinGrace(NOW - 7 * DAY, NOW)).toBe(true);
  expect(withinGrace(NOW - 7 * DAY - 1, NOW)).toBe(false);
  expect(withinGrace(NOW, NOW)).toBe(true);
  // A clock behind the server by up to a day is tolerated; further is not.
  expect(withinGrace(NOW + DAY, NOW)).toBe(true);
  expect(withinGrace(NOW + DAY + 1, NOW)).toBe(false);
});

test("signed out asks for a sign-in, cache or not", () => {
  expect(decideGate({ kind: "signed-out" }, payload("purchased"), NOW)).toEqual({ view: "sign-in" });
});

test("a fresh answer wins over the cache", () => {
  expect(decideGate({ kind: "answer", payload: payload("expired") }, payload("purchased"), NOW)).toEqual({
    view: "locked",
    reason: "expired",
    userId: "u1",
  });
});

test("unreachable within the grace uses the cached answer", () => {
  const cached = payload("purchased", { issuedAt: NOW - 6 * DAY });
  expect(decideGate({ kind: "unreachable", userId: "u1" }, cached, NOW)).toEqual({ view: "open" });
  // The session's user is not always known offline; the cache still counts.
  expect(decideGate({ kind: "unreachable", userId: null }, cached, NOW)).toEqual({ view: "open" });
});

test("unreachable past the grace locks", () => {
  const cached = payload("purchased", { issuedAt: NOW - 8 * DAY });
  expect(decideGate({ kind: "unreachable", userId: "u1" }, cached, NOW)).toEqual({
    view: "locked",
    reason: "offline",
    userId: "u1",
  });
});

test("unreachable with no cache locks", () => {
  expect(decideGate({ kind: "unreachable", userId: null }, null, NOW)).toEqual({
    view: "locked",
    reason: "offline",
    userId: null,
  });
});

test("a cached trial that has run out is expired even offline", () => {
  const cached = payload("trial", { issuedAt: NOW - DAY, trialEndsAt: NOW - 1 });
  expect(decideGate({ kind: "unreachable", userId: "u1" }, cached, NOW)).toEqual({
    view: "locked",
    reason: "expired",
    userId: "u1",
  });
});

test("another account's cached answer does not count", () => {
  const cached = payload("purchased", { userId: "someone-else" });
  expect(decideGate({ kind: "unreachable", userId: "u1" }, cached, NOW)).toEqual({
    view: "locked",
    reason: "offline",
    userId: "u1",
  });
});

test("the foreground re-checks after six hours, and always when not open", () => {
  const open = { view: "open" } as const;
  expect(shouldRecheck(open, null, NOW)).toBe(true);
  expect(shouldRecheck(open, NOW - 6 * 60 * 60 * 1000 + 1, NOW)).toBe(false);
  expect(shouldRecheck(open, NOW - 6 * 60 * 60 * 1000, NOW)).toBe(true);
  expect(shouldRecheck({ view: "sign-in" }, NOW, NOW)).toBe(true);
  expect(shouldRecheck({ view: "locked", reason: "expired", userId: "u1" }, NOW, NOW)).toBe(true);
});

test("the lock screen's actions", () => {
  expect(lockActions("expired")).toEqual(["buy", "restore", "delete-account", "sign-out"]);
  expect(lockActions("banned")).toEqual(["delete-account", "sign-out"]);
  expect(lockActions("offline")).toEqual(["retry", "sign-out"]);
});

test("an ended trial buys the way the device can", () => {
  expect(lockActions("expired", "store")).toEqual(["buy", "restore", "delete-account", "sign-out"]);
  expect(lockActions("expired", "web")).toEqual(["buy", "delete-account", "sign-out"]);
  expect(lockActions("expired", "web", true)).toEqual(["buy", "refresh", "delete-account", "sign-out"]);
  expect(lockActions("expired", "none")).toEqual(["refresh", "delete-account", "sign-out"]);
  // The path does not touch the other locks.
  for (const path of ["store", "web", "none"] as const) {
    expect(lockActions("banned", path, true)).toEqual(["delete-account", "sign-out"]);
    expect(lockActions("offline", path, true)).toEqual(["retry", "sign-out"]);
  }
});
