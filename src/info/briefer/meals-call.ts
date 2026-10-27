// The meals conversation's voice call and its prep card (docs/info/671 时间线与语音):
// a call started with the prep is held on the one standing meals thread, its
// lines are written there, and a run it hands off is answered there. The prep is
// the call's focus: its steps and tools are laid on the call by the screen while
// the run lasts (soul/voice/live/call-host.ts), whichever call is open.
//
// Here and not in info/meals because the thread's ids are the briefer's
// (anchors.ts), as the meals delivery is (deliver.ts).

import { aiLanguageName } from "../../platform/app/settings";
import { appendMessage, createThread, getThread, loadThreads, patchThreadMessage, type PersistedPart } from "../../platform/app/threads";
import type { MealsPrepCardData } from "../meals/cards";
import { createLiveCall, type LiveCallHooks, type LiveCallSpec } from "../../soul/voice/live/call";
import type { CallThread } from "../../soul/voice/live/call-transcript";
import type { VoiceCall } from "../../soul/voice/voice-call";
import { MEALS_BOOK_ID, MEALS_THREAD_ID } from "./anchors";

export const MEALS_CALL_PLACE = "In the meals conversation, about what they eat this week.";

const PREP_OPENING =
  "(The user just started the batch prep and the voice call with it — you are speaking aloud, so keep it short. " +
  "Say in one sentence that you are with them and they can tell you when a step is done or ask what is next. " +
  "Do not name a step, a time or a number of minutes.";

/** The opening note of the prep call, in the recogniser's language. */
export function mealsPrepKickoff(locale: string): string {
  const language = aiLanguageName(locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en");
  return `${PREP_OPENING} Say it in ${language}.)`;
}

/** The meals thread, in memory and created if it is not there yet. */
export async function openMealsThread(): Promise<{ id: string }> {
  await loadThreads(MEALS_BOOK_ID).catch(() => ({}));
  return getThread(MEALS_BOOK_ID, MEALS_THREAD_ID) ?? createThread(MEALS_BOOK_ID, "info", MEALS_THREAD_ID);
}

export function mealsCallThreads(threadId: string): CallThread[] {
  return [{ key: MEALS_BOOK_ID, threadId }];
}

/** Everything the meals prep call is. */
export function mealsPrepCallSpec(hooks: LiveCallHooks, openThread: () => Promise<{ id: string }> = openMealsThread): LiveCallSpec {
  return {
    contextualStrings: [],
    place: MEALS_CALL_PLACE,
    kickoff: mealsPrepKickoff,
    deliverTo: { place: "meals" },
    threads: async () => mealsCallThreads((await openThread()).id),
    ...hooks,
  };
}

/** The meals prep call, wired to the device. Null where there is no plugin to hold one. */
export function createMealsPrepCall(hooks: LiveCallHooks): Promise<VoiceCall | null> {
  return createLiveCall(mealsPrepCallSpec(hooks));
}

export interface PrepCardThreads {
  open(): Promise<{ id: string; messages: readonly { ts: number; parts?: readonly PersistedPart[] }[] }>;
  append(threadId: string, message: { role: "ai"; text: string; ts: number; parts: PersistedPart[] }): void;
  patch(threadId: string, ts: number, patch: { parts: PersistedPart[] }): void;
  now(): number;
}

const liveThreads: PrepCardThreads = {
  open: async () => {
    const thread = await openMealsThread();
    return getThread(MEALS_BOOK_ID, thread.id) ?? { id: thread.id, messages: [] };
  },
  append: (threadId, message) => appendMessage(MEALS_BOOK_ID, threadId, message),
  patch: (threadId, ts, patch) => patchThreadMessage(MEALS_BOOK_ID, threadId, ts, patch),
  now: () => Date.now(),
};

/**
 * Place the prep card in the meals conversation, or replace the one already
 * there under the same id in place (the patchPart channel on disk: the row keeps
 * its stamp, so the conversation does not move).
 */
export async function putMealsPrepCard(card: MealsPrepCardData, threads: PrepCardThreads = liveThreads): Promise<void> {
  const thread = await threads.open();
  const part: PersistedPart = { type: "card", id: card.prepId, card: card as unknown as Extract<PersistedPart, { type: "card" }>["card"] };
  const row = thread.messages.find((m) => m.parts?.some((p) => p.type === "card" && p.id === card.prepId));
  if (row) threads.patch(thread.id, row.ts, { parts: [part] });
  else threads.append(thread.id, { role: "ai", text: "", ts: threads.now(), parts: [part] });
}
