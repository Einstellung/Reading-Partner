// The sub-agent runner: one task, its own message list, its own tools, one
// brief back (docs/25).
//
// The turn itself is injected (SubagentTurnFn), so everything here — isolation,
// the honest-failure mapping, tool-failure accounting, the round quota, the cap
// on what crosses back — runs in a test with no provider, no credentials and no
// network. live.ts supplies the real turn. This is the same dependency-injection
// shape src/memory/observations/distill.ts uses, for the same reason.
//
// live.ts supplies the turn for programmatic callers; the tool (tool.ts) runs
// a child conversation instead and shares only briefFor. The brief is composed here rather
// than taken from pi's generateBranchSummary: that one is a compaction summary
// of a branch, written by an extra model call with its own prompt, and it says
// nothing about the distinctions a caller has to state — a run that answered
// with nothing behind it, a run that spent its turn cap and a run whose call
// never completed all summarize alike, and none of them are held to
// briefTokenCap.

import { REFUSE_MIDTURN, REFUSE_ROUNDS, type AgentTool } from "../execute/contract";
import { StoppedError } from "../stop";
import { composeBrief, subagentSystemPrompt, EMPTY_ANSWER, type BriefFacts } from "./brief";
import type { SubagentQuota } from "./quota";
import {
  DEFAULT_BRIEF_TOKEN_CAP,
  DEFAULT_SUBAGENT_ROUNDS,
  type SubagentBrief,
  type SubagentDefinition,
  type SubagentFailure,
  type SubagentOutcome,
  type SubagentProgress,
  type SubagentToolFailure,
  type SubagentTurnFn,
  type SubagentTurnOutcome,
  type SubagentTurnStats,
} from "./types";
import { errMsg } from "../../platform/std/errors";

export interface SubagentDeps {
  run: SubagentTurnFn;
  // A shared round budget for the caller's whole turn. Absent means the run gets
  // its definition's cap outright, which is right for a background pipeline
  // calling one sub-agent and wrong for a chat turn that mounts one as a tool.
  quota?: SubagentQuota;
}

export interface SubagentRequest {
  definition: SubagentDefinition;
  // What this run is asked to do. Becomes the single user message.
  task: string;
  signal?: AbortSignal;
  onProgress?(progress: SubagentProgress): void;
}

// Whether a run must have had a tool succeed before its words count as a brief.
// Required by default the moment tools are mounted: a sub-agent given a search
// tool exists because the answer is not in the model's memory.
function evidenceRequired(definition: SubagentDefinition): boolean {
  if (definition.evidence) return definition.evidence === "required";
  return definition.tools.length > 0;
}

// A tally of what each injected tool did, built by wrapping them. The wrapper is
// the only way the runner learns anything about the tools it was handed: it never
// inspects a name, a schema or a result.
class ToolTally {
  calls = 0;
  successes = 0;
  private failures = new Map<string, SubagentToolFailure>();

  fail(name: string, reason: string): void {
    const existing = this.failures.get(name);
    if (existing) {
      existing.count++;
      // The first reason is kept: it is the one that describes a working run
      // going wrong, and later attempts often fail differently as a consequence.
      return;
    }
    this.failures.set(name, { name, reason, count: 1 });
  }

  list(): SubagentToolFailure[] {
    return [...this.failures.values()];
  }
}

// The injected tools with counting and progress around them. Failures are
// re-thrown untouched: the agent loop turns a throw into a tool-result error the
// model can react to, and swallowing it here would leave the model believing the
// call worked.
function instrument(
  tools: AgentTool[],
  tally: ToolTally,
  report: (tool: string) => void,
): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (args) => {
      tally.calls++;
      report(tool.name);
      try {
        const result = await tool.execute(args);
        tally.successes++;
        return result;
      } catch (e) {
        tally.fail(tool.name, errMsg(e));
        throw e;
      }
    },
  }));
}

export interface BriefInput {
  definition: SubagentDefinition;
  reserved: number;
  stats: SubagentTurnStats;
  onProgress?(progress: SubagentProgress): void;
}

