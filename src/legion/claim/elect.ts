// Which machine runs a kind (docs/55).
//
// Pure functions of the claim files and the clock, so every device reaches the
// same answer for itself without anything being said between them. The rule is
// info's collector election (docs/36) with one thing added: the candidates are
// filtered by what the kind needs before the longest-claiming one wins.
//
// Device level, not run level. A kind is won by one machine, and every run of
// that kind goes to it until the machine gives its claim up; there is no
// per-run claiming and so no lease. A lease simulates taking something on a
// medium that cannot take it atomically, and when the runner is decided in
// advance there is nothing to simulate.

import { capabilitiesFor } from "./capabilities";
import { CLAIM_SYNC_GRACE_MS, FORFEIT_MS, type DeviceClaim } from "./types";

/**
 * Whether a claim is still in the running at all. A machine that turned
 * background work off wrote `claimedAt: null` and is out; one whose heartbeat
 * has stopped for a day has forfeited.
 */
export function isCandidate(claim: DeviceClaim, now: number): boolean {
  if (claim.claimedAt === null) return false;
  return now - claim.heartbeatAt <= FORFEIT_MS;
}

/** Whether a machine has everything a kind asked for. */
export function hasCapabilities(claim: DeviceClaim, requires: readonly string[]): boolean {
  return requires.every((cap) => claim.capabilities.includes(cap));
}

/**
 * The winner among the machines that can do all of `requires`: the candidate
 * that has been claiming longest. The device id breaks a tie, because two
 * machines started in the same millisecond must still pick the same winner as
 * each other.
 */
export function electAmong(
  requires: readonly string[],
  claims: readonly DeviceClaim[],
  now: number,
): DeviceClaim | null {
  let best: DeviceClaim | null = null;
  for (const claim of claims) {
    if (!isCandidate(claim, now) || !hasCapabilities(claim, requires)) continue;
    if (
      best === null ||
      claim.claimedAt! < best.claimedAt! ||
      (claim.claimedAt! === best.claimedAt! && claim.deviceId < best.deviceId)
    ) {
      best = claim;
    }
  }
  return best;
}

/**
 * The device that runs this kind, or null when none of them can. Null for a
 * kind nobody registered as well: legion does not guess at what unknown work
 * needs of a machine.
 */
export function electFor(
  kind: string,
  claims: readonly DeviceClaim[],
  now: number,
): string | null {
  const requires = capabilitiesFor(kind);
  if (requires === null) return null;
  return electAmong(requires, claims, now)?.deviceId ?? null;
}

/** Whether this device is the one that runs this kind. */
export function isElectedFor(
  kind: string,
  claims: readonly DeviceClaim[],
  deviceId: string,
  now: number,
): boolean {
  return electFor(kind, claims, now) === deviceId;
}

/**
 * Whether this device may write a claim yet. A machine with no account attached
 * is alone in the world and claims immediately; one that syncs waits for its
 * first pull, and gives up waiting after the grace period.
 */
export function mayClaim(state: {
  /** Signed in with sync running. False means single-machine: nothing to wait for. */
  syncing: boolean;
  /** When the first pull of this session landed, or null if none has. */
  pulledAt: number | null;
  startedAt: number;
  now: number;
}): boolean {
  if (!state.syncing) return true;
  if (state.pulledAt !== null) return true;
  return state.now - state.startedAt >= CLAIM_SYNC_GRACE_MS;
}
