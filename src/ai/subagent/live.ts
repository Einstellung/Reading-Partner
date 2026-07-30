// The real sub-agent turn: the app's configured provider through runAgentTurn,
// authenticated exactly like every other call. Everything that can be decided
// without a provider lives in run.ts; this file is the wiring, and is deliberately
// the only part of the capability a test cannot reach.

import { runAgentTurn } from "../agent";
import { resolveModel } from "../model-call";
import { createTurnSettler } from "./turn";
import type { SubagentTurnFn } from "./types";

// A sub-agent resolves the background-pipeline thinking setting rather than the
// chat one: it is unattended work, and the reader is waiting on a brief rather
// than watching it think. A definition that wants something else — a cheaper
// model for mechanical lookups — sets `model` and this never runs.
const SUBAGENT_THINKING = "prep" as const;

export const runSubagentTurnLive: SubagentTurnFn = async (request) => {
  const model = request.model ?? (await resolveModel(SUBAGENT_THINKING));
  const settler = createTurnSettler(request.signal, request.onRound);
  try {
    void runAgentTurn({
      providerId: model.providerId,
      modelId: model.modelId,
      systemPrompt: request.systemPrompt,
      // One user message and nothing else. The isolation is this line.
      messages: [{ role: "user", text: request.task }],
      tools: request.tools,
      signal: request.signal,
      reasoning: model.reasoning,
      maxRounds: request.maxRounds,
      purpose: request.purpose,
      ...settler.callbacks,
    });
    return await settler.outcome;
  } finally {
    settler.dispose();
  }
};
