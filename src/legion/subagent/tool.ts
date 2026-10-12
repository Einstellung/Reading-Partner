// The parent-side half: a sub-agent definition mounted as one tool, so from the
// calling model's point of view delegating a whole investigation looks like
// calling a tool that returns a summary.
//
// The run is a child conversation the call owns (legion/durable/child.ts):
// its own system prompt, model and tools; aborting the call aborts it; the
// parent never sees its entries and the UI never attaches to it. The brief is
// counted from the child's entries, so a call replayed after a restart finds
// the same child and reports every round of it (`replay: "safe"`).

import { Type } from "@earendil-works/pi-ai";
import { runTaskChild } from "../durable/child";
import type { DurableTool } from "../durable/tools";
import { StoppedError } from "../stop";
import { subagentSystemPrompt } from "./brief";
import { childSpec, subagentModel, turnOutcome } from "./child";
import type { SubagentQuota } from "./quota";
import { briefFor } from "./run";
import { DEFAULT_BRIEF_TOKEN_CAP, DEFAULT_SUBAGENT_ROUNDS, type SubagentBrief, type SubagentDefinition } from "./types";

// pi-ai rewrites tool names that match Claude Code's canonical set (Read, Bash,
// WebFetch, WebSearch …) on the OAuth channel, so a sub-agent called `WebSearch`
// would go out impersonating a different tool with different semantics
// (docs/24). Lowercase-with-underscores cannot collide.
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

// Appended to the definition's description. The parent model has to know it is
// getting a summary and not a result set, or it will ask the sub-agent for raw
// text and then report the absence of it as a failure.
const DELEGATION_NOTE =
  "This runs a separate agent with its own tools. You will not see what it did — " +
  "no queries, no fetched text, no intermediate steps — only a short brief. Give it " +
  "the whole job in one task description, including any constraint that matters, " +
  "because you cannot steer it once it starts. Its brief states plainly when it " +
  "could not finish; relay that as it is written rather than as an empty result.";

const DEFAULT_TASK_DESCRIPTION =
  "The complete task, written for someone who cannot see this conversation: what to " +
  "find out, and what would count as an answer.";

export interface SubagentToolDeps {
  // A shared round budget for the caller's whole turn.
  quota?: SubagentQuota;
}

const NO_STATS = { rounds: 0, toolCalls: 0, toolSuccesses: 0, toolFailures: [] };

export function subagentTool(definition: SubagentDefinition, deps: SubagentToolDeps = {}): DurableTool {
  if (!TOOL_NAME.test(definition.name)) {
    throw new Error(
      `sub-agent name '${definition.name}' is not a safe tool name: use lowercase letters, digits and underscores`,
    );
  }
  const tokenCap = definition.briefTokenCap ?? DEFAULT_BRIEF_TOKEN_CAP;
  return {
    name: definition.name,
    label: () => definition.label,
    effect: "read",
    replay: "safe",
    description: `${definition.description.trim()}\n\n${DELEGATION_NOTE}`,
    parameters: Type.Object({
      task: Type.String({
        description: definition.taskDescription ?? DEFAULT_TASK_DESCRIPTION,
      }),
    }),
    childTools: definition.tools,
    execute: async () => {
      throw new Error(`${definition.name} runs on the durable runtime only`);
    },
    runInDurable: async (args, { api, runtime }, context) => {
      const task = String(args.task ?? "").trim();
      if (!task) throw new Error(`${definition.name} needs a task.`);
      const want = definition.maxRounds ?? DEFAULT_SUBAGENT_ROUNDS;
      const reserved = deps.quota ? deps.quota.grant(want) : want;
      let used = 0;
      let result: SubagentBrief;
      try {
        if (reserved <= 0) {
          result = briefFor({ definition, reserved, stats: NO_STATS }, { kind: "out-of-budget" });
        } else {
          const model = await subagentModel(definition.model);
          const spec = childSpec(
            {
              name: definition.name,
              systemPrompt: subagentSystemPrompt(definition, tokenCap),
              tools: definition.tools,
              maxRounds: reserved,
              purpose: definition.purpose ?? "chat",
              task,
            },
            model,
          );
          const child = await runTaskChild(runtime, api, spec, context);
          used = child.stats.rounds;
          if (child.end.kind === "aborted") throw new StoppedError();
          result = briefFor({ definition, reserved, stats: child.stats }, turnOutcome(child));
        }
      } finally {
        deps.quota?.settle(reserved, used);
      }
      // A run that established nothing is thrown, not returned: only a thrown
      // result is marked as an error the model has to account for (same
      // discipline as src/reading/papers/search-tool.ts).
      if (!result.usable) throw new Error(result.brief);
      return result.brief;
    },
  };
}
