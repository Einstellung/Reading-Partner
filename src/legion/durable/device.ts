// The device's durable runtime and its places (docs/soul/87, "存储与 Harness"):
// one Harness for every conversation on the device, and each place — a book,
// the door, and the other surfaces as they move over — says how its threads
// are keyed, which thread file a turn lands in (docs/71, 对话按归属存), how a
// request's history is read, which desk serves its tools, and who its
// requests are logged under. What is the same for every place lives here:
// opening, recovering what the last process left, filing the steers that
// recovery withdrew, the model-call and cache logs, the turn log, and the
// "this conversation's turn has landed" event that input waiting for a busy
// conversation listens to.
//
// The places are handed in by whoever opens the runtime (the shell), so this
// file knows no domain.

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ConversationId } from "@earendil-works/pi-durable";
import { createAppModels } from "../../ai/durable-models";
import { recordModelCall, type ModelCallReport } from "../../ai/model-usage";
import {
  recordCacheTurn,
  resolveRetention,
  type AiSurface,
  type CacheTurnInput,
  type TurnTelemetry,
} from "../../platform/app/cache-telemetry";
import type { AgentTool } from "./contract";
import { toolLabel } from "./tool-result";
import { appTurnLog, type TurnLogSink } from "./turn-log-sink";
import { BACKGROUND_PLACE, backgroundPlace, type BackgroundHost } from "./background";
import { ThreadDoc, type HistoryReader, type ThreadOrigin, type TurnResult } from "./extension";
import { appDurableHost, openDurable, type DurableHost, type DurableRuntime } from "./harness";
import { recoverBeforeResume, type Recovered } from "./recover";
import { fileSteers, type Describe, type ThreadAddress, type ThreadFiles } from "./thread-files";
import type { DeskResolver } from "./tools";
import type { Lander } from "./turn";
import { DurableTurnLog } from "./turn-log";

/** The system prompt is one section: every turn starts from a reset, which writes every section anyway (docs/pitfall/517). */
export const TURN_SECTION = "turn";

/** Who a conversation's requests are logged under. */
export interface PlaceTelemetry {
  surface: AiSurface;
  /** The conversation's id in the logs: the thread. */
  thread: string;
  bookId?: string;
  inline?: TurnTelemetry["inline"];
}

/** What a place tells the runtime about its conversations. */
export interface Place {
  /** The conversation's key in `rp.conversations`. */
  key(origin: ThreadOrigin): string;
  /** The thread file a turn of this conversation lands in. */
  address(origin: ThreadOrigin): ThreadAddress;
  resolve: DeskResolver;
  land: Lander;
  readHistory: HistoryReader;
  telemetry(origin: ThreadOrigin): PlaceTelemetry;
}

/** What every place is built with. */
export interface PlaceShared {
  threads: ThreadFiles;
  describe: Describe;
  now: () => number;
}

export type PlaceFactory = (shared: PlaceShared) => Place;

export type SettledEvent = { conversationId: ConversationId; origin: ThreadOrigin; result: TurnResult };

export interface DeviceDurableOptions {
  catalog: readonly AgentTool[];
  places: Readonly<Record<string, PlaceFactory>>;
  threads: ThreadFiles;
  host?: DurableHost;
  models?: Models;
  dir?: string;
  rotateAtBytes?: number;
  now?: () => number;
  onReport?: (error: unknown) => void;
  /** Where the turn log's lines go (legion/durable/turn-log-sink.ts); the app's file unless said. */
  log?: TurnLogSink;
}

export interface DeviceDurable {
  runtime: DurableRuntime;
  /** What recovery did with the runs the last process left, for logging and tests. */
  recovered: Recovered[];
  /** Every conversation's diagnostic lines (turn-log.ts). */
  turnLog: DurableTurnLog;
  /** A tool call's label from the catalog, for a turn this process did not assemble. */
  describe: Describe;
  places: ReadonlyMap<string, Place>;
  onTurnSettled(listener: (event: SettledEvent) => void): () => void;
}

/** A tool call's reader-facing label and whether it is quiet, from the catalog. */
export function catalogDescribe(catalog: readonly AgentTool[]): Describe {
  const byName = new Map(catalog.map((tool) => [tool.name, tool]));
  return (name, args) => {
    const tool = byName.get(name);
    if (!tool) return { label: name };
    return { label: toolLabel(tool, args as Record<string, unknown>), ...(tool.quiet ? { quiet: true as const } : {}) };
  };
}

/** One provider response, for the model-call log. */
export function usageReport(message: AssistantMessage, telemetry: PlaceTelemetry): ModelCallReport {
  return {
    caller: telemetry.surface,
    ...(telemetry.bookId !== undefined ? { bookId: telemetry.bookId } : {}),
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    ok: message.stopReason !== "error",
  };
}

