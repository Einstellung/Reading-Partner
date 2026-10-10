// The reading side of the device's durable runtime (docs/soul/87, 第一阶段):
// what `openDurable` is handed for book threads, and what the app does with it
// at start — open, sort out what the last process left running, put the steers
// that sorting withdrew into their thread files, then resume.
//
// A book turn that the previous process left on the old soul session is still
// finished by soul/recover.ts; the two runtimes run side by side until the
// other turn surfaces move.
//
// `onTurnSettled` says when a conversation's `rp.turn` has landed and the
// conversation is free again. Input meant for a busy conversation waits for it
// rather than being queued in pi-durable as a follow-up.

import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ConversationId } from "@earendil-works/pi-durable";
import { recordModelCall } from "../../ai/model-usage";
import { recordCacheTurn } from "../../platform/app/cache-telemetry";
import { createAppModels } from "../../ai/durable-models";
import { toolLabel } from "../../legion/execute/tool-result";
import type { AgentTool } from "../../legion/execute/contract";
import { ThreadDoc, type ThreadOrigin, type TurnResult } from "../../legion/durable/extension";
import { appDurableHost, openDurable, type DurableHost, type DurableRuntime } from "../../legion/durable/harness";
import { recoverBeforeResume, type Recovered } from "../../legion/durable/recover";
import { appendMessage, flushThreads, getThread } from "../../platform/app/threads";
import { loadSettings } from "../../platform/app/settings";
import { deliveryOpener } from "../../soul/delivery";
import {
  AssembledTurns,
  asBookOrigin,
  bookDeskResolver,
  bookHistoryReader,
  bookCacheTurn,
  bookLander,
  bookThreadKey,
  bookUsageReport,
  type BookLandingDeps,
  type BookOrigin,
  type BookThreads,
} from "./durable-book";
import { boxUnseenTurn } from "./turn-box";

/** The system prompt is one section: every turn starts from a reset, which writes every section anyway (docs/pitfall/517). */
export const TURN_SECTION = "turn";

export type SettledEvent = { conversationId: ConversationId; origin: ThreadOrigin; result: TurnResult };

export interface ReadingDurableOptions {
  catalog: readonly AgentTool[];
  host?: DurableHost;
  models?: Models;
  threads?: BookThreads;
  /** Whether the reader is looking at a book thread; the reading session sets it. */
  watching?: (origin: BookOrigin) => boolean;
  card?: BookLandingDeps["card"];
  openDesk?: (origin: BookOrigin, context: Context) => Promise<readonly AgentTool[]>;
  dir?: string;
  rotateAtBytes?: number;
  now?: () => number;
  onReport?: (error: unknown) => void;
}

export interface ReadingDurable {
  runtime: DurableRuntime;
  assembled: AssembledTurns;
  /** What recovery did with the runs the last process left, for logging and tests. */
  recovered: Recovered[];
  /** A tool call's label from the catalog, for a turn this process did not assemble. */
  describe(name: string, args: unknown): { label: string; quiet?: true };
  onTurnSettled(listener: (event: SettledEvent) => void): () => void;
}

const appThreads: BookThreads = {
  messages: (home, threadId) => getThread(home, threadId)?.messages,
  append: (home, threadId, message) => appendMessage(home, threadId, message),
  flush: () => flushThreads(),
};

async function openBookDesk(origin: BookOrigin): Promise<readonly AgentTool[]> {
  const open = deliveryOpener("book");
  if (!open) throw new Error("no delivery opener registered for books");
  const delivery = await open({ origin, settings: await loadSettings(), bell: "" });
  return delivery?.turn.tools ?? [];
}

/** The steers a recovery withdrew go into their thread files at the moment they were said. */
export async function landWithdrawnSteers(
  runtime: DurableRuntime,
  recovered: readonly Recovered[],
  threads: BookThreads,
  now: () => number,
  context: Context,
): Promise<void> {
  let wrote = false;
  for (const run of recovered) {
    if (run.steers.length === 0) continue;
    const origin = (await runtime.harness.snapshot(ThreadDoc, run.conversationId, context))?.origin;
    if (origin?.place !== "book") continue;
    const book = asBookOrigin(origin);
    const have = new Set((threads.messages(book.home, book.threadId) ?? []).map((m) => `${m.role}:${m.ts}`));
    for (const steer of run.steers) {
      const ts = steer.ts ?? now();
      if (have.has(`user:${ts}`)) continue;
      threads.append(book.home, book.threadId, { role: "user", text: steer.text, ts });
      wrote = true;
    }
  }
  if (wrote) await threads.flush();
}

