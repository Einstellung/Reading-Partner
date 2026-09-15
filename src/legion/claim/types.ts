// What a device says about itself (docs/55).
//
// One file per device under `legion/claim/`, written by that device and nobody
// else, so two devices writing at the same moment produce two files rather than
// a conflict. Everything that decides which machine runs what is in here, and
// it is read by every device: the election is a pure function of the claims on
// disk and the clock, so each device computes the same answer for itself and
// the ones that lose stand by.
//
// The file started life as info's "I am the collector" (docs/36). What it says
// now is what this machine can do; which kind of work that wins it is the
// election's business, not the claim's.

/** A device's standing declaration. Domains extend it with their own fields. */
export interface DeviceClaim {
  deviceId: string;
  /**
   * The machine's own name, for a sentence a reader can act on ("the briefing
   * is built on kestrel, and kestrel has been off since Tuesday").
   */
  deviceName: string;
  platform: string;
  /**
   * When this process began offering to take work, or null when this machine is
   * not a candidate for anything at all — background work turned off. Null
   * leaves the election at once rather than waiting out the forfeit threshold.
   *
   * Reset on every process start, so the winner is the machine that has been up
   * longest without interruption. A machine that lost and comes back joins the
   * queue at the end rather than taking the work back off whoever picked it up.
   */
  claimedAt: number | null;
  heartbeatAt: number;
  /**
   * What this machine can do, as capability tags (capabilities.ts). A kind is
   * registered with the tags it needs; a device that has all of them is a
   * candidate for it.
   */
  capabilities: string[];
}

// A heartbeat older than this means the device has given its claim up: the next
// machine in line takes over. Long enough that a weekend away with the lid shut
// does not hand the work to a laptop, short enough that a dead desktop does not
// hold the claim for a week. Neither number has been measured — docs/36 says so
// and says to revisit them.
export const FORFEIT_MS = 24 * 60 * 60_000;

// How often a device says it is alive.
export const HEARTBEAT_MS = 60 * 60_000;

// A device that syncs does not claim until its first pull of the session has
// landed: claiming on a folder it has not read yet is how two machines both
// decide they are the one. If no pull has landed by then, sync is broken or the
// account is offline, and a machine that never works because it is waiting for
// a file it will never get is worse than two machines working.
export const CLAIM_SYNC_GRACE_MS = 30 * 60_000;
