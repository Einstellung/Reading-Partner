// A sub-agent turn that plays a script instead of asking a model: each round is
// a list of tool calls, or a final answer, or a failure. For the unit tests and
// the comparison script's dry run (docs/86 「第一期」), where the loop, the caps
// and the receipt have to be exercised with no provider and no network.

import { REFUSE_ROUNDS } from "../../legion/execute/contract";
import type { SubagentTurnFn, SubagentTurnRequest } from "../../legion/subagent/types";

export type ScriptedRound =
  | { calls: { name: string; args: Record<string, unknown> }[] }
  | { answer: string }
  | { error: string };

/** What the scripted turn saw: every tool result, by round, and the task it was handed. */
export interface ScriptLog {
  task: string;
  systemPrompt: string;
  results: { round: number; name: string; args: Record<string, unknown>; text: string }[];
}

/**
 * A turn that plays `rounds` in order, or asks `next` for each round given what
 * the tools answered so far. Running past the cap is the loop's own refusal.
 */
export function scriptedTurn(
  rounds: ScriptedRound[] | ((round: number, log: ScriptLog) => ScriptedRound),
  log: ScriptLog = { task: "", systemPrompt: "", results: [] },
): { turn: SubagentTurnFn; log: ScriptLog } {
  const turn: SubagentTurnFn = async (request: SubagentTurnRequest) => {
    log.task = request.task;
    log.systemPrompt = request.systemPrompt;
    for (let round = 1; ; round++) {
      const step = typeof rounds === "function" ? rounds(round, log) : (rounds[round - 1] ?? { answer: "done" });
      if ("calls" in step && round > request.maxRounds) return { kind: "refusal", message: REFUSE_ROUNDS };
      request.onRound({ round, rounds: request.maxRounds });
      if ("answer" in step) return { kind: "answer", text: step.answer };
      if ("error" in step) return { kind: "error", message: step.error, name: "Error" };
      for (const call of step.calls) {
        const tool = request.tools.find((t) => t.name === call.name);
        let text: string;
        try {
          if (!tool) throw new Error(`no tool ${call.name}`);
          const out = await tool.execute(call.args);
          text = typeof out === "string" ? out : out.text;
        } catch (e) {
          text = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
        log.results.push({ round, name: call.name, args: call.args, text });
      }
    }
  };
  return { turn, log };
}

/** Shorthands for a script. */
export const call = {
  open: (n: number) => ({ name: "open", args: { n } }),
  file: (n: number) => ({ name: "file", args: { n } }),
  finish: (note: string) => ({ name: "finish", args: { note } }),
};
