// The soul's harness: one per process, one session in the "soul" group, one
// lane named "soul", and every turn the soul takes in this process runs on it
// (legion/execute/held.ts). Built at start (startSoulSession) or, failing that,
// the first time a turn asks for it — whoever opens it pays for listing the
// group's sessions and reopening the newest one, or creating it; every turn
// after that pays a few appended session lines.
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

import { BACKGROUND_CONTEXT, type AgentMessage, type Context } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { holdHarness, type HeldHarness, type HeldTurn } from "../legion/execute/held";
import type { TurnLane } from "../legion/execute/contract";
import type { ProviderId } from "../ai";
import { resolveCall } from "../ai/providers";
import { loadSettings, type Settings } from "../platform/app/settings";
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

/**
 * What the harness is created with when nobody has a turn to give it. The
 * harness fixes its model registry at creation and the recovery's own slot is
 * seeded from here, so the previous session opens with a registry that can
 * answer at all; the turn that resumes brings its own model, prompt and tools
 * (recover.ts). Nothing streams through this one — a round that reached it
 * would be a round on a turn nobody assembled.
 */
async function seedTurn(settings: Settings): Promise<HeldTurn> {
  const { model } = await resolveCall(
    settings.defaultProviderId as ProviderId,
    settings.defaultModelId as string,
    [],
  );
  return {
    model,
    streamFn: () => {
      throw new Error("the soul's session was opened without a turn");
    },
    tools: [],
    systemPrompt: "",
    toProviderMessages: (messages: AgentMessage[]) => messages as Message[],
  };
}

/**
 * Open the soul's session at start, so a turn the last process died in the
 * middle of is finished straight away (recover.ts).
 *
 * The session used to be opened by the first turn of the process, and recovery
 * with it. But the reader whose answer was interrupted is the reader with the
 * least reason to ask a second question: they came back to a thread holding
 * their own line and nothing under it, so nothing ever opened the session and
 * the half-written answer stayed on disk (docs/pitfall/394). Opening it here
 * costs one directory listing and one session file per launch, which the
 * group's sweep already bounds.
 *
 * Failures are logged and dropped: there is no reader waiting on this, and a
 * device with no provider configured has nothing to resume with anyway. The
 * first turn then opens the session the way it always did.
 */
export async function startSoulSession(
  deps: { settings?: () => Promise<Settings>; context?: Context } = {},
): Promise<void> {
  const harness = soulHarness();
  if (!harness.open) return;
  try {
    const settings = await (deps.settings ?? loadSettings)();
    await harness.open(await seedTurn(settings), deps.context ?? BACKGROUND_CONTEXT);
  } catch (e) {
    console.warn("the soul's session could not be opened at start", e);
  }
}
