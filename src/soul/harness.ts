// The soul's harness: one per process, one session in the "soul" group, one
// lane named "soul", and every turn the soul takes in this process runs on it
// (legion/execute/held.ts). Built the first time a turn asks for it — that
// first turn pays for listing the group's sessions and reopening the newest
// one, or creating it; every turn after that pays a few appended session lines.
//
// What the previous process left half-answered is finished on that older
// session, in the background (recover.ts). The first turn of this process does
// not wait for it: the two run on two harnesses over two files.
//
// The session is a record of this device's turns, not the soul's memory. The
// context each turn sends is assembled from the conversation files (turn.ts,
// docs/71), because a conversation another device wrote is only there; the
// lane stands on the session root before every prompt, so nothing recorded in
// an earlier turn reaches the model again.

import { holdHarness, type HeldHarness } from "../legion/execute/held";
import type { TurnLane } from "../legion/execute/contract";
import { recoverSoulSession } from "./recover";

export const SOUL_LANE: TurnLane = { name: "soul", sessions: "soul" };

let held: HeldHarness | undefined;

/** The process's one soul harness, made on first use. */
export function soulHarness(): HeldHarness {
  held ??= holdHarness({
    lane: SOUL_LANE,
    recover: (previous, context) =>
      recoverSoulSession(previous, { lane: SOUL_LANE.name }, context),
  });
  return held;
}
