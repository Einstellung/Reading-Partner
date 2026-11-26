// A bell answered in the meals conversation (docs/68, docs/73, docs/soul/87), on
// the device's durable runtime like the reader's own turns there
// (meals/conversation/durable.ts). The bell is the turn's input over the
// conversation as its file holds it; the meals desk is laid the way it is for a
// turn resumed after a restart (meals/conversation/deliver.ts): no card-drawing
// tools. The waiting, the headless run and the open conversation are
// place-bell.ts's.

import type { BoxOrigin } from "../../box";
import type { DeskMessage } from "../../desk";
import { modelIdFor } from "../../ai/model-tier";
import { replayableHistory } from "../../ai/turn-view/turn-rows";
import type { ThreadOrigin } from "../../legion/durable/extension";
import { toReasoning, type Settings } from "../../platform/app/settings";
import {
  appendMessage,
  createThread,
  flushThreads,
  getThread,
  loadThreads,
  newThreadMessageId,
  type ThreadMessage,
} from "../../platform/app/threads";
import {
  registerReplyAppend,
  registerTurnDelivery,
  type AssembledTurn,
  type ReplyAppend,
  type TurnDelivery,
  type TurnDeliveryOutcome,
} from "../../soul";
import { registerThinkDesk, type ThinkDeskLaid } from "../../soul/think";
import { layMealsTurn } from "../../meals/conversation/deliver";
import {
  MEALS_ADDRESS,
  MEALS_CONVERSATION_KEY,
  MEALS_ORIGIN,
  mealsAssemblies,
  mealsWatchingNow,
  type AssembledMealsTurn,
} from "../../meals/conversation/durable";
import { buildLiveMealsReadTools } from "../../meals/read-live";
import { MEALS_READ_PROMPT } from "../../meals/read-tools";
import { readingDurable } from "./durable-runtime";
import { appPlaceBellDeps, deliverPlaceBell, type PlaceBellDeps } from "./place-bell";

export interface MealsBellDeps extends PlaceBellDeps {
  /** The conversation's thread, made when the bell is the first thing to land in it. */
  openThread(key: string, threadId: string): Promise<void>;
  /** The meals desk over `messages`, which end with the bell. */
  lay(input: { settings: Settings; messages: DeskMessage[]; signal: AbortSignal; origin: BoxOrigin }): Promise<AssembledTurn | null>;
  /** Where the place finds the history and the desk while the turn runs. */
  assembled: Map<string, AssembledMealsTurn>;
  watching(key: string): boolean;
}

// The thread's kind is what the file has always said; it is on disk.
async function openMealsThread(key: string, threadId: string): Promise<void> {
  await loadThreads(key).catch(() => ({}));
  if (!getThread(key, threadId)) createThread(key, "info", threadId);
}

function appMealsBellDeps(): MealsBellDeps {
  return {
    ...appPlaceBellDeps(readingDurable),
    openThread: openMealsThread,
    lay: (input) => layMealsTurn(input),
    assembled: mealsAssemblies,
    watching: mealsWatchingNow,
  };
}

/** Answer a bell in the meals conversation. */
export async function deliverMealsBell(
  input: TurnDelivery,
  deps: MealsBellDeps = appMealsBellDeps(),
): Promise<TurnDeliveryOutcome | null> {
  if (input.origin.place !== "meals") return null;
  const key = MEALS_CONVERSATION_KEY;
  const address = MEALS_ADDRESS;
  // A bell can come back before anything was ever written to the thread.
  await deps.openThread(address.key, address.threadId);
  return deliverPlaceBell(
    input,
    {
      key,
      origin: MEALS_ORIGIN as unknown as ThreadOrigin,
      address,
      async assemble(bell, signal) {
        const { settings } = input;
        if (!settings.defaultProviderId || !settings.defaultModelId) return { failed: "no model is configured" };
        const said = replayableHistory([...(deps.threads.messages(address.key, address.threadId) ?? [])]);
        const turn = await deps.lay({
          settings,
          messages: [...said, { role: "user", text: bell }],
          signal,
          origin: input.origin,
        });
        // Aborted while the desk was being laid: nothing was sent and the bell stays queued.
        if (!turn) return { failed: "stopped" };
        if (turn.refusal) return { failed: turn.refusal };
        deps.assembled.set(key, { history: turn.messages.slice(0, -1), tools: turn.tools });
        const thinkingLevel = toReasoning(settings.chatThinking);
        return {
          key,
          origin: MEALS_ORIGIN as unknown as ThreadOrigin,
          conversation: address.threadId,
          surface: "bell",
          systemPrompt: turn.systemPrompt,
          tools: turn.tools,
          model: { provider: settings.defaultProviderId, modelId: modelIdFor(settings, "talk") as string },
          ...(thinkingLevel ? { thinkingLevel } : {}),
        };
      },
      watching: () => deps.watching(key),
    },
    deps,
  );
}

export interface MealsReplyDeps {
  openThread(key: string, threadId: string): Promise<void>;
  append(key: string, threadId: string, message: ThreadMessage): void;
  flush(): Promise<void>;
}

const appMealsReplyDeps: MealsReplyDeps = {
  openThread: openMealsThread,
  append: (key, threadId, message) => {
    appendMessage(key, threadId, message);
  },
  flush: flushThreads,
};

/**
 * Append a verbatim run's output (docs/companion/136 回来) to the meals
 * conversation, as the soul's reply, stamped with the run it came back from.
 */
export async function appendMealsReply(input: ReplyAppend, deps: MealsReplyDeps = appMealsReplyDeps): Promise<boolean> {
  if (input.origin.place !== "meals") return false;
  const { key, threadId } = MEALS_ADDRESS;
  await deps.openThread(key, threadId);
  deps.append(key, threadId, {
    id: newThreadMessageId(),
    role: "ai",
    text: input.text,
    ts: input.at,
    origin: { runId: input.runId },
  });
  await deps.flush();
  return true;
}

/** A think run delivered to the meals conversation reads the meals data, and nothing else. */
async function mealsThinkDesk(): Promise<ThinkDeskLaid> {
  return { tools: buildLiveMealsReadTools(), prompt: MEALS_READ_PROMPT };
}

/** Say that a run delegated from the meals conversation is answered there. The undo is for tests. */
export function registerMealsBell(): () => void {
  const turn = registerTurnDelivery("meals", (input) => deliverMealsBell(input));
  const reply = registerReplyAppend("meals", (input) => appendMealsReply(input));
  const think = registerThinkDesk("meals", mealsThinkDesk);
  return () => {
    turn();
    reply();
    think();
  };
}
