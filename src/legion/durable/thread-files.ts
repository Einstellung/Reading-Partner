// Where a settled turn lands (docs/soul/87, "落盘"; docs/71 对话按归属存):
// every place's conversation is a thread in a thread file — a book's, a day at
// the door's — so landing is the same for all of them. The place only says
// which file and which thread (ThreadAddress), whether the reader is looking,
// and which box card a reply nobody saw gets.

import { persistedTrace, type ToolStatus } from "../../ai/turn-view/tool-status";
import type { ThreadMessage, ThreadStore } from "../../platform/app/threads";
import type { ThreadOrigin } from "./extension";
import type { LandedRow, LandedTurn, Lander, WithdrawnSteer } from "./turn";

/** A conversation's thread: the thread store's key for its file, and the thread in it. */
export interface ThreadAddress {
  key: string;
  threadId: string;
}

export interface ThreadFiles {
  /**
   * Read the thread file into memory. The app's store drops appends to a file it
   * has not loaded, and a turn recovered at startup lands before any surface
   * has opened it (docs/pitfall/523).
   */
  load(key: string): Promise<void>;
  messages(key: string, threadId: string): readonly ThreadMessage[] | undefined;
  append(key: string, threadId: string, message: ThreadMessage): void;
  flush(): Promise<void>;
}

/** A thread store's calls as the runtime uses them: the app's store, or a test's over a directory. */
export function storeThreadFiles(store: Pick<ThreadStore, "load" | "get" | "append" | "flush">): ThreadFiles {
  return {
    load: async (key) => {
      await store.load(key);
    },
    messages: (key, threadId) => store.get(key, threadId)?.messages,
    append: (key, threadId, message) => {
      store.append(key, threadId, message);
    },
    flush: () => store.flush(),
  };
}

export type Describe = (name: string, args: unknown) => { label: string; quiet?: true };

/** One landed row as the thread file stores it. */
export function threadMessageOf(row: LandedRow, deps: { describe: Describe }): ThreadMessage {
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

export interface ThreadLanding<O> {
  threads: ThreadFiles;
  describe: Describe;
  /** The place's own origin off `rp.thread`; throws for an origin of another place. */
  origin(origin: ThreadOrigin): O;
  address(origin: O): ThreadAddress;
  /** Whether the reader is looking at this conversation as the turn lands. */
  watching(origin: O): boolean;
  /** The box card for a reply nobody saw. */
  card(origin: O, ts: number, text: string): Promise<void>;
}

/**
 * A place's lander. Rows go into the thread file, a row whose role and
 * timestamp are already there skipped (a landing rerun after a kill), then the
 * file is flushed, and only then is a card put — and none when the reader is
 * looking at the conversation (soul/landing.ts's order). A refusal is not
 * written: it is the app talking, shown on the row and never replayed as the
 * model's words.
 *
 * A bell's turn puts no card here: the bell puts the run's own (soul/bell.ts).
 * Its replies before the reader said anything are stamped with the run they
 * answer, as soul/landing.ts stamps a bell's reply.
 */
export function threadLander<O>(deps: ThreadLanding<O>): Lander {
  return async (raw, turn: LandedTurn) => {
    const origin = deps.origin(raw);
    const { key, threadId } = deps.address(origin);
    await deps.threads.load(key);
    const have = new Set((deps.threads.messages(key, threadId) ?? []).map((m) => `${m.role}:${m.ts}`));
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
      deps.threads.append(key, threadId, message);
      wrote = true;
    }
    if (wrote) await deps.threads.flush();
    if (turn.refusal !== undefined || turn.bell || deps.watching(origin)) return;
    const reply = [...turn.rows].reverse().find((row) => row.role === "assistant");
    if (!reply) return;
    await deps.card(origin, reply.ts, reply.text);
  };
}

/** The steers a recovery withdrew go into their thread file at the moment they were said. True when any were written. */
export async function fileSteers(
  threads: ThreadFiles,
  { key, threadId }: ThreadAddress,
  steers: readonly WithdrawnSteer[],
  now: () => number,
): Promise<boolean> {
  if (steers.length === 0) return false;
  await threads.load(key);
  const have = new Set((threads.messages(key, threadId) ?? []).map((m) => `${m.role}:${m.ts}`));
  let wrote = false;
  for (const steer of steers) {
    const ts = steer.ts ?? now();
    if (have.has(`user:${ts}`)) continue;
    threads.append(key, threadId, { role: "user", text: steer.text, ts });
    wrote = true;
  }
  return wrote;
}
