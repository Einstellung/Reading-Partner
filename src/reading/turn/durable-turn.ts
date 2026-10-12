// One book turn on the durable runtime as the reading session drives it
// (docs/soul/87, "一个回合"; docs/72): start it, follow the conversation's view
// state as the turn's rows, steer it, stop it, and cut it when the stream goes
// silent (legion/durable/stall.ts's watch, 90 seconds, judged again when the
// app comes back). A cut turn is superseded, so it lands nothing; the caller
// asks again once, as today.
//
// A turn already in flight when the reader opens its thread — one recovery
// resumed after a restart — is followed, steered, stopped and watched the same
// way (resumedTurn, docs/soul/87 "被杀之后").
//
// Both write the turn log's lines (durable-turn-log.ts) and, in a development
// build, the turn's longest silence (stall.ts recordLongestSilence), as the
// old turn loop did.
//
// No React here: the session hands `onView` the projected rows and draws them.

import type { Context } from "@earendil-works/chord";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { LiveDoc, type Conversation, type ModelRef } from "@earendil-works/pi-durable";
import type { ThreadOrigin, TurnBell, TurnContent, TurnResult } from "../../legion/durable/extension";
import { TURN_SECTION, type DeviceDurable } from "../../legion/durable/device";
import type { AiSurface } from "../../platform/app/cache-telemetry";
import {
  startTurn,
  steerTimestamps,
  steerTurn,
  STEER_REQUEST_PREFIX,
  stopTurn,
  supersede,
  turnInFlight,
  type WithdrawnSteer,
} from "../../legion/durable/turn";
import type { AgentTool } from "../../legion/durable/contract";
import { recordLongestSilence, stallWatches, type StallWatches } from "../../legion/durable/stall";
import type { ReadingTurnMessage } from "../desk-history";
import { bookThreadKey, bookThreadOrigin, type BookOrigin, type BookTelemetry } from "./durable-book";
import { projectView, runStart, type TurnView, type ViewSource } from "./durable-view";
import type { ReadingDurable } from "./durable-runtime";
import { turnsStarting } from "./detached-turns";

/** The stall watch's registry and window: the app's shared one and TURN_STALL_MS unless said. */
export interface StallOptions {
  watches?: StallWatches;
  stallMs?: number;
}

export interface BookTurnRequest {
  origin: BookOrigin;
  /**
   * The reader's line, already in the thread file at `ts`; `content` when it
   * carries images. For a bell's turn it is the bell, in no file, and `ts` is absent.
   */
  line: { text: string; ts?: number; content?: TurnContent };
  bell?: TurnBell;
  telemetry?: BookTelemetry;
  systemPrompt: string;
  /** The assembled history before the reader's line. */
  history: readonly ReadingTurnMessage[];
  tools: readonly AgentTool[];
  model: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
  describe(name: string, args: unknown): { label: string; quiet?: true };
  onView(view: TurnView): void;
  watches?: StallWatches;
  stallMs?: number;
}

export interface BookTurn {
  conversation: Conversation;
  steer(text: string, ts: number): Promise<boolean>;
  /** Stop: the steers the model never took come back for the next turn. */
  stop(): Promise<WithdrawnSteer[]>;
  /** The turn's end: `stalled` when the watch cut it, with the steers it withdrew. */
  settled: Promise<{ result: TurnResult | undefined; stalled?: WithdrawnSteer[] }>;
  /** This follower stops watching for a stall: another follower of the turn has taken it over. */
  unwatch(): void;
}

type Live = {
  run?: { inputs: number[] };
  generation?: { message?: { timestamp?: number } };
  tools?: { status: string }[];
};

interface Following {
  startedAt: number;
  describe(name: string, args: unknown): { label: string; quiet?: true };
  onView(view: TurnView): void;
  /** Every view's `pi.live`, before it is projected. */
  pulse?(live: Live | undefined): void;
}

/**
 * Follow a conversation's view state as the turn's rows: the steers' row
 * timestamps are looked up as they show, queued or taken. The returned
 * function stops following.
 */
