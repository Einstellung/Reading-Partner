// The parent-side half: a sub-agent definition mounted as one AgentTool, so from
// the calling model's point of view delegating a whole investigation looks like
// calling a tool that returns a summary.
//
// What the parent's context gains from this is one tool result of at most
// briefTokenCap tokens, whatever the run cost internally — which is the entire
// reason the capability exists.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../agent";
import { runSubagent, type SubagentDeps, type SubagentRequest } from "./run";
import type { SubagentDefinition } from "./types";

// pi-ai rewrites tool names that match Claude Code's canonical set (Read, Bash,
// WebFetch, WebSearch …) on the OAuth channel, so a sub-agent called `WebSearch`
// would go out impersonating a different tool with different semantics
// (docs/24). Lowercase-with-underscores cannot collide, so the shape is enforced
// where the tool is built rather than left as a comment for the next caller.
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

export interface SubagentToolDeps extends SubagentDeps {
  // The caller's own abort signal — the same one its turn runs under, so a
  // hangup kills the sub-agent with the turn.
  signal?: AbortSignal;
  onProgress?: SubagentRequest["onProgress"];
}

export function subagentTool(definition: SubagentDefinition, deps: SubagentToolDeps): AgentTool {
  if (!TOOL_NAME.test(definition.name)) {
    throw new Error(
      `sub-agent name '${definition.name}' is not a safe tool name: use lowercase letters, digits and underscores`,
    );
  }
  return {
    name: definition.name,
    description: `${definition.description.trim()}\n\n${DELEGATION_NOTE}`,
    parameters: Type.Object({
      task: Type.String({
        description: definition.taskDescription ?? DEFAULT_TASK_DESCRIPTION,
      }),
    }),
    execute: async (args) => {
      const task = String(args.task ?? "").trim();
      if (!task) throw new Error(`${definition.name} needs a task.`);
      const result = await runSubagent(
        { definition, task, signal: deps.signal, onProgress: deps.onProgress },
        deps,
      );
      // A run that established nothing is thrown, not returned. Same discipline
      // as src/reading/papers/search-tool.ts: a tool result the model reads as an
      // answer is how "the search stopped early" becomes "the literature is
      // silent". The text is identical either way — only a thrown result is
      // marked as an error the model has to account for, and shows up red in the
      // caller's tool trace instead of vanishing on success.
      if (!result.usable) throw new Error(result.brief);
      return result.brief;
    },
  };
}
