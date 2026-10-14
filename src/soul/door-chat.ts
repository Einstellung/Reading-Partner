// One turn the reader types at the door (docs/61): the half of a chat send that
// does not need React. The surface has already shown the reader's line and
// written it to the day's thread; this lays the empty desk and assembles the
// turn over the conversation so far for the durable runtime (door-durable.ts).
//
// What it cannot do it says, rather than writing into a row itself: the words
// for "no model is set up" and the refusal belong to the surface showing them.

import type { AgentTool } from "../legion/durable/contract";
import type { DeskMessage } from "../desk";
import type { TopicProposalSurface } from "../memory";
import { loadSettings, toReasoning, type Settings } from "../platform/app/settings";
import { modelIdFor } from "../ai/model-tier";
import { openDoorTurn, type DoorTurnInput } from "./door";
import type { AssembledTurn } from "./turn";
import { doorAssemblies, doorOrigin, doorThreadKey, type DoorOrigin } from "./door-durable";

export interface DoorSendInput {
  /** The day's conversation (door.ts openDoorThread). */
  threadId: string;
  date: string;
  /** The conversation so far, ending with the line just sent. */
  history: readonly DeskMessage[];
  signal: AbortSignal;
  /** What the surface mounts beside the soul's own set. */
  tools?: readonly AgentTool[];
  topic?: TopicProposalSurface;
  /** What the surface tells the model beside its tools. */
  prompt?: string;
}

export interface DoorSendDeps {
  loadSettings(): Promise<Settings>;
  openTurn(input: DoorTurnInput): Promise<AssembledTurn | null>;
}

const LIVE: DoorSendDeps = { loadSettings, openTurn: openDoorTurn };

/** A turn at the door assembled for the durable runtime (door-durable.ts), or why there is none. */
export type DoorTurnPrepared =
  | {
      kind: "turn";
      key: string;
      origin: DoorOrigin;
      systemPrompt: string;
      /** The reader's line as the model reads it (with the app's note on links). */
      line: string;
      tools: AgentTool[];
      notice: string;
      model: { provider: string; modelId: string };
      thinkingLevel?: NonNullable<ReturnType<typeof toReasoning>>;
    }
  | { kind: "no-provider" }
  | { kind: "refused"; text: string }
  | { kind: "aborted" };

/**
 * Assemble one turn at the door for the durable runtime: the soul's desk over
 * the conversation so far, ending with the line just sent. The history before
 * that line and the desk's tools are kept where the door's place finds them
 * (door-durable.ts) while the turn runs.
 */
export async function prepareDoorTurn(
  input: DoorSendInput,
  deps: DoorSendDeps = LIVE,
): Promise<DoorTurnPrepared> {
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
    ...(input.prompt ? { prompt: input.prompt } : {}),
  });
  if (!turn) return { kind: "aborted" };
  if (turn.refusal) return { kind: "refused", text: turn.refusal };
  const line = turn.messages[turn.messages.length - 1];
  if (!line || line.role !== "user") throw new Error("a door turn must end with the reader's line");
  const origin = doorOrigin(input.date, input.threadId);
  const key = doorThreadKey(origin);
  doorAssemblies.set(key, { history: turn.messages.slice(0, -1), tools: turn.tools });
  const thinkingLevel = toReasoning(settings.chatThinking);
  return {
    kind: "turn",
    key,
    origin,
    systemPrompt: turn.systemPrompt,
    line: line.text,
    tools: turn.tools,
    notice: turn.notice,
    // The reader is waiting on this one (ai/model-tier.ts).
    model: { provider: settings.defaultProviderId, modelId: modelIdFor(settings, "talk") as string },
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}