async function followTurn(
  durable: DeviceDurable,
  conversation: Conversation,
  following: Following,
  context: Context,
): Promise<() => void> {
  const { runtime } = durable;
  const queuedTs = new Map<number, number>();
  let steerTs: Awaited<ReturnType<typeof steerTimestamps>> = new Map();
  let steerEntries = 0;
  const view = await conversation.viewState(context);
  const follow = async (value: ViewSource) => {
    following.pulse?.(value.docs["pi.live"] as Live | undefined);
    for (const item of (value.docs["pi.inbox"] as { items?: { id: number; mode: string }[] } | undefined)?.items ?? []) {
      if (item.mode !== "steer" || queuedTs.has(item.id)) continue;
      const record = await (await runtime.harness.submission(item.id as never, context))?.status(context);
      const ts = Number(record?.requestId?.slice(STEER_REQUEST_PREFIX.length));
      if (Number.isFinite(ts)) queuedTs.set(item.id, ts);
    }
    const from = runStart(value.entries);
    const users = value.entries.filter((e) => e.kind === "pi.user" && e.id !== from).length;
    if (users !== steerEntries) {
      steerEntries = users;
      steerTs = await steerTimestamps(runtime.storage, conversation.id, context);
    }
    following.onView(
      projectView(value, { startedAt: following.startedAt, steerTs, queuedTs, describe: following.describe }),
    );
  };
  const unsubscribe = view.subscribe((value) => follow(value));
  if (view.value) await follow(view.value);
  return () => {
    unsubscribe();
    view.dispose();
  };
}

interface TurnWatch {
  /** Every view's `pi.live`: generation progress beats the watch, a running tool holds it. */
  pulse(live: Live | undefined): void;
  /** The steers the cut withdrew; undefined unless the watch cut the turn. */
  stalled(): WithdrawnSteer[] | undefined;
  /** Stop watching, recording nothing: another follower watches the turn now. */
  unwatch(): void;
  stop(): void;
}

/**
 * The stall watch on one turn (docs/soul/87 "停摆"): silent past the window,
 * the run in flight is superseded, so it lands nothing. The view's first
 * partial of each round is the turn log's first byte; a follower `joining` a
 * turn already in flight writes none for a round whose answer was already
 * streaming when it came (durable-turn-log.ts `joined`).
 */
function watchTurn(
  durable: DeviceDurable,
  conversation: Conversation,
  key: string,
  surface: string,
  stall: StallOptions,
  context: Context,
  joining = false,
): TurnWatch {
  const { runtime } = durable;
  let stalled: WithdrawnSteer[] | undefined;
  let lastHalf = "";
  let holding = false;
  const watch = (stall.watches ?? stallWatches()).watch({
    ...(stall.stallMs ? { stallMs: stall.stallMs } : {}),
    onStall: () => {
      void (async () => {
        const live = await runtime.harness.snapshot(LiveDoc, conversation.id, context);
        const submission = live?.run?.inputs[0];
        if (submission === undefined) return;
        durable.turnLog.stalled(key);
        stalled = await supersede(runtime, conversation, submission, context);
      })();
    },
  });
  return {
    pulse(live) {
      const message = live?.generation?.message;
      if (message?.timestamp !== undefined) {
        if (joining) durable.turnLog.joined(key, message.timestamp);
        else durable.turnLog.heard(key, message.timestamp);
      }
      joining = false;
      const half = JSON.stringify(message ?? null);
      if (half !== lastHalf) {
        lastHalf = half;
        watch.beat();
      }
      const toolRunning = live?.tools?.some((slot) => slot.status === "running") ?? false;
      if (toolRunning !== holding) {
        holding = toolRunning;
        if (holding) watch.hold();
        else watch.unhold();
      }
    },
    stalled: () => stalled,
    unwatch: () => watch.stop(),
    stop() {
      // What the stall window has to clear, measured on a real turn; read back
      // off a development build only (the old turn loop did the same).
      if (import.meta.env?.DEV) {
        const ms = watch.longestSilence();
        recordLongestSilence({ surface, ms, at: Date.now() });
        console.log(`[stall] ${surface} longest silence ${ms}ms`);
      }
      watch.stop();
    },
  };
}

/** One turn at any place (legion/durable/device.ts), as a surface drives it. */
export interface PlaceTurnRequest {
  /** The conversation's key in `rp.conversations`, as the place keys it. */
  key: string;
  origin: ThreadOrigin;
  /** The conversation's id in the turn log: the thread. */
  conversation: string;
  surface: AiSurface;
  /** The reader's line, already in the conversation file at `ts`; for a bell's turn the bell, with no `ts`. */
  line: { text: string; ts?: number; content?: TurnContent };
  bell?: TurnBell;
  systemPrompt: string;
  tools: readonly AgentTool[];
  model: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
  describe(name: string, args: unknown): { label: string; quiet?: true };
  onView(view: TurnView): void;
  watches?: StallWatches;
  stallMs?: number;
}

/**
 * Start a turn on a place's conversation and follow it as rows. The place's
 * own assembly (history, desk tools) is put where its history reader and desk
 * resolver find it before this is called.
 */
