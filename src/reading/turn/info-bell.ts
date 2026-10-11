// A bell answered in a day's briefing conversation or in the meals
// conversation (docs/68, docs/73, docs/soul/87), on the device's durable
// runtime like the reader's own turns there (info/briefer/info-durable.ts). The
// bell is the turn's input over the conversation as its file holds it; the
// secretary's desk is laid the way it is for a turn resumed after a restart
// (info/briefer/deliver.ts): no card-drawing tools, no briefing run. The
// waiting, the headless run and the open conversation are place-bell.ts's.

import type { BoxOrigin } from "../../box";
import type { DeskMessage } from "../../desk";
import { modelIdFor } from "../../ai/model-tier";
import { replayableHistory } from "../../ai/turn-view/turn-rows";
import type { ThreadOrigin } from "../../legion/durable/extension";
import { toReasoning, type Settings } from "../../platform/app/settings";
import { createThread, getThread, loadThreads } from "../../platform/app/threads";
import { registerTurnDelivery, type AssembledTurn, type TurnDelivery, type TurnDeliveryOutcome } from "../../soul";
import { briefingThreadId } from "../../info/briefer/anchors";
import { layBriefingTurn, layMealsTurn } from "../../info/briefer/deliver";
import {
  infoAddress,
  infoAssemblies,
  infoThreadKey,
  infoWatchingNow,
  type AssembledInfoTurn,
  type InfoOrigin,
  type MealsOrigin,
} from "../../info/briefer/info-durable";
import { readingDurable } from "./durable-runtime";
import { appPlaceBellDeps, deliverPlaceBell, type PlaceBellDeps } from "./place-bell";

export interface InfoBellDeps extends PlaceBellDeps {
  /** The conversation's thread, made when the bell is the first thing to land in it. */
  openThread(key: string, threadId: string): Promise<void>;
  /** The secretary's desk over `messages`, which end with the bell. */
  lay(
    origin: InfoOrigin | MealsOrigin,
    input: { settings: Settings; messages: DeskMessage[]; signal: AbortSignal; origin: BoxOrigin },
  ): Promise<AssembledTurn | null>;
  /** Where the place finds the history and the desk while the turn runs. */
  assembled: Map<string, AssembledInfoTurn>;
  watching(key: string): boolean;
}

function appInfoBellDeps(): InfoBellDeps {
  return {
    ...appPlaceBellDeps(readingDurable),
    openThread: async (key, threadId) => {
      await loadThreads(key).catch(() => ({}));
      if (!getThread(key, threadId)) createThread(key, "info", threadId);
    },
    lay: (origin, input) => (origin.place === "meals" ? layMealsTurn(input) : layBriefingTurn(origin.date, input)),
    assembled: infoAssemblies,
    watching: infoWatchingNow,
  };
}

/** The conversation a bell asked about in a briefing or the meals conversation is answered in. */
function conversationOf(origin: BoxOrigin): InfoOrigin | MealsOrigin | null {
  if (origin.place === "briefing") return { place: "info", date: origin.date, threadId: briefingThreadId(origin.date) };
  if (origin.place === "meals") return { place: "meals" };
  return null;
}

/** Answer a bell in the day's briefing conversation or the meals conversation. */
export async function deliverInfoBell(
  input: TurnDelivery,
  deps: InfoBellDeps = appInfoBellDeps(),
): Promise<TurnDeliveryOutcome | null> {
  const origin = conversationOf(input.origin);
  if (!origin) return null;
  const key = infoThreadKey(origin);
  const address = infoAddress(origin);
  // A run delegated from the launch card can come back before anything was ever written to that day's thread.
  await deps.openThread(address.key, address.threadId);
  return deliverPlaceBell(
    input,
    {
      key,
      origin: origin as unknown as ThreadOrigin,
      address,
      async assemble(bell, signal) {
        const { settings } = input;
        if (!settings.defaultProviderId || !settings.defaultModelId) return { failed: "no model is configured" };
        const said = replayableHistory([...(deps.threads.messages(address.key, address.threadId) ?? [])]);
        const turn = await deps.lay(origin, {
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
          origin: origin as unknown as ThreadOrigin,
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

/** Say that a run delegated from a briefing or the meals conversation is answered there. The undo is for tests. */
export function registerInfoDelivery(): () => void {
  const briefing = registerTurnDelivery("briefing", (input) => deliverInfoBell(input));
  const meals = registerTurnDelivery("meals", (input) => deliverInfoBell(input));
  return () => {
    briefing();
    meals();
  };
}
