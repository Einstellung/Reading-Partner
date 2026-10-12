// The device's durable runtime as the app opens it (docs/soul/87): the
// place-generic runtime (legion/durable/device.ts) with the book's place, and
// whatever other places the shell hands in (the door, …). At start it opens,
// sorts out what the last process left running, puts the steers that sorting
// withdrew into their thread files, then resumes.
//
// A turn that the previous process left on the old soul session is still
// finished by soul/recover.ts; the two runtimes run side by side until every
// turn surface has moved.
//
// `onTurnSettled` says when a conversation's `rp.turn` has landed and the
// conversation is free again. Input meant for a busy conversation waits for it
// rather than being queued in pi-durable as a follow-up.

import type { Context } from "@earendil-works/chord";
import type { Models } from "@earendil-works/pi-ai/models";
import type { AgentTool } from "../../legion/execute/contract";
import type { TurnLogSink } from "../../legion/execute/turn-log";
import { provideBackgroundHost } from "../../legion/durable/background";
import {
  deviceBackgroundHost,
  fileWithdrawnSteers,
  openDeviceDurable,
  type DeviceDurable,
  type PlaceFactory,
} from "../../legion/durable/device";
import type { DurableHost, DurableRuntime } from "../../legion/durable/harness";
import type { Recovered } from "../../legion/durable/recover";
import { appendMessage, flushThreads, getThread, loadThreads } from "../../platform/app/threads";
import { loadSettings } from "../../platform/app/settings";
import { deliveryOpener } from "../../soul/delivery";
import {
  AssembledTurns,
  bookPlace,
  storeBookThreads,
  type BookLandingDeps,
  type BookOrigin,
  type BookThreads,
} from "./durable-book";
import { boxUnseenTurn } from "./turn-box";

export { TURN_SECTION, type SettledEvent } from "../../legion/durable/device";

export interface ReadingDurableOptions {
  catalog: readonly AgentTool[];
  host?: DurableHost;
  models?: Models;
  threads?: BookThreads;
  /** Whether the reader is looking at a book thread; the reading session sets it. */
  watching?: (origin: BookOrigin) => boolean;
  card?: BookLandingDeps["card"];
  openDesk?: (origin: BookOrigin, context: Context) => Promise<readonly AgentTool[]>;
  /** The places beside the book's, by place name. */
  places?: Readonly<Record<string, PlaceFactory>>;
  dir?: string;
  rotateAtBytes?: number;
  now?: () => number;
  onReport?: (error: unknown) => void;
  /** Where the turn log's lines go (legion/execute/turn-log.ts); the app's file unless said. */
  log?: TurnLogSink;
}

export interface ReadingDurable extends DeviceDurable {
  /** The book turns assembled in this process (durable-book.ts). */
  assembled: AssembledTurns;
}

export const appThreads = storeBookThreads({ load: loadThreads, get: getThread, append: appendMessage, flush: flushThreads });

async function openBookDesk(origin: BookOrigin): Promise<readonly AgentTool[]> {
  const open = deliveryOpener("book");
  if (!open) throw new Error("no delivery opener registered for books");
  const delivery = await open({ origin, settings: await loadSettings(), bell: "" });
  return delivery?.turn.tools ?? [];
}

/** The steers a recovery withdrew from book threads go into their thread files at the moment they were said. */
export async function landWithdrawnSteers(
  runtime: DurableRuntime,
  recovered: readonly Recovered[],
  threads: BookThreads,
  now: () => number,
  context: Context,
): Promise<void> {
  const book = bookPlace(new AssembledTurns(), { watching: () => false, card: async () => {}, openDesk: async () => [] });
  const place = book({ threads, describe: (name) => ({ label: name }), now });
  await fileWithdrawnSteers(runtime, recovered, new Map([["book", place]]), threads, now, context);
}

export async function openReadingDurable(options: ReadingDurableOptions): Promise<ReadingDurable> {
  const assembled = new AssembledTurns();
  const book = bookPlace(assembled, {
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
    openDesk: options.openDesk ?? openBookDesk,
  });
  const device = await openDeviceDurable({
    catalog: options.catalog,
    places: { ...options.places, book },
    threads: options.threads ?? appThreads,
    ...(options.host ? { host: options.host } : {}),
    ...(options.models ? { models: options.models } : {}),
    ...(options.dir ? { dir: options.dir } : {}),
    ...(options.rotateAtBytes ? { rotateAtBytes: options.rotateAtBytes } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.onReport ? { onReport: options.onReport } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
  return { ...device, assembled };
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

/**
 * Open the device's durable runtime once, at app start, with the places the
 * shell hands in beside the book's. Failures are logged; the next call tries again.
 */
export function startReadingDurable(
  catalog: () => readonly AgentTool[],
  places: () => Readonly<Record<string, PlaceFactory>> = () => ({}),
): Promise<ReadingDurable> {
  // Background passes (distillation, lesson prep, link take) run on this runtime too.
  provideBackgroundHost(() => started?.then(deviceBackgroundHost));
  started ??= openReadingDurable({
    catalog: catalog(),
    places: places(),
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
