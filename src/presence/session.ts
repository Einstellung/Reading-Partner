// This device's presence among the reader's machines (docs/36, docs/55): its
// claim, and the daily round a machine that claims runs.
//
// Only a collector — a desktop the reader left in that role — writes a claim. A
// reader (every phone, and a desktop set to read) writes none, takes part in no
// election and runs no round. Whether a collector actually stands for election
// is the device's background switch, asked on every write (legion/claim
// writer.ts); a collector with the switch off still runs the round, and the
// election tells it the dream is somebody else's.
//
// Until Intel was removed (2026-11) this was the collector session in
// info/program/presence.ts and refreshInfoCollector in info/program/live.ts.
// The claim writer itself moved to legion/claim long before; what is here is
// what was left once the briefing's fields, asks and pipeline came off it.

import { registerKindCapabilities, type ClaimWriter } from "../legion/claim";
import type { DeviceRole } from "../platform/app/device";
import { DREAM_KIND, type DailyRound } from "./daily";

export interface DevicePresenceDeps {
  role(): DeviceRole;
  writer: ClaimWriter;
  round: DailyRound;
}

export interface DevicePresence {
  /**
   * Apply this device's role and switch: claim, or give the claim up so whoever
   * is next takes over in seconds rather than in a day. Called on every change
   * and once when device.json first lands, so it is also how a collector starts.
   */
  refresh(): Promise<void>;
  /** Whether this device is the one the dream runs on. False on a reader. */
  elected(): Promise<boolean>;
}

export function createDevicePresence(deps: DevicePresenceDeps): DevicePresence {
  // No worker runs this kind; the registration is what lets the election answer
  // for it at all (legion/claim elect.ts returns nobody for an unknown kind).
  registerKindCapabilities(DREAM_KIND, []);

  async function refresh(): Promise<void> {
    if (deps.role() !== "collector") {
      await deps.writer.stop();
      return;
    }
    if (deps.writer.running()) {
      await deps.writer.publish();
      return;
    }
    await deps.writer.start();
    // After the claim's first write, as before: the round's first check asks the
    // election, and until start() returned this machine had no claim to win with.
    deps.round.start();
  }

  return {
    refresh,
    elected: () => deps.writer.electedFor(DREAM_KIND),
  };
}
