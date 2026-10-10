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
import { persistedTrace, type ToolStatus } from "../../ai/turn-view/tool-status";
import type { AgentTool } from "../../legion/execute/contract";
import type { HistoryReader, ThreadOrigin } from "../../legion/durable/extension";
import type { DeskResolver } from "../../legion/durable/tools";
import type { LandedRow, LandedTurn, Lander } from "../../legion/durable/turn";
import type { ModelCallReport } from "../../ai/model-usage";
import { resolveRetention, type CacheTurnInput, type TurnTelemetry } from "../../platform/app/cache-telemetry";
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

export interface BookThreads {
  messages(home: string, threadId: string): readonly ThreadMessage[] | undefined;
  append(home: string, threadId: string, message: ThreadMessage): void;
  flush(): Promise<void>;
}

/** The file's history, `HISTORY_KEEP` long, without the reader's line of this turn. */
export function bookHistoryFromFile(messages: readonly ThreadMessage[], excludeTs?: number): ReadingTurnMessage[] {
  const prior = messages
    .filter((m) => m.ts !== excludeTs && m.text.trim() !== "")
    .map((m): ReadingTurnMessage => ({ role: m.role, text: m.text }));
  return composeMessages({ parentTail: [], prior, keep: HISTORY_KEEP, aside: false, pageWindow: null });
}

export function bookHistoryReader(threads: BookThreads, assembled: AssembledTurns): HistoryReader {
  return async (origin, options) => {
    const book = asBookOrigin(origin);
    const live = assembled.get(bookThreadKey(book));
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
  if (row.role === "user") return { role: "user", text: row.text, ts: row.ts };
  const statuses = row.tools.map((tool): ToolStatus => {
    const { label, quiet } = deps.describe(tool.name, tool.args);
    const receipt = tool.details as ToolStatus["receipt"] | undefined;
    return {
      name: tool.name,
      label,
      state: tool.isError ? "error" : "done",
      ...(receipt ? { receipt } : {}),
      ...(quiet ? { quiet } : {}),
    };
  });
  const trace = persistedTrace(statuses);
  return {
    role: "ai",
    text: row.text,
    ts: row.ts,
    ...(trace && trace.length > 0 ? { parts: [{ type: "trace" as const, tools: trace }] } : {}),
  };
}

/**
 * The book's lander. Rows go into the thread file, a row whose role and
 * timestamp are already there skipped (a landing rerun after a kill), then the
 * file is flushed, and only then is a card put — and none when the reader is
 * looking at the thread (soul/landing.ts's order). A refusal is not written: it
 * is the app talking, shown on the row and never replayed as the model's words.
 *
 * A bell's turn puts no card here: the bell puts the run's own (soul/bell.ts).
 * Its replies before the reader said anything are stamped with the run they
 * answer, as soul/landing.ts stamps a bell's reply.
 */
export function bookLander(deps: BookLandingDeps): Lander {
  return async (origin, turn: LandedTurn) => {
    const book = asBookOrigin(origin);
    const have = new Set((deps.threads.messages(book.home, book.threadId) ?? []).map((m) => `${m.role}:${m.ts}`));
    let wrote = false;
    let readerSpoke = false;
    for (const row of turn.rows) {
      if (row.role === "user") readerSpoke = true;
      const runId = turn.bell?.runId;
      const message = {
        ...threadMessageOf(row, deps),
        ...(runId && row.role === "assistant" && !readerSpoke ? { origin: { runId } } : {}),
      };
      if (have.has(`${message.role}:${message.ts}`)) continue;
      deps.threads.append(book.home, book.threadId, message);
      wrote = true;
    }
    if (wrote) await deps.threads.flush();
    if (turn.refusal !== undefined || turn.bell || deps.watching(book)) return;
    const reply = [...turn.rows].reverse().find((row) => row.role === "assistant");
    if (!reply) return;
    await deps.card(book, reply.ts, reply.text);
  };
}

/** One provider response, for the model-call log. */
export function bookUsageReport(
  message: AssistantMessage,
  origin: ThreadOrigin,
  telemetry: BookTelemetry = { surface: "reading" },
): ModelCallReport {
  const book = asBookOrigin(origin);
  return {
    caller: telemetry.surface,
    bookId: book.bookId,
    provider: message.provider,
    model: message.model,
    usage: message.usage,
    ok: message.stopReason !== "error",
  };
}

/** One provider response, for the cache log: the round and its start are the request's. */
export function bookCacheTurn(
  message: AssistantMessage,
  origin: ThreadOrigin,
  round: number,
  telemetry: BookTelemetry = { surface: "reading" },
): CacheTurnInput {
  const book = asBookOrigin(origin);
  return {
    telemetry: { ...telemetry, thread: book.threadId },
    providerId: message.provider,
    modelId: message.model,
    round,
    startedAt: message.timestamp,
    usage: message.usage,
    ok: message.stopReason !== "error",
    retention: resolveRetention(),
  };
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
