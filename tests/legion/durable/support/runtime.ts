// A durable runtime for tests: the bun:sqlite stand-in for the Rust host, the
// faux provider, two desk tools (a replay-safe read, an unsafe write with a
// receipt) whose behaviour each test supplies, a conversation file kept as a
// JSONL file under the root (so a killed child and its parent share it), and
// a history reader over that file.

import { Type, type Message } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { durableSqliteSize, openDurableSqlite, removeDurableSqlite } from "../../../../src/platform/app/durable-sqlite";
import type { AgentTool } from "../../../../src/legion/execute/contract";
import { openDurable, type DurableHost, type DurableRuntime } from "../../../../src/legion/durable/harness";
import type { LandedRow, LandedTurn } from "../../../../src/legion/durable/turn";
import type { ThreadOrigin } from "../../../../src/legion/durable/extension";
import { bunSqliteHost } from "../../../platform/app/durable-sqlite-host";

export const ORIGIN: ThreadOrigin = { place: "book", bookId: "b1", threadId: "t1" };
export const KEY = "book:b1:t1";

export function testHost(root: string): DurableHost {
  const call = bunSqliteHost(root);
  return {
    open: (path) => openDurableSqlite(path, call),
    remove: (path) => removeDurableSqlite(path, call),
    size: (path) => durableSqliteSize(path, call),
    list: async (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []),
  };
}

export interface DeskBehaviour {
  lookup?(query: string): Promise<string>;
  note?(text: string): Promise<string>;
}

function catalog(behaviour: DeskBehaviour): AgentTool[] {
  return [
    {
      name: "lookup",
      description: "Look up a passage in the open book.",
      parameters: Type.Object({ query: Type.String() }),
      label: () => "Looking up",
      effect: "read",
      replay: "safe",
      execute: async (args) => (behaviour.lookup ? behaviour.lookup(String(args.query)) : `text of ${args.query}`),
    },
    {
      name: "note",
      description: "Write a note into the reader's notebook.",
      parameters: Type.Object({ text: Type.String() }),
      label: () => "Writing a note",
      effect: "write",
      execute: async (args) => {
        const text = behaviour.note ? await behaviour.note(String(args.text)) : "noted";
        return { text, receipt: { kind: "note", text: String(args.text) } as never };
      },
    },
  ];
}

/** The conversation file: one JSON row per line, a row whose ts is already there is skipped. */
export class ThreadFile {
  constructor(readonly path: string) {}

  rows(): (LandedRow & { status?: string; refusal?: string })[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  append(row: Record<string, unknown> & { ts: number }): void {
    if (this.rows().some((r) => r.ts === row.ts)) return;
    appendFileSync(this.path, `${JSON.stringify(row)}\n`);
  }

  land(turn: LandedTurn): void {
    for (const row of turn.rows) this.append(row);
    if (turn.refusal !== undefined) {
      const last = turn.rows[turn.rows.length - 1]?.ts ?? 0;
      this.append({ role: "assistant", ts: last + 1, text: turn.refusal, tools: [], refusal: turn.refusal });
    }
  }

  /** What the history reader hands the model: the rows as plain messages. */
  history(excludeTs?: number): Message[] {
    return this.rows()
      .filter((row) => row.ts !== excludeTs)
      .map((row) =>
        row.role === "user"
          ? { role: "user", content: row.text, timestamp: row.ts }
          : ({
              role: "assistant",
              content: [{ type: "text", text: row.text }],
              api: "faux",
              provider: "faux",
              model: "faux-1",
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
              stopReason: "stop",
              timestamp: row.ts,
            } as Message),
      );
  }
}

export interface TestRuntimeOptions {
  root: string;
  responses: FauxResponseStep[];
  tokensPerSecond?: number;
  contextWindow?: number;
  desk?: DeskBehaviour;
  /** Called inside the lander after the file is written, before it returns. */
  afterLand?: () => Promise<void>;
  rotateAtBytes?: number;
  now?: () => number;
}

export interface TestRuntime {
  runtime: DurableRuntime;
  file: ThreadFile;
  /** The non-system messages of every request the faux provider got, as `role:text`. */
  requests: string[][];
  historyCalls: { excludeTs?: number }[];
  recorded: number;
}

export function messageLine(message: Message): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return `${message.role}:${content}`;
  const text = (content as { type: string; text?: string; name?: string }[])
    .map((p) => (p.type === "text" ? p.text : p.type === "toolCall" ? `[${p.name}]` : ""))
    .join("");
  return `${message.role}:${text}`;
}

export async function openTestRuntime(options: TestRuntimeOptions): Promise<TestRuntime> {
  mkdirSync(options.root, { recursive: true });
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 5000,
    tokenSize: { min: 1, max: 2 },
    models: [{ id: "faux-1", contextWindow: options.contextWindow ?? 200_000, maxTokens: 4096 }],
  });
  const result: TestRuntime = {
    runtime: undefined as never,
    file: new ThreadFile(join(options.root, "thread.jsonl")),
    requests: [],
    historyCalls: [],
    recorded: 0,
  };
  faux.setResponses(
    options.responses.map((step) =>
      typeof step === "function"
        ? (context, streamOptions, state, model) => {
            result.requests.push(context.messages.filter((m) => m.role !== "system").map(messageLine));
            return step(context, streamOptions, state, model);
          }
        : (context) => {
            result.requests.push(context.messages.filter((m) => m.role !== "system").map(messageLine));
            return step;
          },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const tools = catalog(options.desk ?? {});
  result.runtime = await openDurable({
    host: testHost(options.root),
    models,
    catalog: tools,
    resolvers: { book: async () => tools },
    landers: {
      book: async (_origin, turn) => {
        result.file.land(turn);
        await options.afterLand?.();
      },
    },
    readHistory: async (_origin, { excludeTs }) => {
      result.historyCalls.push(excludeTs === undefined ? {} : { excludeTs });
      return result.file.history(excludeTs);
    },
    recordResponse: () => {
      result.recorded++;
    },
    sectionKeys: ["soul", "desk"],
    ...(options.rotateAtBytes !== undefined ? { rotateAtBytes: options.rotateAtBytes } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return result;
}

/** Write the reader's line to the file, as the surface does, and return the turn request for it. */
export function readerTurn(t: TestRuntime, text: string, ts: number, extra: Record<string, unknown> = {}) {
  t.file.append({ role: "user", ts, text });
  return {
    key: KEY,
    origin: ORIGIN,
    content: text,
    sections: { soul: "You are a reading partner.", desk: "The open book: Tides." },
    tools: ["lookup", "note"],
    model: { provider: "faux", modelId: "faux-1" },
    excludeTs: ts,
    ...extra,
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
