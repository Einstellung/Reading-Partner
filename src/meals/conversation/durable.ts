// The meals conversation's place on the device's durable runtime (docs/soul/87,
// docs/73): the one standing thread, in a file of its own (docs/71, 对话按归属存).
// Its turns run, land and recover the way a book's and the door's do
// (legion/durable/device.ts).
//
// The turn this process assembled — its history and the desk's tools, the
// card-drawing ones among them — is used while it is there. A turn resumed
// after a restart reads the conversation's file and lays the desk a bell's
// answer is laid on (deliver.ts): the same role, without the tools that draw a
// card, since nobody is there.
//
// The text chat (ui/components/meals/use-meals-call.ts) assembles its turns
// through prepareMealsTurn.
//
// Every value here that names the conversation is on disk or in the log and
// stays as it was: the thread file `info-meals`, the thread `meals`, the key
// `meals:meals`, the box origin `{ place: "meals" }`, the caller `meals-chat`.

import type { Context } from "@earendil-works/chord";
import { appBox, type BoxOrigin } from "../../box";
import { toPiMessages } from "../../ai/providers";
import { modelIdFor } from "../../ai/model-tier";
import { bindItemRef, bindItemTools, openDesk, type DeskItem, type DeskMessage } from "../../desk";
import type { Place, PlaceFactory, PlaceShared } from "../../legion/durable/device";
import type { ThreadOrigin } from "../../legion/durable/extension";
import { threadLander, type ThreadAddress } from "../../legion/durable/thread-files";
import type { AgentTool } from "../../legion/durable/contract";
import { loadSettings, toReasoning, type Settings } from "../../platform/app/settings";
import { assembleTurn, coverOf, type AssembleInput, type AssembledTurn } from "../../soul";
import { t } from "../../i18n";
import { INFO_MEALS_KIND, type MealsDeskRef, type MealsDraft, type MealsTools } from "../desk";
import { MEALS_BOOK_ID, MEALS_THREAD_ID, type MealsCallAnchor } from "./anchor";
import { layMealsTurn } from "./deliver";
import { MEALS_ROLE_ID } from "./role";

/** The standing meals conversation. */
export type MealsOrigin = { place: "meals" };
export const MEALS_ORIGIN: MealsOrigin = { place: "meals" };

export function asMealsOrigin(origin: ThreadOrigin): MealsOrigin {
  if (origin.place !== "meals") throw new Error("not a meals thread origin");
  return { place: "meals" };
}

/** The conversation's key in `rp.conversations`. */
export const MEALS_CONVERSATION_KEY = `meals:${MEALS_THREAD_ID}`;

/** The thread file and thread the conversation lands in. */
export const MEALS_ADDRESS: ThreadAddress = { key: MEALS_BOOK_ID, threadId: MEALS_THREAD_ID };

/** Where a reply nobody saw, or a run delegated from the conversation, comes back to (docs/68). */
export const MEALS_BOX_ORIGIN: BoxOrigin = { place: "meals" };

/** What a turn assembled in this process for the conversation: the history before the reader's line, and the desk's tools. */
export interface AssembledMealsTurn {
  history: readonly DeskMessage[];
  tools: readonly AgentTool[];
}

/** The meals turns assembled in this process, by conversation key. */
export const mealsAssemblies = new Map<string, AssembledMealsTurn>();

let watched = 0;

/** A surface has the conversation open; the returned function takes that back. */
export function watchMealsConversation(): () => void {
  watched += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    watched = Math.max(0, watched - 1);
  };
}

/** Whether a surface has the conversation under `key` open now. */
export function mealsWatchingNow(key: string = MEALS_CONVERSATION_KEY): boolean {
  return key === MEALS_CONVERSATION_KEY && watched > 0;
}

export interface MealsPlaceDeps {
  assembled?: Map<string, AssembledMealsTurn>;
  /** The desk after a restart: the one a bell's answer is laid on. */
  openDesk?: (origin: MealsOrigin, context: Context) => Promise<readonly AgentTool[]>;
  /** Whether the reader has this conversation open as the turn lands. */
  watching?: (key: string) => boolean;
  /** The box card for a reply nobody saw. */
  card?: (origin: MealsOrigin, ts: number, text: string) => Promise<void>;
}

async function openRestartDesk(): Promise<readonly AgentTool[]> {
  const settings = await loadSettings();
  const turn = await layMealsTurn({ settings, messages: [], origin: MEALS_BOX_ORIGIN });
  return turn?.tools ?? [];
}

/** The same card an answer that landed unseen always gets: named by the thread and the moment. */
async function putMealsCard(_origin: MealsOrigin, ts: number, text: string): Promise<void> {
  await appBox()
    .put({
      boxId: `${MEALS_THREAD_ID}:${ts}`,
      source: "turn",
      cover: coverOf(text),
      origin: MEALS_BOX_ORIGIN,
      needsDecision: false,
      at: ts,
    })
    .catch((e: unknown) => console.warn("a reply landed but its box item would not write", e));
}

