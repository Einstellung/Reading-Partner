// One book turn on the durable runtime as the reading session drives it
// (docs/soul/87, "一个回合"; docs/72): start it, follow the conversation's view
// state as the turn's rows, steer it, stop it, and cut it when the stream goes
// silent (legion/execute/stall.ts's watch, 90 seconds, judged again when the
// app comes back). A cut turn is superseded, so it lands nothing; the caller
// asks again once, as today.
//
// A turn already in flight when the reader opens its thread — one recovery
// resumed after a restart — is followed, steered and stopped the same way
// (resumedTurn, docs/soul/87 "被杀之后").
//
// No React here: the session hands `onView` the projected rows and draws them.

import type { Context } from "@earendil-works/chord";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { LiveDoc, type Conversation, type ModelRef } from "@earendil-works/pi-durable";
import type { TurnBell, TurnContent, TurnResult } from "../../legion/durable/extension";
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
import type { AgentTool } from "../../legion/execute/contract";
import { stallWatches, type StallWatches } from "../../legion/execute/stall";
import type { ReadingTurnMessage } from "../desk-history";
import { bookThreadKey, bookThreadOrigin, type BookOrigin, type BookTelemetry } from "./durable-book";
import { projectView, runStart, type TurnView, type ViewSource } from "./durable-view";
import { TURN_SECTION, type ReadingDurable } from "./durable-runtime";

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
}

type Live = { run?: { inputs: number[] }; generation?: { message?: unknown }; tools?: { status: string }[] };

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
  durable: ReadingDurable,
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

export async function runBookTurn(durable: ReadingDurable, request: BookTurnRequest, context: Context): Promise<BookTurn> {
  const { runtime } = durable;
  const key = bookThreadKey(request.origin);
  durable.assembled.put(key, {
    history: request.history,
    tools: request.tools,
    ...(request.telemetry ? { telemetry: request.telemetry } : {}),
  });
  const started = await startTurn(
    runtime,
    {
      key,
      origin: bookThreadOrigin(request.origin),
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
  let stalled: WithdrawnSteer[] | undefined;
  let lastHalf = "";
  let holding = false;

  const watch = (request.watches ?? stallWatches()).watch({
    ...(request.stallMs ? { stallMs: request.stallMs } : {}),
    onStall: () => {
      void (async () => {
        const live = await runtime.harness.snapshot(LiveDoc, conversation.id, context);
        const submission = live?.run?.inputs[0];
        if (submission === undefined) return;
        stalled = await supersede(runtime, conversation, submission, context);
      })();
    },
  });

  const unfollow = await followTurn(
    durable,
    conversation,
    {
      startedAt: started.startedAt,
      describe: request.describe,
      onView: request.onView,
      pulse: (live) => {
        const half = JSON.stringify(live?.generation?.message ?? null);
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
    },
    context,
  );

  const settled = started.settled.then((result) => {
    watch.stop();
    unfollow();
    return stalled ? { result, stalled } : { result };
  });

  return {
    conversation,
    steer(text, ts) {
      return steerTurn(runtime, conversation, text, ts, context);
    },
    stop: () => stopTurn(runtime, conversation, context),
    settled,
  };
}

/** A turn in flight on a thread that nothing on screen holds. */
export interface ResumedTurn {
  /** `rp.turn`'s start: every row of the turn is stamped after it. */
  startedAt: number;
  /** Follow it as rows; steering and stopping it work as on a turn started here. */
  follow(onView: (view: TurnView) => void): Promise<BookTurn>;
}

/**
 * The turn in flight on a book thread, for the reader who opens it: after a
 * restart, the one recovery resumed. Undefined when the thread is idle.
 */
export async function resumedTurn(
  durable: ReadingDurable,
  origin: Pick<BookOrigin, "home" | "threadId">,
  context: Context,
): Promise<ResumedTurn | undefined> {
  const { runtime } = durable;
  const found = await turnInFlight(runtime, bookThreadKey(origin), context);
  if (!found) return undefined;
  const { conversation, startedAt } = found;
  return {
    startedAt,
    async follow(onView) {
      const unfollow = await followTurn(durable, conversation, { startedAt, describe: durable.describe, onView }, context);
      return {
        conversation,
        steer: (text, ts) => steerTurn(runtime, conversation, text, ts, context),
        stop: () => stopTurn(runtime, conversation, context),
        settled: found.settled.then((result) => {
          unfollow();
          return { result };
        }),
      };
    },
  };
}
