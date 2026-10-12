// The book's side of the durable runtime (docs/soul/87, 第一阶段): how a book
// thread's history is read for a request, which tools its desk offers, and how
// a settled turn lands in the book's conversation file.
//
// The origin of a book thread is today's book BoxOrigin plus `home`, the
// document whose thread file the conversation is written to (the book's, or a
// supplement's for a mark drawn on one, docs/67).

import type { Context } from "@earendil-works/chord";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { BoxOrigin } from "../../box";
import { toPiMessages } from "../../ai/providers";
import type { AgentTool } from "../../legion/execute/contract";
import type { HistoryReader, ThreadOrigin } from "../../legion/durable/extension";
import type { DeskResolver } from "../../legion/durable/tools";
import type { LandedRow, Lander } from "../../legion/durable/turn";
import { cacheTurn, usageReport, type Place, type PlaceShared } from "../../legion/durable/device";
import {
  storeThreadFiles,
  threadLander,
  threadMessageOf as placeMessageOf,
  type ThreadFiles,
} from "../../legion/durable/thread-files";
import type { ModelCallReport } from "../../ai/model-usage";
import type { CacheTurnInput, TurnTelemetry } from "../../platform/app/cache-telemetry";
import type { ThreadMessage } from "../../platform/app/threads";
import { composeMessages, HISTORY_KEEP, type ReadingTurnMessage } from "../desk-history";

export type BookOrigin = Extract<BoxOrigin, { place: "book" }> & { home: string };

/** The thread origin as `rp.thread` stores it. */
export function bookThreadOrigin(origin: BookOrigin): ThreadOrigin {
  return { ...origin } as ThreadOrigin;
}

export function asBookOrigin(origin: ThreadOrigin): BookOrigin {
  const o = origin as unknown as BookOrigin;
  if (o.place !== "book" || typeof o.home !== "string" || typeof o.threadId !== "string") {
    throw new Error("not a book thread origin");
  }
  return o;
}

/** The thread's key in `rp.conversations`. */
export function bookThreadKey(origin: Pick<BookOrigin, "home" | "threadId">): string {
  return `book:${origin.home}:${origin.threadId}`;
}

/** Who a book turn's requests are logged under, and how much of the book it inlined. */
export type BookTelemetry = Pick<TurnTelemetry, "surface" | "inline">;

/** What a turn assembled in this process for a thread: its history, its desk's tools, its log surface. */
export interface AssembledBookTurn {
  history: readonly ReadingTurnMessage[];
  tools: readonly AgentTool[];
  telemetry?: BookTelemetry;
}

/**
 * The turns assembled in this process, by thread key. The live turn's own
 * assembly (page window, aside's parent stretch, the desk's tools) is used
 * while it is there; a turn this process did not assemble — one resumed after
 * a restart — reads the file and opens the desk again.
 */
export class AssembledTurns {
  private readonly turns = new Map<string, AssembledBookTurn>();
  put(key: string, turn: AssembledBookTurn): void {
    this.turns.set(key, turn);
  }
  get(key: string): AssembledBookTurn | undefined {
    return this.turns.get(key);
  }
}

/** A book's thread files: the runtime's ThreadFiles, keyed by the document (`home`). */
export type BookThreads = ThreadFiles;

/** A thread store's calls as the book runtime uses them: the app's store, or a test's over a directory. */
export const storeBookThreads = storeThreadFiles;

/** The file's history, `HISTORY_KEEP` long, without the reader's line of this turn. */
export function bookHistoryFromFile(messages: readonly ThreadMessage[], excludeTs?: number): ReadingTurnMessage[] {
  const prior = messages
    .filter((m) => !(m.role === "user" && m.ts === excludeTs) && m.text.trim() !== "")
    .map((m): ReadingTurnMessage => ({ role: m.role, text: m.text }));
  return composeMessages({ parentTail: [], prior, keep: HISTORY_KEEP, aside: false, pageWindow: null });
}

