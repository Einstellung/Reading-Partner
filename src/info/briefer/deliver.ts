// Giving a run's answer back in the briefing it was asked about (docs/68), or
// in the meals conversation (at the end of this file).
//
// The soul rings the bell and this lays the secretary's desk for that day: the
// same day's briefing, the same thread the reader asked in, the same role. What
// it is not is the reader's own turn — nobody is watching it and there is no
// screen, so the tools that draw a card are not mounted and the briefing cannot
// be regenerated from here.
//
// A briefing has no notion of being looked at (docs/68): the page draws the day
// and not the conversation, so no `watching` is offered and the card always goes
// in the box.

import { openDesk } from "../../desk";
import type { DeskMessage } from "../../desk";
import type { AgentTool } from "../../legion/execute/turn";
import { loadDeviceSettings } from "../../platform/app/device";
import { hasWebviewFetch } from "../../platform/app/platform";
import { loadSettings } from "../../platform/app/settings";
import { createThread, getThread, loadThreads } from "../../platform/app/threads";
import { assembleReaderSection } from "../../memory";
import { assembleTurn, registerDelivery, type Delivery, type DeliveryInput } from "../../soul";
import { loadBriefing } from "../boxes/store";
import { loadPublishedBriefing } from "../boxes/publish";
import type { Briefing } from "../boxes/types";
import { loadSources } from "../sources/source-store";
import { todayLocal } from "../collect/store";
import { withMealsTools } from "../meals/desk";
import { buildLiveMealsTools } from "../meals/live";
import { loadMeals } from "../meals/store";
import type { MealsState } from "../meals/types";
import {
  MEALS_BOOK_ID,
  MEALS_THREAD_ID,
  briefingAnchor,
  briefingThreadId,
  mealsAnchor,
  noBriefingAnchor,
} from "./anchors";
import { infoBookId } from "./call";
import type { CompanionContext } from "./chat";
import { buildLiveCompanionTools } from "./companion-live";
import { withCompanionTools } from "./desk";
import { SECRETARY_ROLE_ID } from "./role";

export interface BriefingDeliveryDeps {
  /** That day's briefing. Off this device's own files unless a test hands one in. */
  briefing?: (date: string) => Promise<Briefing | null>;
  /** Who the reader is and what they subscribe to, as every info anchor needs it. */
  context?: () => Promise<CompanionContext>;
  /** The secretary's tools for this turn. None of them draw, because nothing is watching. */
  tools?: () => Promise<AgentTool[]>;
}

/**
 * That day's briefing as this device holds it: the dated file the collector
 * writes, or the published one when it is for the same day — which is what a
 * reader device has.
 */
async function loadDayBriefing(date: string): Promise<Briefing | null> {
  const dated = await loadBriefing(date).catch(() => null);
  if (dated) return dated;
  const published = await loadPublishedBriefing().catch(() => null);
  return published && published.date === date ? published : null;
}

async function liveContext(): Promise<CompanionContext> {
  const [reader, sources, settings, device] = await Promise.all([
    assembleReaderSection(),
    loadSources(),
    loadSettings(),
    loadDeviceSettings(),
  ]);
  const collecting = device.role === "collector";
  return {
    reader,
    sources,
    aiLanguage: settings.aiLanguage,
    canSignIn: hasWebviewFetch() && collecting,
    collecting,
  };
}

// The companion set as a turn nobody is watching can hold it: no card sinks —
// there is no screen to draw one on — and no way to start a briefing run, which
// is a thing the reader asks for and not a thing an answer does on its way in.
const liveTools = (): Promise<AgentTool[]> =>
  buildLiveCompanionTools(
    () => {},
    {
      start() {
        throw new Error(
          "The briefing cannot be regenerated while answering a delegated run. Tell the " +
            "user to ask for it in the briefing chat.",
        );
      },
    },
    {},
  );

/**
 * Assemble the turn that answers a bell in a day's briefing. Null when the turn
 * could not be assembled — the bell then falls back to the door.
 */
export async function openBriefingDelivery(
  input: DeliveryInput,
  deps: BriefingDeliveryDeps = {},
): Promise<Delivery | null> {
  const { origin } = input;
  if (origin.place !== "briefing") return null;
  const date = origin.date;
  const key = infoBookId(date);
  const threadId = briefingThreadId(date);
  // The day's file has to be in memory before its conversation is read off it:
  // nothing on this path went through the briefing page.
  await loadThreads(key).catch(() => ({}));
  const existing = getThread(key, threadId);
  const history: DeskMessage[] = (existing?.messages ?? []).map((m) => ({
    role: m.role,
    text: m.text,
  }));
  // A run delegated from the launch card can come back before anything was ever
  // written to that day's thread. The reply needs somewhere to land.
  if (!existing) createThread(key, "info", threadId);

  const ctx = await (deps.context ?? liveContext)();
  const briefing = await (deps.briefing ?? loadDayBriefing)(date);
  const anchor = briefing
    ? briefingAnchor(briefing, ctx)
    : noBriefingAnchor(ctx, { dateKey: date, notices: [] });

  const desk = await openDesk(withCompanionTools(anchor.desk, deps.tools ?? liveTools), {
    settings: input.settings,
    thread: { key, id: threadId },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const turn = await assembleTurn({
    desk,
    // The bell rides as one trailing user message and is never written to the
    // thread: what the day's file keeps is only what the secretary said.
    messages: [...history, { role: "user", text: input.bell }],
    role: SECRETARY_ROLE_ID,
  });
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

/** Say that a run delegated from a briefing is answered in that briefing. The undo is for tests. */
export function registerBriefingDelivery(deps: BriefingDeliveryDeps = {}): () => void {
  return registerDelivery("briefing", (input) => openBriefingDelivery(input, deps));
}

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
  if (!existing) createThread(key, "info", threadId);

  const state = await (deps.state ?? (() => loadMeals()))();
  const anchor = mealsAnchor(state, (deps.today ?? todayLocal)());
  const desk = await openDesk(withMealsTools(anchor.desk, deps.tools ?? liveMealsTools), {
    settings: input.settings,
    thread: { key, id: threadId },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const turn = await assembleTurn({
    desk,
    messages: [...history, { role: "user", text: input.bell }],
    role: SECRETARY_ROLE_ID,
  });
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
