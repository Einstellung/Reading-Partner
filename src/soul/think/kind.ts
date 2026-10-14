// The `think` kind (docs/companion/136 delegate): a question too heavy for a
// voice call's front, handed to the soul sitting at the call's own desk.
//
// An agent worker, `local` tier, handed work only by a voice call. The body is a sub-agent over the
// read-only tools of the desk at `deliverTo` — the place registers them here,
// since the soul cannot open a domain's desk itself — and no write tool at all:
// there is no confirmation card on a call. It runs on the talk model at the
// talk thinking level (ai/model-tier.ts `think`): the reader is on the call
// waiting when it is handed over.
//
// Its output is the answer, word for word: appended to the conversation and put
// in the box with no turn in between (soul/bell.ts landVerbatim). So it is
// written to be read aloud.

import type { BoxOrigin } from "../../box";
import { resolveModel } from "../../ai/model-call";
import type { AgentTool } from "../../legion/durable/contract";
import {
  delegableWorkerKinds,
  registerWorker,
  registeredWorkerKinds,
  type Worker,
} from "../../legion/runner/worker";
import { agentWorker, type AgentWorkerDeps, type SubagentDefinition, type SubagentModel } from "../../legion/subagent";
import { declareVerbatim, parseOrigin } from "../delivery";
import { THINK_KIND } from "./contract";

/** Model turns one think run gets. */
export const THINK_ROUNDS = 8;

/** Room for the longest answer the prompt asks for (600 characters of Chinese), with margin. */
export const THINK_TOKEN_CAP = 2000;

export const THINK_PROMPT = [
  "You are answering one question the reader asked during a voice call. Somebody else is",
  "keeping them company on the call; what you write is read aloud to them word for word,",
  "or opened on their screen, later.",
  "",
  "Work it out with the tools you have where looking something up helps; reason it",
  "through where it does not. Do not invent facts: say plainly what you could not settle.",
  "",
  "Write for the ear. The first sentence is the conclusion. 150 to 600 characters (about",
  "60 to 250 words in English). No tables, no code blocks, no headings; a list at most one",
  "level deep. No preamble, no sign-off, no remarks about the task or the call. Write in",
  "the language the task is written in.",
].join("\n");

/** The read-only tools of one place's desk, for a think run delivered back there. */
export type ThinkDesk = (origin: BoxOrigin) => Promise<AgentTool[]>;

const DESKS = new Map<BoxOrigin["place"], ThinkDesk>();

/** Say which tools a think run gets at one place. Returns the undo. */
export function registerThinkDesk(place: BoxOrigin["place"], desk: ThinkDesk): () => void {
  DESKS.set(place, desk);
  return () => {
    if (DESKS.get(place) === desk) DESKS.delete(place);
  };
}

/**
 * The tools a think run at this place is given: what the place registered,
 * reads only. A place that registered nothing gives none, and the run reasons
 * without lookups.
 */
export async function thinkTools(origin: BoxOrigin | null): Promise<AgentTool[]> {
  const desk = origin ? DESKS.get(origin.place) : undefined;
  if (!desk || !origin) return [];
  return (await desk(origin)).filter((tool) => tool.effect === "read");
}

/** The sub-agent one think run is. */
export function thinkAgent(tools: AgentTool[], model?: SubagentModel): SubagentDefinition {
  return {
    name: THINK_KIND,
    description: "Think one question through and write the answer to be read aloud.",
    label: "Thinking it over",
    systemPrompt: THINK_PROMPT,
    // The prompt above is the whole contract: the output is the answer itself.
    briefContract: false,
    tools,
    maxRounds: THINK_ROUNDS,
    // Reasoning is the job; a lookup is a help, not a precondition.
    evidence: "optional",
    briefTokenCap: THINK_TOKEN_CAP,
    ...(model ? { model } : {}),
  };
}

export interface ThinkWorkerDeps extends AgentWorkerDeps {
  /** The model the run is sent to. The talk tier and its thinking level unless a test hands one in. */
  model?: () => Promise<SubagentModel>;
}

async function talkModel(): Promise<SubagentModel> {
  const resolved = await resolveModel("think");
  return {
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    ...(resolved.reasoning ? { reasoning: resolved.reasoning } : {}),
  };
}

/** One think run: the desk it is delivered to decides its tools. */
export function thinkWorker(deps: ThinkWorkerDeps = {}): Worker {
  return (brief, ctx) => {
    const origin = parseOrigin(ctx.run.deliverTo);
    const agent = async () => thinkAgent(await thinkTools(origin), await (deps.model ?? talkModel)());
    return agentWorker({ agent, rounds: THINK_ROUNDS }, { ...deps, agent })(brief, ctx);
  };
}

/** Hand legion the think kind and declare its output the answer. Returns the undo of the declaration. */
export function registerThinkWorker(deps: ThinkWorkerDeps = {}): () => void {
  registerWorker({
    kind: THINK_KIND,
    tier: "local",
    agent: true,
    // Only a voice call hands work to it (buildCallDelegateTool): a soul turn
    // at a book or the door has no conversation-side landing for a verbatim
    // answer, so the ordinary delegate catalogue leaves it out.
    delegable: false,
    run: thinkWorker(deps),
  });
  return declareVerbatim(THINK_KIND);
}

/**
 * The kinds a voice call may hand work to: think where this device registered
 * it, then everything the soul's ordinary catalogue offers.
 */
export function callKinds(): string[] {
  const delegable = delegableWorkerKinds().filter((kind) => kind !== THINK_KIND);
  return registeredWorkerKinds().includes(THINK_KIND) ? [THINK_KIND, ...delegable] : delegable;
}