/** One provider response, for the cache log: the round and its start are the request's. */
export function cacheTurn(message: AssistantMessage, round: number, telemetry: PlaceTelemetry): CacheTurnInput {
  return {
    telemetry: {
      surface: telemetry.surface,
      ...(telemetry.inline !== undefined ? { inline: telemetry.inline } : {}),
      thread: telemetry.thread,
    },
    providerId: message.provider,
    modelId: message.model,
    round,
    startedAt: message.timestamp,
    usage: message.usage,
    ok: message.stopReason !== "error",
    retention: resolveRetention(),
  };
}

/** The steers a recovery withdrew go into their thread files at the moment they were said. */
export async function fileWithdrawnSteers(
  runtime: DurableRuntime,
  recovered: readonly Recovered[],
  places: ReadonlyMap<string, Pick<Place, "address">>,
  threads: ThreadFiles,
  now: () => number,
  context: Context,
): Promise<void> {
  let wrote = false;
  for (const run of recovered) {
    if (run.steers.length === 0) continue;
    const origin = (await runtime.harness.snapshot(ThreadDoc, run.conversationId, context))?.origin;
    const place = origin ? places.get(origin.place) : undefined;
    if (!origin || !place) continue;
    if (await fileSteers(threads, place.address(origin), run.steers, now)) wrote = true;
  }
  if (wrote) await threads.flush();
}

/** What a background run needs from the device runtime (background.ts). */
export function deviceBackgroundHost(device: DeviceDurable): BackgroundHost {
  return { runtime: device.runtime, ended: (key, result) => device.turnLog.end(key, result) };
}

export async function openDeviceDurable(options: DeviceDurableOptions): Promise<DeviceDurable> {
  const { threads } = options;
  const now = options.now ?? Date.now;
  const describe = catalogDescribe(options.catalog);
  const places = new Map(
    Object.entries({ ...options.places, [BACKGROUND_PLACE]: backgroundPlace }).map(([name, make]) => [name, make({ threads, describe, now })] as const),
  );
  const placeOf = (origin: ThreadOrigin) => places.get(origin.place);
  const listeners = new Set<(event: SettledEvent) => void>();
  const turnLog = new DurableTurnLog(options.log ?? appTurnLog, now);
  const runtime = await openDurable({
    host: options.host ?? appDurableHost(),
    models: options.models ?? createAppModels(),
    catalog: options.catalog,
    resolvers: Object.fromEntries([...places].map(([name, place]) => [name, place.resolve])),
    landers: Object.fromEntries([...places].map(([name, place]) => [name, place.land])),
    readHistory: async (origin, read, context) => (await placeOf(origin)?.readHistory(origin, read, context)) ?? [],
    onRequest: (about) => {
      const place = placeOf(about.origin);
      if (!place) return;
      const telemetry = place.telemetry(about.origin);
      turnLog.request(place.key(about.origin), about.round, {
        surface: telemetry.surface,
        conversation: telemetry.thread,
        provider: about.model?.provider ?? "",
        model: about.model?.modelId ?? "",
      }, about.turn);
    },
    recordResponse: (message, about) => {
      const place = placeOf(about.origin);
      if (!place) return;
      // A turn resumed after a restart was not assembled here: the place logs it under its default surface.
      const telemetry = place.telemetry(about.origin);
      recordModelCall(usageReport(message, telemetry));
      recordCacheTurn(cacheTurn(message, about.round, telemetry));
      turnLog.response(place.key(about.origin), about.round, message.stopReason);
    },
    recordChildResponse: (message, about) => {
      const telemetry: PlaceTelemetry = { surface: "subagent", thread: `subagent:${about.conversationId}` };
      recordModelCall(usageReport(message, telemetry));
      recordCacheTurn(cacheTurn(message, about.round, telemetry));
    },
    onSettled: (conversationId, origin, result, startedAt, turn) => {
      const place = placeOf(origin);
      if (place) {
        const key = place.key(origin);
        turnLog.end(key, result);
        turnLog.endUnbegun(key, result, place.telemetry(origin).thread, startedAt, turn);
      }
      for (const listener of listeners) listener({ conversationId, origin, result });
    },
    sectionKeys: [TURN_SECTION],
    ...(options.dir ? { dir: options.dir } : {}),
    ...(options.rotateAtBytes ? { rotateAtBytes: options.rotateAtBytes } : {}),
    now,
    ...(options.onReport ? { onReport: options.onReport } : {}),
  });
  const recovered = await recoverBeforeResume(runtime, BACKGROUND_CONTEXT);
  await fileWithdrawnSteers(runtime, recovered, places, threads, now, BACKGROUND_CONTEXT);
  return {
    runtime,
    recovered,
    turnLog,
    describe,
    places,
    onTurnSettled(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
