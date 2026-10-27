// Starting the prep and moving it on, with its chat card and its call (docs/671
// 时间线与语音). The prep page's Start, the meals conversation's start_prep, a
// tap on a step and the front's prep_step all come through here, so the run,
// the card and the call stay one thing.
//
// The call is asked for by the caller: a tap asks inside its gesture, before
// anything is awaited, and hands the answer in; the tool asks once the run is
// written.

import { startPrep, recordPrepEvent, type PrepProgressPorts, type RecordedEvent } from "./prep-progress";
import { prepCard, type PrepStartOutcome } from "./prep-voice";
import type { MealsPrepCardData } from "./cards";
import type { MealsState } from "./plan/types";
import { prepStepsRequest } from "./recipe/prep-steps";
import { recipeLanguageNow, storedPrepSteps, writePrepStepsOnce } from "./recipe/recipe-live";
import { hostRegion } from "./region";
import type { StepEvent } from "./timeline/run";
import { kitchenFor, type Kitchen } from "./timeline/schedule";
import type { PrepStep } from "./timeline/steps";

/** How the voice came out: a call started, one already open joined, or none on this device. */
export type PrepVoiceStart = "call" | "joined" | "none";

/** The session's stored steps and what the timeline is read with. */
export interface PrepSteps {
  key: string;
  steps: readonly PrepStep[];
  kitchen: Kitchen;
  boxes: boolean;
}

export interface PrepSessionDeps {
  ports: PrepProgressPorts;
  /** Place the card in the meals conversation, or replace it in place under its id. */
  putCard(card: MealsPrepCardData): Promise<void>;
}

async function put(deps: PrepSessionDeps, card: MealsPrepCardData): Promise<void> {
  // The card is the conversation's view of the run; the run is already written.
  await deps.putCard(card).catch((e: unknown) => console.warn("the prep card could not be written", e));
}

/** Start the run (or keep the one already following these steps) and place its card. */
export async function startPrepSession(deps: PrepSessionDeps, steps: PrepSteps, voice: () => PrepVoiceStart): Promise<PrepStartOutcome> {
  const run = await startPrep(deps.ports, steps.key);
  if (!run) return { kind: "failed" };
  await put(deps, prepCard({ ...steps, run }));
  return { kind: "started", voice: voice() };
}

/** Write one event into the run and move the card with it. */
export async function recordPrepSessionEvent(deps: PrepSessionDeps, steps: PrepSteps, event: StepEvent): Promise<RecordedEvent | null> {
  const out = await recordPrepEvent(deps.ports, steps, event);
  if (out?.applied) await put(deps, prepCard({ ...steps, run: out.run }));
  return out;
}

/** The current plan's prep steps as stored, written now when they are not yet: start_prep's way in. */
export async function prepStepsNow(state: MealsState, today: string): Promise<PrepSteps | "no-prep" | "no-steps"> {
  const request = prepStepsRequest(state, { today, region: hostRegion(), language: await recipeLanguageNow() });
  if (!request) return "no-prep";
  try {
    const entry = (await storedPrepSteps(request)) ?? (await writePrepStepsOnce(request, "chat"));
    const profile = state.charter?.profile;
    return { key: request.key, steps: entry.steps, kitchen: kitchenFor(profile), boxes: profile?.boxes !== false };
  } catch {
    return "no-steps";
  }
}

/** start_prep: the steps, the run and its card, then the call. */
export async function startPrepFromChat(
  deps: PrepSessionDeps & { today(): string },
  call: () => PrepVoiceStart,
): Promise<PrepStartOutcome> {
  const steps = await prepStepsNow(await deps.ports.current(), deps.today());
  if (steps === "no-prep" || steps === "no-steps") return { kind: steps };
  return startPrepSession(deps, steps, call);
}
