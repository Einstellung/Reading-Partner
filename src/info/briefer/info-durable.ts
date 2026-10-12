// The info conversations' places on the device's durable runtime (docs/soul/87,
// 第二阶段): a conversation about a day's briefing, one of its articles or the
// first-run setup is a thread in that day's file, and the meals conversation is
// the one standing thread in its own (docs/71, 对话按归属存). Their turns run,
// land and recover the way a book's and the door's do (legion/durable/device.ts).
//
// The turn this process assembled for a conversation — its history and the
// desk's tools, the card-drawing ones among them — is used while it is there. A
// turn resumed after a restart reads the conversation's file and lays the desk
// a bell's answer is laid on (deliver.ts): the same day, the same role, without
// the tools that draw a card or start a briefing, since nobody is there.
//
// Both are assembled by prepareInfoTurn, for the text chat
// (ui/components/info/use-info-call.ts) and, once it moves over, the voice call.

import type { Context } from "@earendil-works/chord";
import { appBox, type BoxOrigin } from "../../box";
import { toPiMessages } from "../../ai/providers";
import { modelIdFor } from "../../ai/model-tier";
import type { DeskItem, DeskMessage } from "../../desk";
import type { Place, PlaceFactory, PlaceShared } from "../../legion/durable/device";
import type { ThreadOrigin } from "../../legion/durable/extension";
import { threadLander, type ThreadAddress } from "../../legion/durable/thread-files";
import type { AgentTool } from "../../legion/execute/contract";
import { loadSettings, toReasoning } from "../../platform/app/settings";
import { coverOf } from "../../soul";
import { t } from "../../i18n";
import { MEALS_BOOK_ID, MEALS_THREAD_ID, type InfoCallAnchor } from "./anchors";
import { infoBookId } from "./call";
import { layBriefingTurn, layMealsTurn } from "./deliver";
import { assembleInfoTurn, type InfoTurnInput } from "./info-turn";

/** A conversation anchored to a day: the briefing's, an article's, the setup's. */
export type InfoOrigin = { place: "info"; date: string; threadId: string };
/** The standing meals conversation. */
export type MealsOrigin = { place: "meals" };

export function infoThreadOrigin(anchor: Pick<InfoCallAnchor, "threadId">, dateKey: string): InfoOrigin | MealsOrigin {
  return anchor.threadId === MEALS_THREAD_ID ? { place: "meals" } : { place: "info", date: dateKey, threadId: anchor.threadId };
}

export function asInfoOrigin(origin: ThreadOrigin): InfoOrigin {
  const o = origin as unknown as InfoOrigin;
  if (o.place !== "info" || typeof o.date !== "string" || typeof o.threadId !== "string") {
    throw new Error("not an info thread origin");
  }
  return o;
}

export function asMealsOrigin(origin: ThreadOrigin): MealsOrigin {
  if (origin.place !== "meals") throw new Error("not a meals thread origin");
  return { place: "meals" };
}

/** The conversation's key in `rp.conversations`. The day keeps apart the setup thread, whose id every day's file repeats. */
export function infoThreadKey(origin: InfoOrigin | MealsOrigin): string {
  return origin.place === "meals" ? `meals:${MEALS_THREAD_ID}` : `info:${origin.date}:${origin.threadId}`;
}

/** The thread file and thread a conversation lands in. */
export function infoAddress(origin: InfoOrigin | MealsOrigin): ThreadAddress {
  return origin.place === "meals"
    ? { key: MEALS_BOOK_ID, threadId: MEALS_THREAD_ID }
    : { key: infoBookId(origin.date), threadId: origin.threadId };
}

/** Where a reply nobody saw is put in the box: the day's briefing, or the meals conversation (info-turn.ts infoOrigin). */
function boxOriginOf(origin: InfoOrigin | MealsOrigin): BoxOrigin {
  return origin.place === "meals" ? { place: "meals" } : { place: "briefing", date: origin.date };
}

/** What a turn assembled in this process for a conversation: the history before the reader's line, and the desk's tools. */
export interface AssembledInfoTurn {
  history: readonly DeskMessage[];
  tools: readonly AgentTool[];
}

/** The info and meals turns assembled in this process, by conversation key. */
export const infoAssemblies = new Map<string, AssembledInfoTurn>();

const watched = new Map<string, number>();

