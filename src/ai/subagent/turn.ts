// The agent loop's callback surface turned into one settled promise, and the
// place the sub-agent's stream is actually thrown away.
//
// Two things this file exists for:
//
//   - Isolation is enforced here, not asked for. onDelta, onThinking,
//     onToolStart and onToolEnd are dropped on the floor: the caller cannot
//     accidentally be handed a token of the run's reasoning or a byte of a tool
//     result, because there is nowhere for them to go. Only onDone's final text
//     leaves.
//   - Cancellation. The loop stops silently on abort — no onDone, no onError, by
//     design, since whoever raised the signal already knows. A promise waiting on
//     those callbacks would then never settle, so the abort listener rejects with
//     StoppedError, the same signal src/ai/watchdog raises for a user Stop. That
//     is the existing abort path: the reader hangs up, the AbortController the
//     caller already owns fires, and the in-flight sub-agent dies with it.
//
// Kept apart from live.ts so it can be tested against the real runAgentLoop with
// a scripted stream, with no settings read and no credentials.

import { StoppedError } from "../watchdog";
import type { AgentCallbacks } from "../agent";
import type { SubagentTurnOutcome } from "./types";

export interface TurnSettler {
  callbacks: AgentCallbacks;
  outcome: Promise<SubagentTurnOutcome>;
  // Detach the abort listener. Safe to call more than once.
  dispose(): void;
}

export function createTurnSettler(
  signal?: AbortSignal,
  onRound?: (info: { round: number; rounds: number }) => void,
): TurnSettler {
  let settle: (outcome: SubagentTurnOutcome) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  let done = false;
  const outcome = new Promise<SubagentTurnOutcome>((resolve, reject) => {
    settle = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    fail = (error) => {
      if (done) return;
      done = true;
      reject(error);
    };
  });

  const stop = () => fail(new StoppedError());
  if (signal) {
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  }
  const dispose = () => signal?.removeEventListener("abort", stop);

  const callbacks: AgentCallbacks = {
    // Discarded on purpose — see the header.
    onDelta: () => {},
    onThinking: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onRound,
    onDone: (text) => settle({ kind: "answer", text }),
    onError: (message) => settle({ kind: "error", message }),
    // The loop declined for a reason it can state (the round cap, or a round
    // that outgrew the window). Not an error: every request that went out was
    // answered, and the difference decides what the brief says.
    onRefusal: (message) => settle({ kind: "refusal", message }),
  };

  return { callbacks, outcome, dispose };
}
