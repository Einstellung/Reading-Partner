// The scripted model and the sub-agent runner over it: each run is a
// background run (legion/durable/background.ts) on a durable runtime of its
// own whose faux provider answers from a list of turns. The real Harness, the
// real hooks (round cap, budget) and the real tool execution; no credentials
// and no network.
//
// Everything is per runner — the round counter, the recorded contexts and the
// recorded requests all live in the closure — so two files that each script a
// run cannot see each other's rounds.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackgroundTurnOn } from "../../src/legion/durable/background";
import type { SubagentTurnFn, SubagentTurnRequest } from "../../src/legion/subagent/types";
import { openTestRuntime } from "../legion/durable/support/runtime";
import { turnEvents, type Turn } from "./scripted-turn";

export const FAUX_MODEL = { providerId: "faux" as never, modelId: "faux-1" };

// More rounds than any script asks for; a round past the end streams `exhausted`.
const STEPS = 256;

export interface ScriptedRunnerOptions {
  // What a round past the end of the script streams. A file that never runs off
  // the end can leave it alone; one that does says which it means.
  exhausted?: Turn;
  // Fires as each round is asked for (0-based), which is where a test that
  // cancels an in-flight pass raises its signal.
  beforeRound?: (round: number) => void;
  // Fires with each round's context.
  onContext?: (context: Context) => void;
  // The faux model's context window.
  contextWindow?: number;
}

export interface ScriptedRunner {
  run: SubagentTurnFn;
  // What each run was asked for, in order.
  requests: SubagentTurnRequest[];
  // What each round was asked with, in order.
  contexts: Context[];
  streamed: () => number;
}

/** The message a scripted turn finishes with. */
export function turnMessage(turn: Turn): AssistantMessage {
  const events = turnEvents(turn);
  const last = events[events.length - 1];
  if (last?.type === "done") return last.message;
  if (last?.type === "error") return last.error;
  throw new Error("a scripted turn ends in done or error");
}

export function scriptedSubagentRunner(turns: readonly Turn[], options: ScriptedRunnerOptions = {}): ScriptedRunner {
  const exhausted = options.exhausted ?? { error: "no scripted turn" };
  const requests: SubagentTurnRequest[] = [];
  const contexts: Context[] = [];
  let round = 0;
  const step: FauxResponseFactory = (context) => {
    const i = round++;
    options.beforeRound?.(i);
    contexts.push(context as Context);
    options.onContext?.(context as Context);
    return turnMessage(turns[i] ?? exhausted);
  };
  const run: SubagentTurnFn = async (request) => {
    requests.push(request);
    const root = mkdtempSync(join(tmpdir(), "scripted-runner-"));
    const t = await openTestRuntime({
      root,
      responses: Array.from({ length: STEPS }, () => step),
      ...(options.contextWindow !== undefined ? { contextWindow: options.contextWindow } : {}),
    });
    try {
      return await runBackgroundTurnOn({ runtime: t.runtime }, { ...request, model: FAUX_MODEL });
    } finally {
      await t.runtime.close(BACKGROUND_CONTEXT);
      rmSync(root, { recursive: true, force: true });
    }
  };
  return { run, requests, contexts, streamed: () => round };
}