/** A surface has the conversation under `key` open; the returned function takes that back. */
export function watchInfoConversation(key: string): () => void {
  watched.set(key, (watched.get(key) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (watched.get(key) ?? 1) - 1;
    if (left > 0) watched.set(key, left);
    else watched.delete(key);
  };
}

/** Whether a surface has the conversation under `key` open now. */
export function infoWatchingNow(key: string): boolean {
  return watched.has(key);
}

export interface InfoPlaceDeps {
  assembled?: Map<string, AssembledInfoTurn>;
  /** The desk after a restart: the one a bell's answer is laid on. */
  openDesk?: (origin: InfoOrigin | MealsOrigin, context: Context) => Promise<readonly AgentTool[]>;
  /** Whether the reader has this conversation open as the turn lands. */
  watching?: (key: string) => boolean;
  /** The box card for a reply nobody saw. */
  card?: (origin: InfoOrigin | MealsOrigin, ts: number, text: string) => Promise<void>;
}

async function openRestartDesk(origin: InfoOrigin | MealsOrigin): Promise<readonly AgentTool[]> {
  const settings = await loadSettings();
  const turn =
    origin.place === "meals"
      ? await layMealsTurn({ settings, messages: [], origin: boxOriginOf(origin) })
      : await layBriefingTurn(origin.date, { settings, messages: [], origin: boxOriginOf(origin) });
  return turn?.tools ?? [];
}

/** The same card an answer that landed unseen always gets (soul/recover.ts): named by the thread and the moment. */
async function putInfoCard(origin: InfoOrigin | MealsOrigin, ts: number, text: string): Promise<void> {
  await appBox()
    .put({
      boxId: `${infoAddress(origin).threadId}:${ts}`,
      source: "turn",
      cover: coverOf(text),
      origin: boxOriginOf(origin),
      needsDecision: false,
      at: ts,
    })
    .catch((e: unknown) => console.warn("a reply landed but its box item would not write", e));
}

function conversationPlace<O extends InfoOrigin | MealsOrigin>(
  asOrigin: (origin: ThreadOrigin) => O,
  deps: InfoPlaceDeps,
): PlaceFactory {
  const assembled = deps.assembled ?? infoAssemblies;
  const openDesk = deps.openDesk ?? openRestartDesk;
  const watching = deps.watching ?? infoWatchingNow;
  const card = deps.card ?? putInfoCard;
  return (shared: PlaceShared): Place => ({
    key: (origin) => infoThreadKey(asOrigin(origin)),
    address: (origin) => infoAddress(asOrigin(origin)),
    resolve: async (origin, context) => {
      const o = asOrigin(origin);
      return assembled.get(infoThreadKey(o))?.tools ?? openDesk(o, context);
    },
    land: threadLander({
      threads: shared.threads,
      describe: shared.describe,
      origin: asOrigin,
      address: infoAddress,
      watching: (o) => watching(infoThreadKey(o)),
      card,
    }),
    readHistory: async (origin, options) => {
      const o = asOrigin(origin);
      const live = assembled.get(infoThreadKey(o));
      if (live) return toPiMessages([...live.history]);
      const { key, threadId } = infoAddress(o);
      await shared.threads.load(key);
      const said = (shared.threads.messages(key, threadId) ?? [])
        .filter((m) => !(m.role === "user" && m.ts === options.excludeTs) && m.text.trim() !== "")
        .map((m): DeskMessage => ({ role: m.role, text: m.text }));
      return toPiMessages(said);
    },
    telemetry: (origin) => ({ surface: "info", thread: infoAddress(asOrigin(origin)).threadId }),
  });
}

/** The day's conversations: the briefing's, an article's, the setup's. */
export function infoPlace(deps: InfoPlaceDeps = {}): PlaceFactory {
  return conversationPlace(asInfoOrigin, deps);
}

/** The standing meals conversation. */
export function mealsPlace(deps: InfoPlaceDeps = {}): PlaceFactory {
  return conversationPlace(asMealsOrigin, deps);
}

export type InfoTurnPrepared =
  | {
      kind: "turn";
      key: string;
      origin: InfoOrigin | MealsOrigin;
      /** What the desk opened, for the card gestures that reach back into it. */
      items: DeskItem[];
      systemPrompt: string;
      /** The last message the turn was assembled over: the reader's line, or the setup's opening prompt. */
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
 * Assemble a turn of an info or meals conversation over `messages`, which end
 * with the line it answers, and leave its history and tools where the place
 * finds them.
 */
export async function prepareInfoTurn(input: Omit<InfoTurnInput, "settings">): Promise<InfoTurnPrepared> {
  const settings = await loadSettings();
  if (!settings.defaultProviderId || !settings.defaultModelId) return { kind: "failed", message: t("info.errors.noProvider") };
  let assembled: Awaited<ReturnType<typeof assembleInfoTurn>>;
  try {
    assembled = await assembleInfoTurn({ ...input, settings });
  } catch (e) {
    // Laying the briefing loads the article extractor's chunk, and a fetch can
    // fail (a chunk 404ing after a redeploy, a dropped connection). The next
    // send tries again: cacheUntilFailure drops a rejected load.
    console.error("failed to load the article extractor", e);
    return { kind: "failed", message: t("info.errors.extractorFailed") };
  }
  const { turn, items } = assembled;
  if (!turn) return { kind: "aborted" };
  if (turn.refusal) return { kind: "refused", text: turn.refusal };
  const line = turn.messages[turn.messages.length - 1];
  if (!line || line.role !== "user") throw new Error("an info turn must end with the line it answers");
  const origin = infoThreadOrigin(input.anchor, input.dateKey);
  const key = infoThreadKey(origin);
  infoAssemblies.set(key, { history: turn.messages.slice(0, -1), tools: turn.tools });
  const thinkingLevel = toReasoning(settings.chatThinking);
  return {
    kind: "turn",
    key,
    origin,
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