/** The standing meals conversation. */
export function mealsPlace(deps: MealsPlaceDeps = {}): PlaceFactory {
  const assembled = deps.assembled ?? mealsAssemblies;
  const openDeskAfterRestart = deps.openDesk ?? openRestartDesk;
  const watching = deps.watching ?? mealsWatchingNow;
  const card = deps.card ?? putMealsCard;
  return (shared: PlaceShared): Place => ({
    key: (origin) => (asMealsOrigin(origin), MEALS_CONVERSATION_KEY),
    address: (origin) => (asMealsOrigin(origin), MEALS_ADDRESS),
    resolve: async (origin, context) =>
      assembled.get(MEALS_CONVERSATION_KEY)?.tools ?? openDeskAfterRestart(asMealsOrigin(origin), context),
    land: threadLander({
      threads: shared.threads,
      describe: shared.describe,
      origin: asMealsOrigin,
      address: () => MEALS_ADDRESS,
      watching: () => watching(MEALS_CONVERSATION_KEY),
      card,
    }),
    readHistory: async (origin, options) => {
      asMealsOrigin(origin);
      const live = assembled.get(MEALS_CONVERSATION_KEY);
      if (live) return toPiMessages([...live.history]);
      const { key, threadId } = MEALS_ADDRESS;
      await shared.threads.load(key);
      const said = (shared.threads.messages(key, threadId) ?? [])
        .filter((m) => !(m.role === "user" && m.ts === options.excludeTs) && m.text.trim() !== "")
        .map((m): DeskMessage => ({ role: m.role, text: m.text }));
      return toPiMessages(said);
    },
    // The surface is the one the log has always named this conversation's spend under.
    telemetry: (origin) => (asMealsOrigin(origin), { surface: "info", caller: "meals-chat" as const, thread: MEALS_THREAD_ID }),
  });
}

export interface MealsTurnInput {
  anchor: MealsCallAnchor;
  settings: Settings;
  signal?: AbortSignal;
  messages: AssembleInput["messages"];
  // The meals tools, where the surface has them to give. Without them the
  // meals item on the desk opens with none.
  mealsTools?: MealsTools;
  // The meals draft card on screen, which the meals desk shows the model.
  mealsDraft?: MealsDraft;
  // The meals file as it is now, read when the desk opens: a plan confirmed
  // earlier in the conversation is the one the next turn is told about.
  mealsState?: MealsDeskRef["fresh"];
  // Where a proposal for this conversation's topic is drawn (memory/filing).
  topic?: AssembleInput["topic"];
  // Where an edit_data change that waits for the reader puts its card (docs/platform/687).
  raiseConfirmCard?: AssembleInput["raiseConfirmCard"];
}

export interface MealsTurn {
  // What the desk opened, for the card gestures that reach back into it.
  items: DeskItem[];
  // Null when the signal aborted while the turn was being assembled.
  turn: AssembledTurn | null;
}

/** The anchor's desk with this turn's tools bound to it, laid and handed to the meals role. */
export async function assembleMealsTurn(input: MealsTurnInput): Promise<MealsTurn> {
  const { anchor, mealsTools, mealsDraft, mealsState } = input;
  let refs = anchor.desk;
  if (mealsTools) refs = bindItemTools(refs, INFO_MEALS_KIND, mealsTools);
  if (mealsDraft || mealsState) {
    refs = bindItemRef(refs, INFO_MEALS_KIND, {
      ...(mealsDraft ? { draft: mealsDraft } : {}),
      ...(mealsState ? { fresh: mealsState } : {}),
    });
  }
  const desk = await openDesk(refs, {
    settings: input.settings,
    thread: { key: anchor.bookKey, id: anchor.threadId },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const turn = await assembleTurn({
    desk,
    messages: input.messages,
    role: MEALS_ROLE_ID,
    origin: MEALS_BOX_ORIGIN,
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.raiseConfirmCard ? { raiseConfirmCard: input.raiseConfirmCard } : {}),
  });
  return { items: desk.items, turn };
}

export type MealsTurnPrepared =
  | {
      kind: "turn";
      key: string;
      origin: MealsOrigin;
      /** What the desk opened, for the card gestures that reach back into it. */
      items: DeskItem[];
      systemPrompt: string;
      /** The reader's line the turn was assembled over. */
      line: string;
      tools: readonly AgentTool[];
      notice?: string;
      model: { provider: string; modelId: string };
      thinkingLevel?: NonNullable<ReturnType<typeof toReasoning>>;
    }
  | { kind: "failed"; message: string }
  | { kind: "refused"; text: string }
  | { kind: "aborted" };

/**
 * Assemble a turn of the meals conversation over `messages`, which end with the
 * line it answers, and leave its history and tools where the place finds them.
 */
export async function prepareMealsTurn(input: Omit<MealsTurnInput, "settings">): Promise<MealsTurnPrepared> {
  const settings = await loadSettings();
  if (!settings.defaultProviderId || !settings.defaultModelId) return { kind: "failed", message: t("info.errors.noProvider") };
  let assembled: MealsTurn;
  try {
    assembled = await assembleMealsTurn({ ...input, settings });
  } catch (e) {
    // A chunk the desk loads can fail to fetch (a 404 after a redeploy, a
    // dropped connection). The next send tries again.
    console.error("failed to lay the meals desk", e);
    return { kind: "failed", message: t("info.errors.extractorFailed") };
  }
  const { turn, items } = assembled;
  if (!turn) return { kind: "aborted" };
  if (turn.refusal) return { kind: "refused", text: turn.refusal };
  const line = turn.messages[turn.messages.length - 1];
  if (!line || line.role !== "user") throw new Error("a meals turn must end with the line it answers");
  mealsAssemblies.set(MEALS_CONVERSATION_KEY, { history: turn.messages.slice(0, -1), tools: turn.tools });
  const thinkingLevel = toReasoning(settings.chatThinking);
  return {
    kind: "turn",
    key: MEALS_CONVERSATION_KEY,
    origin: MEALS_ORIGIN,
    items,
    systemPrompt: turn.systemPrompt,
    line: line.text,
    tools: turn.tools,
    ...(turn.notice ? { notice: turn.notice } : {}),
    // The reader is waiting on this one (ai/model-tier.ts).
    model: { provider: settings.defaultProviderId, modelId: modelIdFor(settings, "talk") as string },
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}
