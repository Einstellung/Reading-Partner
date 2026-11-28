// What the app shows, from what the license check learned (docs/platform/713).
// Pure: the clock and every answer are arguments.

import { CLOCK_SKEW_MS, OFFLINE_GRACE_MS, RECHECK_AFTER_MS } from "./config";
import type { LicensePayload } from "./signed";

export type LockReason = "expired" | "banned" | "offline";

export type GateView =
  | { view: "open" }
  | { view: "sign-in" }
  | { view: "locked"; reason: LockReason; userId: string | null };

export const OPEN: GateView = { view: "open" };

// What one check came back with.
export type CheckOutcome =
  // A verified answer from the server, just now.
  | { kind: "answer"; payload: LicensePayload }
  // No session and no way to get one: nobody is signed in.
  | { kind: "signed-out" }
  // Signed in (userId when known), but no verified answer: no network, a server
  // error, a timeout, or an answer whose signature did not check out.
  | { kind: "unreachable"; userId: string | null };

// A verified payload, read against the clock. A trial whose end has passed is
// over whatever the status says, so a cached "trial" runs out offline too.
export function viewOfPayload(payload: LicensePayload, now: number): GateView {
  switch (payload.status) {
    case "open":
    case "purchased":
      return OPEN;
    case "trial":
      return payload.trialEndsAt !== null && now < payload.trialEndsAt
        ? OPEN
        : { view: "locked", reason: "expired", userId: payload.userId };
    case "expired":
      return { view: "locked", reason: "expired", userId: payload.userId };
    case "banned":
      return { view: "locked", reason: "banned", userId: payload.userId };
  }
}

// Whether a cached answer may stand in for the server: issued no more than the
// grace period ago, and not implausibly far in the future.
export function withinGrace(issuedAt: number, now: number): boolean {
  return issuedAt - now <= CLOCK_SKEW_MS && now - issuedAt <= OFFLINE_GRACE_MS;
}

export function decideGate(
  outcome: CheckOutcome,
  cached: LicensePayload | null,
  now: number,
): GateView {
  switch (outcome.kind) {
    case "signed-out":
      return { view: "sign-in" };
    case "answer":
      return viewOfPayload(outcome.payload, now);
    case "unreachable": {
      // A cached answer counts only for the account it was issued to.
      const usable =
        cached !== null &&
        (outcome.userId === null || cached.userId === outcome.userId) &&
        withinGrace(cached.issuedAt, now);
      return usable
        ? viewOfPayload(cached, now)
        : { view: "locked", reason: "offline", userId: outcome.userId ?? cached?.userId ?? null };
    }
  }
}

// Whether coming back to the foreground re-checks. A locked or sign-in screen
// always does: the purchase or the sign-in may have happened elsewhere.
export function shouldRecheck(view: GateView, lastCheckAt: number | null, now: number): boolean {
  if (view.view !== "open") return true;
  return lastCheckAt === null || now - lastCheckAt >= RECHECK_AFTER_MS;
}

// The lock screen's actions for a reason. A suspended account gets no Buy or
// Restore: a purchase would not lift the suspension.
export type LockAction = "buy" | "restore" | "delete-account" | "sign-out" | "retry";

export function lockActions(reason: LockReason): LockAction[] {
  switch (reason) {
    case "expired":
      return ["buy", "restore", "delete-account", "sign-out"];
    case "banned":
      return ["delete-account", "sign-out"];
    case "offline":
      return ["retry", "sign-out"];
  }
}
