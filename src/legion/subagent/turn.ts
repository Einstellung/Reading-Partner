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
//     StoppedError, the same signal src/legion/execute/watchdog raises for a
//     user Stop. That is the existing abort path: the reader hangs up, the
//     AbortController the caller already owns fires, and the in-flight
//     sub-agent dies with it.
//
// Kept apart from live.ts so it can be tested against the real turn with
// a scripted stream, with no settings read and no credentials.

import { StoppedError } from "../stop";
import type { AgentCallbacks, TurnLane } from "../execute/contract";
import type { SubagentTurnOutcome } from "./types";

// Where a sub-agent run lives on the harness: a worker lane of its own, in a
// session group of its own.
//
// A lane rather than the reader's: the run is a fork of the work, not a turn of
// the conversation, and naming it after the definition is what makes a session
// file on disk say which worker wrote it. Its own group because these sessions
// are not the reader's turns and nothing that looks for an interrupted turn
// should find one of these instead.
//
// The lane is opened on a session this run owns, not on the caller's. Nothing
// in the app holds a harness across calls yet, and pi scopes the system prompt
// and the tool registry to the harness rather than the lane — a worker hung off
// a caller's harness would inherit the caller's role and have to have its tools
// added to the caller's registry, which is the opposite of the isolation this
// capability is for. When a caller does hold one, it hands the run its own.
const WORKER_SESSIONS = "worker";

export function workerLane(name: string): TurnLane {
  return { name: `worker:${name}`, sessions: WORKER_SESSIONS };
}

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
    // The thrown error's own type crosses with its message. Without it every
    // provider failure reaches the caller as a bare sentence, and a caller that
    // records failures by category has nothing to sort them by.
    onError: (message, _assistant, thrown) =>
      settle({
        kind: "error",
        message,
        ...(thrown instanceof Error ? { name: thrown.constructor.name } : {}),
      }),
    // The loop declined for a reason it can state (the round cap, or a round
    // that outgrew the window). Not an error: every request that went out was
    // answered, and the difference decides what the brief says.
    onRefusal: (message) => settle({ kind: "refusal", message }),
  };

  return { callbacks, outcome, dispose };
}
