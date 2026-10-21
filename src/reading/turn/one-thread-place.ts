// A place whose every conversation is the one thread of one thing — a talk's
// coaching (docs/44), a retell (docs/31) — on the device's durable runtime
// (docs/soul/87, 第二阶段). The thing's id is the thread's id, and its thread
// file is the thing's own (docs/71, 对话按归属存), so the place only needs the
// file's key, the desk a turn resumed after a restart is served from, and how
// that turn reads its history off the file.
//
// The turn this process assembled — its history and its desk's tools, the
// card-raising ones among them — is used while it is there, as at the door
// (soul/door-durable.ts). Closing the view does not stop its turn (the place
// session's detach): a reply that lands with nobody looking puts the companion's box
// card, which opens the view again (companion/box-jump.ts).

import type { Context } from "@earendil-works/chord";
import { appBox, type BoxOrigin, type BoxStore } from "../../box";
import { coverOf } from "../../soul/bell";
import { toPiMessages } from "../../ai/providers";
import type { DeskMessage } from "../../desk";
import type { Place, PlaceFactory, PlaceShared } from "../../legion/durable/device";
import type { ThreadOrigin } from "../../legion/durable/extension";
import { threadLander } from "../../legion/durable/thread-files";
import type { AgentTool } from "../../legion/durable/contract";
import type { AiSurface } from "../../platform/app/cache-telemetry";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRef } from "@earendil-works/pi-durable";
import type { PlaceAssembled } from "./place-session";

export type OneThreadOrigin = { place: string; id: string };

/** What a turn assembled in this process for a thread: the history before its line, and the desk's tools. */
export interface AssembledThreadTurn {
  history: readonly DeskMessage[];
  tools: readonly AgentTool[];
}

export interface OneThreadPlaceSpec {
  /** The place's name: `origin.place`, and the prefix of its conversations' keys. */
  place: string;
  /** The thread store's key for the thing's thread file. */
  fileKey(id: string): string;
  surface: AiSurface;
  assembled: Map<string, AssembledThreadTurn>;
  /** The desk after a restart, with nobody there to draw its cards. */
  openDesk(id: string, context: Context): Promise<readonly AgentTool[]>;
  /**
   * The history a turn resumed after a restart sends, from the thread's spoken
   * lines before its own (`lineInFile`: false when the turn's line is not a
   * row of the file). The file's lines as they are unless said.
   */
  history?(said: DeskMessage[], lineInFile: boolean): DeskMessage[];
  /** Whether the reader has the thing's conversation open as a turn lands; the open views' word unless said. */
  watching?(id: string): boolean;
  /** The box card for a reply nobody saw; none unless said. */
  card?(id: string, ts: number, text: string): Promise<void>;
}

const watched = new Map<string, number>();

/** A view has the conversation `key` open; the returned function says it closed. */
export function watchOneThread(key: string): () => void {
  watched.set(key, (watched.get(key) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (watched.get(key) ?? 1) - 1;
    if (n > 0) watched.set(key, n);
    else watched.delete(key);
  };
}

/** Whether a view has the conversation `key` open now. */
export function oneThreadWatchedNow(key: string): boolean {
  return watched.has(key);
}

/**
 * The box card for a reply that landed in a one-thread conversation nobody had
 * open: named by the thread and the moment, as every turn's is (turn-box.ts).
 * Never throws: the reply is already written.
 */
export async function putOneThreadCard(
  input: { id: string; ts: number; text: string; origin: BoxOrigin },
  box: BoxStore = appBox(),
): Promise<void> {
  await box
    .put({
      boxId: `${input.id}:${input.ts}`,
      source: "turn",
      cover: coverOf(input.text),
      origin: input.origin,
      needsDecision: false,
      at: input.ts,
    })
    .catch((e: unknown) => console.warn("a reply landed but its box item would not write", e));
}

export function oneThreadOrigin(place: string, id: string): OneThreadOrigin {
  return { place, id };
}

export function asOneThreadOrigin(place: string, origin: ThreadOrigin): OneThreadOrigin {
  const o = origin as unknown as OneThreadOrigin;
  if (o.place !== place || typeof o.id !== "string") throw new Error(`not a ${place} thread origin`);
  return o;
}

/** The conversation's key in `rp.conversations`. */
export function oneThreadKey(place: string, id: string): string {
  return `${place}:${id}`;
}

export function oneThreadPlace(spec: OneThreadPlaceSpec): PlaceFactory {
  const own = (origin: ThreadOrigin) => asOneThreadOrigin(spec.place, origin);
  const address = (o: OneThreadOrigin) => ({ key: spec.fileKey(o.id), threadId: o.id });
  return (shared: PlaceShared): Place => ({
    key: (origin) => oneThreadKey(spec.place, own(origin).id),
    address: (origin) => address(own(origin)),
    resolve: async (origin, context) => {
      const o = own(origin);
      return spec.assembled.get(oneThreadKey(spec.place, o.id))?.tools ?? spec.openDesk(o.id, context);
    },
    land: threadLander({
      threads: shared.threads,
      describe: shared.describe,
      origin: own,
      address,
      watching: (o) => (spec.watching ?? ((id) => oneThreadWatchedNow(oneThreadKey(spec.place, id))))(o.id),
      card: async (o, ts, text) => {
        await spec.card?.(o.id, ts, text);
      },
    }),
    readHistory: async (origin, options) => {
      const o = own(origin);
      const live = spec.assembled.get(oneThreadKey(spec.place, o.id));
      if (live) return toPiMessages([...live.history]);
      const key = spec.fileKey(o.id);
      await shared.threads.load(key);
      const said = (shared.threads.messages(key, o.id) ?? [])
        .filter((m) => !(m.role === "user" && m.ts === options.excludeTs) && m.text.trim() !== "")
        .map((m): DeskMessage => ({ role: m.role, text: m.text }));
      return toPiMessages(spec.history ? spec.history(said, options.excludeTs !== undefined) : said);
    },
    telemetry: (origin) => ({ surface: spec.surface, thread: own(origin).id }),
  });
}

/** An assembled turn, in the shape the domains' turn builders answer with. */
export interface BuiltThreadTurn {
  systemPrompt: string;
  tools: readonly AgentTool[];
  messages: readonly DeskMessage[];
  notice: string;
  refusal: string;
}

/**
 * A built turn as the place session takes it: its history and tools kept where
 * the place finds them, the last message sent as the turn's line. `lineTs` is
 * the line's row in the thread file, absent when the line is not one (a turn
 * the surface opens itself).
 */
export function oneThreadTurn(input: {
  place: string;
  id: string;
  surface: AiSurface;
  assembled: Map<string, AssembledThreadTurn>;
  turn: BuiltThreadTurn;
  lineTs?: number;
  model: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
}): PlaceAssembled {
  const { turn } = input;
  if (turn.refusal) return { kind: "refused", message: turn.refusal };
  const line = turn.messages[turn.messages.length - 1];
  if (!line || line.role !== "user") throw new Error(`a ${input.place} turn must end with a line of the reader's`);
  const key = oneThreadKey(input.place, input.id);
  input.assembled.set(key, { history: turn.messages.slice(0, -1), tools: turn.tools });
  return {
    kind: "turn",
    request: {
      key,
      origin: oneThreadOrigin(input.place, input.id),
      conversation: input.id,
      surface: input.surface,
      line: { text: line.text, ...(input.lineTs !== undefined ? { ts: input.lineTs } : {}) },
      systemPrompt: turn.systemPrompt,
      tools: turn.tools,
      model: input.model,
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    },
    ...(turn.notice ? { notice: turn.notice } : {}),
  };
}
