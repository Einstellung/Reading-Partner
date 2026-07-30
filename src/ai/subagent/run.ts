// The sub-agent runner: one task, its own message list, its own tools, one
// brief back (docs/25).
//
// The turn itself is injected (SubagentTurnFn), so everything here — isolation,
// the honest-failure mapping, tool-failure accounting, the round ledger, the cap
// on what crosses back — runs in a test with no provider, no credentials and no
// network. live.ts supplies the real turn. This is the same dependency-injection
// shape src/memory/distill.ts uses, for the same reason.

import { REFUSE_MIDTURN, REFUSE_ROUNDS, type AgentTool } from "../agent";
import { StoppedError } from "../watchdog";
import { composeBrief, subagentSystemPrompt, EMPTY_ANSWER, type BriefFacts } from "./brief";
import type { SubagentLedger } from "./ledger";
import {
  DEFAULT_BRIEF_TOKEN_CAP,
  DEFAULT_SUBAGENT_ROUNDS,
  type SubagentBrief,
  type SubagentDefinition,
  type SubagentOutcome,
  type SubagentProgress,
  type SubagentToolFailure,
  type SubagentTurnFn,
} from "./types";

export interface SubagentDeps {
  run: SubagentTurnFn;
  // A shared round budget for the caller's whole turn. Absent means the run gets
  // its definition's cap outright, which is right for a background pipeline
  // calling one sub-agent and wrong for a chat turn that mounts one as a tool.
  ledger?: SubagentLedger;
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
        tally.fail(tool.name, e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
  }));
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

  const reserved = deps.ledger ? deps.ledger.grant(want) : want;
  const tally = new ToolTally();
  let rounds = 0;

  const facts = (): BriefFacts => ({
    name: definition.name,
    answer: "",
    outcome: "failed",
    rounds,
    roundsAllowed: reserved,
    toolsMounted: definition.tools.length,
    toolCalls: tally.calls,
    toolSuccesses: tally.successes,
    toolFailures: tally.list(),
    tokenCap,
  });

  const finish = (partial: Partial<BriefFacts> & { outcome: SubagentOutcome }): SubagentBrief => {
    const f = { ...facts(), ...partial };
    const composed = composeBrief(f);
    onProgress?.({
      phase: "done",
      label,
      round: rounds,
      roundsAllowed: reserved,
      outcome: f.outcome,
    });
    return {
      brief: composed.brief,
      outcome: f.outcome,
      usable: composed.usable,
      rounds,
      roundsAllowed: reserved,
      toolCalls: f.toolCalls,
      toolSuccesses: f.toolSuccesses,
      toolFailures: f.toolFailures,
      clipped: composed.clipped,
    };
  };

  // The shared budget was already spent. Nothing is sent, and the brief says
  // nothing was looked up rather than that nothing was found.
  if (reserved <= 0) return finish({ outcome: "out-of-budget" });

  onProgress?.({ phase: "started", label, round: 0, roundsAllowed: reserved });

  try {
    const outcome = await deps.run({
      systemPrompt: subagentSystemPrompt(definition, tokenCap),
      // The whole message list: one user turn. Nothing of the caller's
      // conversation is replayed, and nothing of this run's rounds can leak back
      // — they live in an array the caller never sees.
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

    if (outcome.kind === "error") return finish({ outcome: "failed", message: outcome.message });
    if (outcome.kind === "refusal") {
      // The loop's two stated give-ups, matched against its own exported
      // constants so the two reasons keep their own sentences: a spent turn cap
      // and a call that outgrew the window are not the same thing to a caller.
      if (outcome.message === REFUSE_ROUNDS) return finish({ outcome: "out-of-turns" });
      if (outcome.message === REFUSE_MIDTURN) return finish({ outcome: "out-of-context" });
      return finish({ outcome: "refused", message: outcome.message });
    }

    const answer = outcome.text.trim();
    if (!answer) return finish({ outcome: "refused", message: EMPTY_ANSWER });
    // A brief with nothing behind it is the failure this module is built to
    // stop, so it is caught here rather than left to the caller to notice.
    if (evidenceRequired(definition) && tally.successes === 0) {
      return finish({ outcome: "no-evidence" });
    }
    return finish({ outcome: "answered", answer });
  } catch (e) {
    // Cancellation is not a failure and must never become a brief: a brief for a
    // run the reader hung up on is a brief nobody asked for.
    if (e instanceof StoppedError || signal?.aborted) throw new StoppedError();
    return finish({ outcome: "failed", message: e instanceof Error ? e.message : String(e) });
  } finally {
    deps.ledger?.settle(reserved, rounds);
  }
}
