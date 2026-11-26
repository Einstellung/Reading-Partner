// Giving a run's answer back in the meals conversation (docs/68, docs/73), and
// the desk a meals turn resumed after a restart calls its tools through
// (durable.ts). Nobody is watching either of them and there is no screen, so
// the tools that draw a card have nowhere to draw it.

import { bindItemTools, openDesk, type DeskMessage } from "../../desk";
import type { AgentTool } from "../../legion/durable/contract";
import type { Settings } from "../../platform/app/settings";
import { createThread, getThread, loadThreads } from "../../platform/app/threads";
import type { BoxOrigin } from "../../box";
import { assembleTurn, registerDelivery, type AssembledTurn, type Delivery, type DeliveryInput } from "../../soul";
import { INFO_MEALS_KIND } from "../desk";
import { buildLiveMealsTools } from "../live";
import { loadMeals } from "../plan/store";
import type { MealsState } from "../plan/types";
import { todayLocal } from "../today";
import { MEALS_BOOK_ID, MEALS_THREAD_ID, mealsAnchor } from "./anchor";
import { MEALS_ROLE_ID } from "./role";

export interface MealsDeliveryDeps {
  /** The household and the week. Off this device's own file unless a test hands one in. */
  state?: () => Promise<MealsState>;
  /** The host's local date. */
  today?: () => string;
  /** The meals tools for this turn. None of them draw, because nothing is watching. */
  tools?: () => Promise<AgentTool[]>;
}

// The meals set as a turn nobody is watching can hold it: a proposal's card has
// no screen to go to, and no screen is there to be told to reload.
const liveMealsTools = async (): Promise<AgentTool[]> =>
  buildLiveMealsTools({
    threadId: MEALS_THREAD_ID,
    onMealsCard: () => {},
    today: () => todayLocal(),
    changed: () => {},
  });

/**
 * The meals role's turn over the meals desk, with the tools a turn nobody is
 * watching can hold: a bell's answer, and the desk a meals turn resumed after a
 * restart calls its tools through (durable.ts).
 */
export async function layMealsTurn(
  input: { settings: Settings; messages: DeskMessage[]; signal?: AbortSignal; origin?: BoxOrigin },
  deps: MealsDeliveryDeps = {},
): Promise<AssembledTurn | null> {
  const state = await (deps.state ?? (() => loadMeals()))();
  const anchor = mealsAnchor(state, (deps.today ?? todayLocal)());
  const desk = await openDesk(bindItemTools(anchor.desk, INFO_MEALS_KIND, deps.tools ?? liveMealsTools), {
    settings: input.settings,
    thread: { key: MEALS_BOOK_ID, id: MEALS_THREAD_ID },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return assembleTurn({
    desk,
    messages: input.messages,
    role: MEALS_ROLE_ID,
    ...(input.origin ? { origin: input.origin } : {}),
  });
}

/**
 * Assemble the turn that answers a bell in the meals conversation: the one
 * standing thread, on the meals desk with its tools. Null when it could not be
 * assembled — the bell then falls back to the door.
 */
export async function openMealsDelivery(
  input: DeliveryInput,
  deps: MealsDeliveryDeps = {},
): Promise<Delivery | null> {
  if (input.origin.place !== "meals") return null;
  const key = MEALS_BOOK_ID;
  const threadId = MEALS_THREAD_ID;
  await loadThreads(key).catch(() => ({}));
  const existing = getThread(key, threadId);
  const history: DeskMessage[] = (existing?.messages ?? []).map((m) => ({
    role: m.role,
    text: m.text,
  }));
  // The thread's kind is what the file has always said; it is on disk.
  if (!existing) createThread(key, "info", threadId);

  const turn = await layMealsTurn(
    {
      settings: input.settings,
      messages: [...history, { role: "user", text: input.bell }],
      ...(input.signal ? { signal: input.signal } : {}),
    },
    deps,
  );
  if (!turn) return null;
  return {
    key,
    threadId,
    turn: {
      systemPrompt: turn.systemPrompt,
      tools: turn.tools,
      messages: turn.messages,
      refusal: turn.refusal,
    },
  };
}

/** Say that a run delegated from the meals conversation is answered there. The undo is for tests. */
export function registerMealsDelivery(deps: MealsDeliveryDeps = {}): () => void {
  return registerDelivery("meals", (input) => openMealsDelivery(input, deps));
}
