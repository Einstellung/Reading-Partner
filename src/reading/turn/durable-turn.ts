// One book turn on the durable runtime as the reading session drives it
// (docs/soul/87, "一个回合"; docs/72): start it, follow the conversation's view
// state as the turn's rows, steer it, stop it, and cut it when the stream goes
// silent (legion/execute/stall.ts's watch, 90 seconds, judged again when the
// app comes back). A cut turn is superseded, so it lands nothing; the caller
// asks again once, as today.
//
// No React here: the session hands `onView` the projected rows and draws them.

import type { Context } from "@earendil-works/chord";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { LiveDoc, type Conversation, type ModelRef } from "@earendil-works/pi-durable";
import type { TurnContent, TurnResult } from "../../legion/durable/extension";
import {
  startTurn,
  steerTimestamps,
  steerTurn,
  STEER_REQUEST_PREFIX,
  stopTurn,
  supersede,
  type WithdrawnSteer,
} from "../../legion/durable/turn";
import type { AgentTool } from "../../legion/execute/contract";
import { stallWatches, type StallWatches } from "../../legion/execute/stall";
import type { ReadingTurnMessage } from "../desk-history";
import { bookThreadKey, bookThreadOrigin, type BookOrigin } from "./durable-book";
import { projectView, runStart, type TurnView, type ViewSource } from "./durable-view";
import { TURN_SECTION, type ReadingDurable } from "./durable-runtime";

export interface BookTurnRequest {
  origin: BookOrigin;
  /** The reader's line, already in the thread file at `ts`; `content` when it carries images. */
  line: { text: string; ts: number; content?: TurnContent };
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

export async function runBookTurn(durable: ReadingDurable, request: BookTurnRequest, context: Context): Promise<BookTurn> {
  const { runtime } = durable;
  const key = bookThreadKey(request.origin);
  durable.assembled.put(key, { history: request.history, tools: request.tools });
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
      excludeTs: request.line.ts,
    },
    context,
  );
  const { conversation } = started;
  const queuedTs = new Map<number, number>();
  let steerTs: Awaited<ReturnType<typeof steerTimestamps>> = new Map();
  let steerEntries = 0;
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

  const view = await conversation.viewState(context);
  const project = (value: ViewSource) => {
    request.onView(projectView(value, { startedAt: started.startedAt, steerTs, queuedTs, describe: request.describe }));
  };
  const follow = async (value: ViewSource) => {
    const live = value.docs["pi.live"] as Live | undefined;
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
    project(value);
  };
  const unsubscribe = view.subscribe((value) => follow(value));
  if (view.value) await follow(view.value);

  const settled = started.settled.then((result) => {
    watch.stop();
    unsubscribe();
    view.dispose();
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
