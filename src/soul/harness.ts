// The soul's harness: one per process, one session in the "soul" group, one
// lane named "soul", and every turn the soul takes in this process runs on it
// (legion/execute/held.ts). Built the first time a turn asks for it — that
// first turn pays for listing the group's sessions and reopening the newest
// one, or creating it, and for settling whatever the previous process left
// open; every turn after that pays a few appended session lines.
//
// The session is a record of this device's turns, not the soul's memory. The
// context each turn sends is assembled from the conversation files (turn.ts,
// docs/67), because a conversation another device wrote is only there; the
// lane stands on the session root before every prompt, so nothing recorded in
// an earlier turn reaches the model again.

import { holdHarness, type HeldHarness } from "../legion/execute/held";
import type { TurnLane } from "../legion/execute/contract";

export const SOUL_LANE: TurnLane = { name: "soul", sessions: "soul" };

let held: HeldHarness | undefined;

/** The process's one soul harness, made on first use. */
export function soulHarness(): HeldHarness {
  held ??= holdHarness({ lane: SOUL_LANE });
  return held;
}