export function bookHistoryReader(threads: BookThreads, assembled: AssembledTurns): HistoryReader {
  return async (origin, options) => {
    const book = asBookOrigin(origin);
    const live = assembled.get(bookThreadKey(book));
    if (!live) await threads.load(book.home);
    const history = live?.history ?? bookHistoryFromFile(threads.messages(book.home, book.threadId) ?? [], options.excludeTs);
    return toPiMessages([...history]);
  };
}

/** The book desk's tools: the live assembly's, or the book's delivery opener (soul/delivery.ts) after a restart. */
export function bookDeskResolver(
  assembled: AssembledTurns,
  open: (origin: BookOrigin, context: Context) => Promise<readonly AgentTool[]>,
): DeskResolver {
  return async (origin, context) => {
    const book = asBookOrigin(origin);
    return assembled.get(bookThreadKey(book))?.tools ?? open(book, context);
  };
}

export interface BookLandingDeps {
  threads: BookThreads;
  /** The reader-facing label of a tool call and whether it is quiet, from the catalog. */
  describe(name: string, args: unknown): { label: string; quiet?: true };
  /** Whether the reader is looking at this thread as the turn lands. */
  watching(origin: BookOrigin): boolean;
  /** The box card for a reply nobody saw (reading/turn/turn-box.ts). */
  card(origin: BookOrigin, ts: number, text: string): Promise<void>;
}

/** One landed row as the thread file stores it. */
export function threadMessageOf(row: LandedRow, deps: Pick<BookLandingDeps, "describe">): ThreadMessage {
  return placeMessageOf(row, deps);
}

/**
 * The book's lander (legion/durable/thread-files.ts threadLander): the thread
 * file is the document's (`home`), and the card is the book's.
 */
export function bookLander(deps: BookLandingDeps): Lander {
  return threadLander({
    threads: deps.threads,
    describe: deps.describe,
    origin: asBookOrigin,
    address: (book) => ({ key: book.home, threadId: book.threadId }),
    watching: deps.watching,
    card: deps.card,
  });
}

/** The book's place on the device runtime (legion/durable/device.ts). */
export function bookPlace(
  assembled: AssembledTurns,
  deps: Pick<BookLandingDeps, "watching" | "card"> & {
    openDesk(origin: BookOrigin, context: Context): Promise<readonly AgentTool[]>;
  },
): (shared: PlaceShared) => Place {
  return (shared) => {
    const telemetry = (book: BookOrigin): BookTelemetry =>
      assembled.get(bookThreadKey(book))?.telemetry ?? { surface: "reading" };
    return {
      key: (origin) => bookThreadKey(asBookOrigin(origin)),
      address: (origin) => {
        const book = asBookOrigin(origin);
        return { key: book.home, threadId: book.threadId };
      },
      resolve: bookDeskResolver(assembled, deps.openDesk),
      land: bookLander({ threads: shared.threads, describe: shared.describe, watching: deps.watching, card: deps.card }),
      readHistory: bookHistoryReader(shared.threads, assembled),
      telemetry: (origin) => {
        const book = asBookOrigin(origin);
        return { ...telemetry(book), thread: book.threadId, bookId: book.bookId };
      },
    };
  };
}

/** One provider response, for the model-call log. */
export function bookUsageReport(
  message: AssistantMessage,
  origin: ThreadOrigin,
  telemetry: BookTelemetry = { surface: "reading" },
): ModelCallReport {
  const book = asBookOrigin(origin);
  return usageReport(message, { ...telemetry, thread: book.threadId, bookId: book.bookId });
}

/** One provider response, for the cache log: the round and its start are the request's. */
export function bookCacheTurn(
  message: AssistantMessage,
  origin: ThreadOrigin,
  round: number,
  telemetry: BookTelemetry = { surface: "reading" },
): CacheTurnInput {
  return cacheTurn(message, round, { ...telemetry, thread: asBookOrigin(origin).threadId });
}

/** The reader's line of a turn, split off the assembled messages it ends. */
export function splitAssembled(messages: readonly ReadingTurnMessage[]): {
  history: ReadingTurnMessage[];
  line: Message | undefined;
} {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return { history: [...messages], line: undefined };
  return { history: messages.slice(0, -1), line: toPiMessages([last])[0] };
}