export async function openReadingDurable(options: ReadingDurableOptions): Promise<ReadingDurable> {
  const threads = options.threads ?? appThreads;
  const assembled = new AssembledTurns();
  const listeners = new Set<(event: SettledEvent) => void>();
  const byName = new Map(options.catalog.map((tool) => [tool.name, tool]));
  const describe = (name: string, args: unknown) => {
    const tool = byName.get(name);
    if (!tool) return { label: name };
    return { label: toolLabel(tool, args as Record<string, unknown>), ...(tool.quiet ? { quiet: true as const } : {}) };
  };
  const now = options.now ?? Date.now;
  const landing: BookLandingDeps = {
    threads,
    describe,
    watching: (origin) => options.watching?.(origin) ?? false,
    card:
      options.card ??
      ((origin, ts, text) =>
        boxUnseenTurn({
          threadId: origin.threadId,
          ts,
          bookId: origin.bookId,
          ...(origin.annotationId ? { annotationId: origin.annotationId } : {}),
          ...(origin.page !== undefined ? { page: origin.page } : {}),
          outcome: { kind: "answer", text },
        })),
  };
  const readBook = bookHistoryReader(threads, assembled);
  const runtime = await openDurable({
    host: options.host ?? appDurableHost(),
    models: options.models ?? createAppModels(),
    catalog: options.catalog,
    resolvers: { book: bookDeskResolver(assembled, options.openDesk ?? openBookDesk) },
    landers: { book: bookLander(landing) },
    readHistory: async (origin, read, context) => (origin.place === "book" ? readBook(origin, read, context) : []),
    recordResponse: (message, about) => {
      if (about.origin.place !== "book") return;
      // A turn resumed after a restart was not assembled here: it is logged as reading, inline unknown.
      const telemetry = assembled.get(bookThreadKey(asBookOrigin(about.origin)))?.telemetry;
      recordModelCall(bookUsageReport(message, about.origin, telemetry));
      recordCacheTurn(bookCacheTurn(message, about.origin, about.round, telemetry));
    },
    onSettled: (conversationId, origin, result) => {
      for (const listener of listeners) listener({ conversationId, origin, result });
    },
    sectionKeys: [TURN_SECTION],
    ...(options.dir ? { dir: options.dir } : {}),
    ...(options.rotateAtBytes ? { rotateAtBytes: options.rotateAtBytes } : {}),
    now,
    ...(options.onReport ? { onReport: options.onReport } : {}),
  });
  const recovered = await recoverBeforeResume(runtime, BACKGROUND_CONTEXT);
  await landWithdrawnSteers(runtime, recovered, threads, now, BACKGROUND_CONTEXT);
  return {
    runtime,
    assembled,
    recovered,
    describe,
    onTurnSettled(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let started: Promise<ReadingDurable> | undefined;
const watchingProbes = new Set<(origin: BookOrigin) => boolean>();

/**
 * A surface that shows book threads (the reading session, the phone lesson)
 * says how to tell whether the reader is looking at one; the returned function
 * takes it back.
 */
export function setBookWatching(probe: (origin: BookOrigin) => boolean): () => void {
  watchingProbes.add(probe);
  return () => watchingProbes.delete(probe);
}

/** Open the device's durable runtime once, at app start. Failures are logged; the next call tries again. */
export function startReadingDurable(catalog: () => readonly AgentTool[]): Promise<ReadingDurable> {
  started ??= openReadingDurable({
    catalog: catalog(),
    watching: (origin) => [...watchingProbes].some((probe) => probe(origin)),
    onReport: (error) => console.warn("durable runtime", error),
  }).catch((error: unknown) => {
    started = undefined;
    throw error;
  });
  return started;
}

/** The runtime once started, or undefined before startReadingDurable ran. */
export function readingDurable(): Promise<ReadingDurable> | undefined {
  return started;
}