// The brief for a run that ended with `outcome`: the six honest failures and the
// answer, each in its own sentence. Shared by the runner below and the tool
// (tool.ts), which counts from the child's entries.
export function briefFor(input: BriefInput, outcome: SubagentTurnOutcome | { kind: "out-of-budget" }): SubagentBrief {
  const { definition, reserved, stats, onProgress } = input;
  const tokenCap = definition.briefTokenCap ?? DEFAULT_BRIEF_TOKEN_CAP;
  const finish = (
    partial: Partial<BriefFacts> & { outcome: SubagentOutcome },
    failure?: SubagentFailure,
  ): SubagentBrief => {
    const f: BriefFacts = {
      name: definition.name,
      answer: "",
      rounds: stats.rounds,
      roundsAllowed: reserved,
      toolsMounted: definition.tools.length,
      toolCalls: stats.toolCalls,
      toolSuccesses: stats.toolSuccesses,
      toolFailures: stats.toolFailures,
      tokenCap,
      ...partial,
    };
    const composed = composeBrief(f);
    onProgress?.({ phase: "done", label: definition.label, round: stats.rounds, roundsAllowed: reserved, outcome: f.outcome });
    return {
      brief: composed.brief,
      outcome: f.outcome,
      usable: composed.usable,
      rounds: stats.rounds,
      roundsAllowed: reserved,
      toolCalls: f.toolCalls,
      toolSuccesses: f.toolSuccesses,
      toolFailures: f.toolFailures,
      clipped: composed.clipped,
      ...(failure ? { failure } : {}),
    };
  };
  // The shared budget was already spent: nothing was looked up, rather than nothing found.
  if (outcome.kind === "out-of-budget") return finish({ outcome: "out-of-budget" });
  if (outcome.kind === "error") {
    return finish(
      { outcome: "failed", message: outcome.message },
      { name: outcome.name ?? "Error", message: outcome.message },
    );
  }
  if (outcome.kind === "refusal") {
    // The loop's two stated give-ups keep their own sentences: a spent turn cap
    // and a call that outgrew the window are not the same thing to a caller.
    if (outcome.message === REFUSE_ROUNDS) return finish({ outcome: "out-of-turns" });
    if (outcome.message === REFUSE_MIDTURN) return finish({ outcome: "out-of-context" });
    return finish({ outcome: "refused", message: outcome.message });
  }
  const answer = outcome.text.trim();
  if (!answer) return finish({ outcome: "refused", message: EMPTY_ANSWER });
  // A brief with nothing behind it is the failure this module is built to stop.
  if (evidenceRequired(definition) && stats.toolSuccesses === 0) return finish({ outcome: "no-evidence" });
  return finish({ outcome: "answered", answer });
}

// Run one sub-agent to completion and return its brief.
//
// Rejects only for cancellation (StoppedError). Everything else — no turns left,
// no budget, no working tool, a provider failure — comes back as a brief that
// says so, because a caller that has to distinguish six failure shapes by
// catching them will get one of them wrong.
export async function runSubagent(
  request: SubagentRequest,
  deps: SubagentDeps,
): Promise<SubagentBrief> {
  const { definition, task, signal, onProgress } = request;
  const { label } = definition;
  const tokenCap = definition.briefTokenCap ?? DEFAULT_BRIEF_TOKEN_CAP;
  const want = definition.maxRounds ?? DEFAULT_SUBAGENT_ROUNDS;

  if (signal?.aborted) throw new StoppedError();

  const reserved = deps.quota ? deps.quota.grant(want) : want;
  const tally = new ToolTally();
  let rounds = 0;
  let counted: SubagentTurnStats | undefined;
  const stats = (): SubagentTurnStats =>
    counted ?? { rounds, toolCalls: tally.calls, toolSuccesses: tally.successes, toolFailures: tally.list() };
  const brief = (outcome: Parameters<typeof briefFor>[1]) =>
    briefFor({ definition, reserved, stats: stats(), ...(onProgress ? { onProgress } : {}) }, outcome);

  if (reserved <= 0) return brief({ kind: "out-of-budget" });

  onProgress?.({ phase: "started", label, round: 0, roundsAllowed: reserved });

  try {
    const outcome = await deps.run({
      name: definition.name,
      systemPrompt: subagentSystemPrompt(definition, tokenCap),
      // The whole message list: one user turn. Nothing of the caller's
      // conversation is replayed, and nothing of this run's rounds can leak back.
      task,
      tools: instrument(definition.tools, tally, (tool) =>
        onProgress?.({ phase: "tool", label, round: rounds, roundsAllowed: reserved, tool }),
      ),
      maxRounds: reserved,
      purpose: definition.purpose ?? "chat",
      model: definition.model,
      signal,
      onRound: ({ round }) => {
        rounds = round;
        onProgress?.({ phase: "round", label, round, roundsAllowed: reserved });
      },
    });
    if (outcome.stats) {
      counted = outcome.stats;
      rounds = outcome.stats.rounds;
    }
    return brief(outcome);
  } catch (e) {
    // Cancellation is not a failure and must never become a brief.
    if (e instanceof StoppedError || signal?.aborted) throw new StoppedError();
    const message = errMsg(e);
    return brief({ kind: "error", message, name: e instanceof Error ? e.constructor.name : typeof e });
  } finally {
    deps.quota?.settle(reserved, rounds);
  }
}