export async function runPlaceTurn(durable: DeviceDurable, request: PlaceTurnRequest, context: Context): Promise<BookTurn> {
  const { runtime } = durable;
  const { key } = request;
  const started = await startTurn(
    runtime,
    {
      key,
      origin: request.origin,
      content: request.line.content ?? request.line.text,
      sections: { [TURN_SECTION]: request.systemPrompt },
      tools: request.tools.map((tool) => tool.name).filter((name) => runtime.registrations.has(name)),
      model: request.model,
      ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
      ...(request.line.ts !== undefined ? { excludeTs: request.line.ts } : {}),
      ...(request.bell ? { bell: request.bell } : {}),
    },
    context,
  );
  const { conversation } = started;
  durable.turnLog.begin(key, {
    surface: request.surface,
    conversation: request.conversation,
    provider: request.model.provider,
    model: request.model.modelId,
  }, started.turn);
  const watch = watchTurn(
    durable,
    conversation,
    key,
    request.surface,
    { ...(request.watches ? { watches: request.watches } : {}), ...(request.stallMs ? { stallMs: request.stallMs } : {}) },
    context,
  );

  const unfollow = await followTurn(
    durable,
    conversation,
    { startedAt: started.startedAt, describe: request.describe, onView: request.onView, pulse: watch.pulse },
    context,
  );

  const settled = started.settled.then((result) => {
    watch.stop();
    unfollow();
    durable.turnLog.end(key, result);
    const stalled = watch.stalled();
    return stalled ? { result, stalled } : { result };
  });

  return {
    conversation,
    steer(text, ts) {
      return steerTurn(runtime, conversation, text, ts, context);
    },
    stop: () => stopTurn(runtime, conversation, context),
    settled,
    unwatch: () => watch.unwatch(),
  };
}

export async function runBookTurn(durable: ReadingDurable, request: BookTurnRequest, context: Context): Promise<BookTurn> {
  const key = bookThreadKey(request.origin);
  durable.assembled.put(key, {
    history: request.history,
    tools: request.tools,
    ...(request.telemetry ? { telemetry: request.telemetry } : {}),
  });
  return runPlaceTurn(
    durable,
    {
      key,
      origin: bookThreadOrigin(request.origin),
      conversation: request.origin.threadId,
      surface: request.telemetry?.surface ?? "reading",
      line: request.line,
      ...(request.bell ? { bell: request.bell } : {}),
      systemPrompt: request.systemPrompt,
      tools: request.tools,
      model: request.model,
      ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
      describe: request.describe,
      onView: request.onView,
      ...(request.watches ? { watches: request.watches } : {}),
      ...(request.stallMs ? { stallMs: request.stallMs } : {}),
    },
    context,
  );
}

/** A turn in flight on a thread that nothing on screen holds. */
export interface ResumedTurn {
  /** `rp.turn`'s start: every row of the turn is stamped after it. */
  startedAt: number;
  /** Follow it as rows; steering, stopping and the stall watch work as on a turn started here. */
  follow(onView: (view: TurnView) => void): Promise<BookTurn>;
}

/**
 * The turn in flight on a place's conversation, for the reader who opens it:
 * one a closed view left running, or after a restart, the one recovery
 * resumed. A turn still being started on it is waited for. Undefined when it is idle.
 * `surface` is read when the turn is followed.
 */
export async function resumedPlaceTurn(
  durable: DeviceDurable,
  key: string,
  surface: () => AiSurface,
  context: Context,
  stall: StallOptions = {},
): Promise<ResumedTurn | undefined> {
  const { runtime } = durable;
  // A turn still being assembled or started is not in the runtime yet: wait for it.
  await turnsStarting(key);
  const found = await turnInFlight(runtime, key, context);
  if (!found) return undefined;
  const { conversation, startedAt } = found;
  return {
    startedAt,
    async follow(onView) {
      const watch = watchTurn(durable, conversation, key, surface(), stall, context, true);
      const unfollow = await followTurn(
        durable,
        conversation,
        { startedAt, describe: durable.describe, onView, pulse: watch.pulse },
        context,
      );
      return {
        conversation,
        steer: (text, ts) => steerTurn(runtime, conversation, text, ts, context),
        stop: () => stopTurn(runtime, conversation, context),
        settled: found.settled.then((result) => {
          watch.stop();
          unfollow();
          durable.turnLog.end(key, result);
          const stalled = watch.stalled();
          return stalled ? { result, stalled } : { result };
        }),
        unwatch: () => watch.unwatch(),
      };
    },
  };
}

/**
 * The turn in flight on a book thread, for the reader who opens it: after a
 * restart, the one recovery resumed. Undefined when the thread is idle.
 */
export function resumedTurn(
  durable: ReadingDurable,
  origin: Pick<BookOrigin, "home" | "threadId">,
  context: Context,
  stall: StallOptions = {},
): Promise<ResumedTurn | undefined> {
  const key = bookThreadKey(origin);
  return resumedPlaceTurn(durable, key, () => durable.assembled.get(key)?.telemetry?.surface ?? "reading", context, stall);
}
