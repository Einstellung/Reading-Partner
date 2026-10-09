// One turn the reader types at the door (docs/61): the half of a chat send that
// does not need React. The surface has already shown the reader's line and
// written it to the day's thread; this lays the empty desk, assembles the turn
// over the conversation so far and runs it into the handlers the surface drew a
// reply row for.
//
// What it cannot do it says, rather than writing into a row itself: the words
// for "no model is set up" and the refusal belong to the surface showing them.

import type { AgentCallbacks } from "../legion/execute/contract";
import { runAgentTurn, type AgentTool } from "../legion/execute/turn";
import type { DeskMessage } from "../desk";
import type { TopicProposalSurface } from "../memory";
import { loadSettings, toReasoning, type Settings } from "../platform/app/settings";
import type { ProviderId } from "../ai/auth/provider-ids";
import { modelIdFor } from "../ai/model-tier";
import { openDoorTurn, type DoorTurnInput } from "./door";
import { soulHarness } from "./harness";
import type { AssembledTurn } from "./turn";

type TurnHandlers = Pick<
  AgentCallbacks,
  "onDelta" | "onThinking" | "onToolStart" | "onToolEnd" | "onDone" | "onError" | "onRefusal"
>;

export interface DoorSendInput {
  /** The day's conversation (door.ts openDoorThread). */
  threadId: string;
  date: string;
  /** The conversation so far, ending with the line just sent. */
  history: readonly DeskMessage[];
  signal: AbortSignal;
  handlers: TurnHandlers;
  /** What the surface mounts beside the soul's own set. */
  tools?: readonly AgentTool[];
  topic?: TopicProposalSurface;
}

export type DoorSendOutcome =
  /** Handed to the model; the handlers carry the rest. */
  | { kind: "sent" }
  /** No provider or model chosen in settings. */
  | { kind: "no-provider" }
  /** Too big to leave the model room to answer. Retrying changes nothing. */
  | { kind: "refused"; text: string }
  /** The reader stopped it while the soul was being read. */
  | { kind: "aborted" };

export interface DoorSendDeps {
  loadSettings(): Promise<Settings>;
  openTurn(input: DoorTurnInput): Promise<AssembledTurn | null>;
  runTurn: typeof runAgentTurn;
}

const LIVE: DoorSendDeps = { loadSettings, openTurn: openDoorTurn, runTurn: runAgentTurn };

export async function sendAtTheDoor(
  input: DoorSendInput,
  deps: DoorSendDeps = LIVE,
): Promise<DoorSendOutcome> {
  const settings = await deps.loadSettings();
  if (!settings.defaultProviderId || !settings.defaultModelId) return { kind: "no-provider" };
  const turn = await deps.openTurn({
    settings,
    threadId: input.threadId,
    date: input.date,
    messages: input.history,
    signal: input.signal,
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
  });
  if (!turn) return { kind: "aborted" };
  if (turn.refusal) return { kind: "refused", text: turn.refusal };
  void deps.runTurn({
    providerId: settings.defaultProviderId as ProviderId,
    // The reader is waiting on this one (ai/model-tier.ts).
    modelId: modelIdFor(settings, "talk") as string,
    systemPrompt: turn.systemPrompt,
    messages: turn.messages,
    tools: turn.tools,
    reasoning: toReasoning(settings.chatThinking),
    signal: input.signal,
    telemetry: { surface: "door", thread: input.threadId },
    harness: soulHarness(),
    // A run delegated here is answered here (docs/68).
    ...(turn.origin ? { deliverTo: turn.origin } : {}),
    ...input.handlers,
  });
  return { kind: "sent" };
}
