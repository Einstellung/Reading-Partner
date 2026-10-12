// A sub-agent definition as a child conversation's spec, and the child's end
// as a turn outcome (legion/durable/child.ts runs it).

import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { resolveModel } from "../../ai/model-call";
import type { ChildResult, ChildSpec } from "../durable/child";
import { StoppedError } from "../stop";
import type { SubagentModel, SubagentTurnOutcome, SubagentTurnRequest } from "./types";

// A sub-agent resolves the background-pipeline thinking setting rather than the
// chat one: it is unattended work. A definition that wants something else sets
// `model` and this never runs.
const SUBAGENT_THINKING = "prep" as const;

export async function subagentModel(model: SubagentModel | undefined): Promise<SubagentModel> {
  return model ?? (await resolveModel(SUBAGENT_THINKING));
}

/** What a child conversation is given for one sub-agent run. */
export function childSpec(
  request: Pick<SubagentTurnRequest, "name" | "systemPrompt" | "tools" | "maxRounds" | "purpose" | "task">,
  model: SubagentModel,
): ChildSpec {
  return {
    name: request.name,
    instructions: request.systemPrompt,
    tools: request.tools,
    model: { provider: model.providerId, modelId: model.modelId },
    ...(model.reasoning ? { thinkingLevel: model.reasoning as ModelThinkingLevel } : {}),
    maxRounds: request.maxRounds,
    purpose: request.purpose,
    task: request.task,
  };
}

/** The child's end as a turn outcome; a stopped child is a StoppedError, never a brief. */
export function turnOutcome(result: ChildResult): SubagentTurnOutcome {
  if (result.end.kind === "aborted") throw new StoppedError();
  return { ...result.end, stats: result.stats };
}
