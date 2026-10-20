// A bell answered at the door (docs/55, docs/soul/87): the day's one
// conversation at the door, on the device's durable runtime like the reader's
// own turns there (soul/door-durable.ts). The bell is the turn's input over
// the conversation as the day's file holds it; the soul's desk is laid without
// the surface's card-raising tools, as for a turn resumed after a restart. The
// waiting, the headless run and the open conversation are place-bell.ts's.

import type { ThreadOrigin } from "../../legion/durable/extension";
import { replayableHistory } from "../../ai/turn-view/turn-rows";
import { appendMessage, flushThreads, newThreadMessageId, type ThreadMessage } from "../../platform/app/threads";
import {
  doorKey,
  doorOrigin,
  doorThreadKey,
  doorWatchingNow,
  openDoorThread,
  prepareDoorTurn,
  registerReplyAppend,
  registerTurnDelivery,
  type ReplyAppend,
  type TurnDelivery,
  type TurnDeliveryOutcome,
} from "../../soul";
import { readingDurable } from "./durable-runtime";
import { registerDoorThinkDesk } from "./door-think";
import { appPlaceBellDeps, deliverPlaceBell, type PlaceBellDeps } from "./place-bell";

export interface DoorBellDeps extends PlaceBellDeps {
  /** The day's conversation at the door, made when the bell is the first thing said that day. */
  openThread(date: string): Promise<{ id: string }>;
  prepare: typeof prepareDoorTurn;
  watching(origin: ReturnType<typeof doorOrigin>): boolean;
}

function appDoorBellDeps(): DoorBellDeps {
  return {
    ...appPlaceBellDeps(readingDurable),
    openThread: (date) => openDoorThread(date),
    prepare: (input) => prepareDoorTurn(input),
    watching: doorWatchingNow,
  };
}

/** Answer a bell in the day's conversation at the door. */
export async function deliverDoorBell(
  input: TurnDelivery,
  deps: DoorBellDeps = appDoorBellDeps(),
): Promise<TurnDeliveryOutcome | null> {
  if (input.origin.place !== "door") return null;
  const { date } = input.origin;
  const thread = await deps.openThread(date);
  const origin = doorOrigin(date, thread.id);
  const file = doorKey(date);
  return deliverPlaceBell(
    input,
    {
      key: doorThreadKey(origin),
      origin: origin as unknown as ThreadOrigin,
      address: { key: file, threadId: thread.id },
      async assemble(bell, signal) {
        const said = replayableHistory([...(deps.threads.messages(file, thread.id) ?? [])]);
        const prepared = await deps.prepare({
          threadId: thread.id,
          date,
          history: [...said, { role: "user", text: bell }],
          signal,
        });
        if (prepared.kind === "no-provider") return { failed: "no model is configured" };
        if (prepared.kind === "refused") return { failed: prepared.text };
        // Aborted while the soul was being read: nothing was sent and the bell stays queued.
        if (prepared.kind === "aborted") return { failed: "stopped" };
        return {
          key: prepared.key,
          origin: prepared.origin as unknown as ThreadOrigin,
          conversation: thread.id,
          surface: "bell",
          systemPrompt: prepared.systemPrompt,
          tools: prepared.tools,
          model: prepared.model,
          ...(prepared.thinkingLevel ? { thinkingLevel: prepared.thinkingLevel } : {}),
        };
      },
      watching: () => deps.watching(origin),
    },
    deps,
  );
}

export interface DoorReplyDeps {
  openThread(date: string): Promise<{ id: string }>;
  append(key: string, threadId: string, message: ThreadMessage): void;
  flush(): Promise<void>;
}

const appDoorReplyDeps: DoorReplyDeps = {
  openThread: (date) => openDoorThread(date),
  append: (key, threadId, message) => {
    appendMessage(key, threadId, message);
  },
  flush: flushThreads,
};

/**
 * Append a verbatim run's output (docs/companion/136) to the day's door
 * conversation as the soul's reply, stamped with the run it came back from.
 */
export async function appendDoorReply(input: ReplyAppend, deps: DoorReplyDeps = appDoorReplyDeps): Promise<boolean> {
  if (input.origin.place !== "door") return false;
  const { date } = input.origin;
  const thread = await deps.openThread(date);
  deps.append(doorKey(date), thread.id, {
    id: newThreadMessageId(),
    role: "ai",
    text: input.text,
    ts: input.at,
    origin: { runId: input.runId },
  });
  await deps.flush();
  return true;
}

/**
 * Say that a bell with nowhere else to go is answered at the door, and that a
 * think run handed off from a call there gets the door's reads (door-think.ts)
 * and lands its answer in the day's conversation. The undo is for tests.
 */
export function registerDoorDelivery(): () => void {
  const delivery = registerTurnDelivery("door", (input) => deliverDoorBell(input));
  const reply = registerReplyAppend("door", (input) => appendDoorReply(input));
  const thinkDesk = registerDoorThinkDesk();
  return () => {
    delivery();
    reply();
    thinkDesk();
  };
}
