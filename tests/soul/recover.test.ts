// Finishing the turn a dead process left open (src/soul/recover.ts).
//
// A process dies mid-tool in a book's conversation. The next one starts on a
// fresh session and answers the reader straight away, while the old session is
// resumed behind it: one model call, the answer written into the thread the
// question was asked in, a card in the box because nobody was looking, and then
// the old file is let go. A run with no stamp on it is aborted instead, and no
// request goes out for it.
// Run: scripts/t.sh tests/soul/recover.test.ts

import { beforeEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, type LaneSnapshot, type OpenOperation } from "@earendil-works/pi-agent-core";
import {
  Type,
  createAssistantMessageEventStream,
  type Api,
  type Context,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { holdHarness, type HeldRecovery, type HeldTurn } from "../../src/legion/execute/held";
import {
  runHarnessTurn,
  type AgentTool,
  type HarnessTurnParams,
  type StreamFn,
} from "../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../src/platform/app/session-fs";
import { registerDelivery, type Delivery } from "../../src/soul";
import {
  MAX_ATTEMPTS,
  RECOVERY_ATTEMPT,
  recoverSoulSession,
  type SendResumedTurn,
} from "../../src/soul/recover";
import { createBoxStore, type BoxStore } from "../../src/box";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import {
  createBookThread,
  getThread,
  rebuildThreadStoreForTests,
} from "../../src/platform/app/threads";
import { installAppData, type FakeDisk } from "../support/appdata-fake";
import { mapDisk } from "../support/map-disk";
import { memoryAppData, type MemoryDisk } from "../support/memory-appdata";
import { turnEvents, type Turn } from "../support/scripted-turn";

const ctx = BACKGROUND_CONTEXT;
const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;
const SOUL = { name: "soul", sessions: "soul" };
const BOOK = "book-hash";
const THREAD = "thread-1";
const NOW = new Date(2026, 8, 20, 9, 0, 0).getTime();

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

let appDisk: FakeDisk;
beforeEach(() => {
  appDisk = installAppData();
  rebuildThreadStoreForTests();
});

// One scripted stream per turn, recording the rounds it was asked for.
function scriptStream(turns: Turn[]): { fn: StreamFn; rounds: Message[][] } {
  let round = 0;
  const rounds: Message[][] = [];
  const fn: StreamFn = (_model, context: Context) => {
    const i = round++;
    rounds.push(context.messages);
    const stream = createAssistantMessageEventStream();
    const events = turnEvents(turns[i] ?? { error: "no scripted turn" });
    (async () => {
      for (const ev of events) {
        await Promise.resolve();
        stream.push(ev);
      }
      stream.end();
    })();
    return stream;
  };
  return { fn, rounds };
}

const echo: AgentTool = {
  name: "echo",
  label: () => "Running the fake tool",
  effect: "read" as const,
  description: "Echo the value back",
  parameters: Type.Object({ value: Type.String() }),
  execute: async (args) => `echo:${args.value}`,
};

function user(content: string): Message {
  return { role: "user", content, timestamp: 0 };
}

interface Outcome {
  done?: string;
  error?: string;
  rounds: Message[][];
}

async function turn(
  held: HarnessTurnParams["held"],
  prompt: Message[],
  turns: Turn[],
  extra: Partial<HarnessTurnParams> = {},
): Promise<Outcome> {
  const script = scriptStream(turns);
  const out: Outcome = { rounds: script.rounds };
  await runHarnessTurn({
    stream: script.fn,
    model: MODEL,
    messages: prompt,
    tools: [echo],
    maxRounds: 8,
    ...(held ? { held } : {}),
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onDone: (text) => {
      out.done = text;
    },
    onError: (message) => {
      out.error = message;
    },
    ...extra,
  });
  return out;
}

function sessionFiles(disk: MemoryDisk): string[] {
  return [...disk.files.keys()].filter((p) => p.includes("--session-soul--/") && p.endsWith(".jsonl")).sort();
}

function written(disk: MemoryDisk, path: string): string {
  return new TextDecoder().decode(disk.files.get(path)!);
}

// The book's opener, as reading registers one: the place says where the reply
// goes and what the desk holds. The recovery sends none of its messages — the
// prompt is already in the session — and uses its prompt, its tools and its key.
function bookDelivery(seen = false, gate?: Promise<void>): () => void {
  return registerDelivery("book", async (input) => {
    if (input.origin.place !== "book") return null;
    if (gate) await gate;
    return {
      key: input.origin.bookId,
      threadId: input.origin.threadId,
      turn: {
        systemPrompt: "the book is on the desk",
        tools: [echo],
        messages: [],
        refusal: "",
      },
      watching: () => seen,
    } satisfies Delivery;
  });
}

function boxStore(): { box: BoxStore; files: Map<string, string> } {
  const io = mapDisk();
  return { box: createBoxStore(io), files: io.files };
}

// The sender the recovery is given: the same turn the app runs, on a scripted
// stream, so the model calls it makes can be counted exactly.
function resumeSender(turns: Turn[]): { send: SendResumedTurn; rounds: Message[][] } {
  const script = scriptStream(turns);
  const send: SendResumedTurn = async (resumed) => {
    let answer = "";
    await runHarnessTurn({
      stream: script.fn,
      model: MODEL,
      systemPrompt: resumed.systemPrompt,
      messages: [],
      tools: resumed.tools,
      maxRounds: 8,
      held: resumed.harness,
      resume: resumed.operationId,
      ...(resumed.signal ? { signal: resumed.signal } : {}),
      onDelta: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onDone: (text, _assistant, turnText) => {
        answer = turnText ?? text;
      },
      onError: (message) => {
        throw new Error(message);
      },
    });
    return answer;
  };
  return { send, rounds: script.rounds };
}

// A process that dies with a tool in flight, leaving one open run on the
// group's newest session.
async function diedMidTool(
  disk: MemoryDisk,
  entered: string[],
  deliverTo?: Record<string, unknown>,
): Promise<void> {
  const held = holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(disk) });
  const hang: AgentTool = {
    ...echo,
    description: "never returns",
    execute: async (args) => {
      entered.push(`first:${args.value}`);
      await new Promise<void>(() => {});
      return "unreachable";
    },
  };
  void turn(
    held,
    [user("what does page 12 mean?")],
    [{ calls: [{ name: "echo", args: { value: "x" }, id: "c1" }] }, { text: "never sent" }],
    { tools: [hang], ...(deliverTo ? { deliverTo } : {}) },
  );
  await Bun.sleep(40);
  expect(entered).toEqual(["first:x"]);
  // The process dies: the session handle goes away with the turn still running.
  await held.close(ctx);
}

test("a turn interrupted mid-tool is finished on the old session while the new one answers", async () => {
  const disk = memoryAppData();
  const entered: string[] = [];
  createBookThread(BOOK, THREAD);
  await diedMidTool(disk, entered, { place: "book", bookId: BOOK, threadId: THREAD, page: 12 });

  // The place cannot be laid until the test says so, which is how "the reader
  // is not waiting on it" is pinned down: the fresh session answers first.
  let open = (): void => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const off = bookDelivery(false, gate);
  const { box, files } = boxStore();
  const resumed = resumeSender([{ text: "Page 12 is the turning point." }]);
  let recovery!: Promise<void>;
  try {
    const again = holdHarness({
      lane: SOUL,
      fileSystem: createSessionFileSystem(disk),
      recover: (previous, context) => {
        recovery = recoverSoulSession(
          previous,
          { lane: SOUL.name, settings: async () => settings, send: resumed.send, box, now: () => NOW },
          context,
        );
        return recovery;
      },
    });

    // This process's own turn, on its own session, answered without waiting.
    const next = await turn(again, [user("q2")], [{ text: "a2" }]);
    expect(next.done).toBe("a2");
    expect(next.rounds).toHaveLength(1);

    open();
    await recovery;
    await again.close(ctx);
  } finally {
    off();
  }

  // One model call to finish the interrupted turn, and the tool that was in
  // flight was not run a second time.
  expect(resumed.rounds).toHaveLength(1);
  expect(entered).toEqual(["first:x"]);

  // The answer landed in the thread the question was asked in.
  const thread = getThread(BOOK, THREAD);
  expect(thread?.messages.map((m) => [m.role, m.text])).toEqual([
    ["ai", "Page 12 is the turning point."],
  ]);
  expect(appDisk.files.size).toBeGreaterThan(0);

  // Nobody was looking at it, so there is a card pointing back at it.
  const items = [...files.values()].map((text) => JSON.parse(text) as Record<string, unknown>);
  expect(items).toHaveLength(1);
  expect(items[0]!.cover).toBe("Page 12 is the turning point.");
  expect(items[0]!.origin).toEqual({ place: "book", bookId: BOOK, threadId: THREAD, page: 12 });

  // The old file holds the resumed run, and this process's own session is the
  // other one.
  const written0 = written(disk, sessionFiles(disk)[0]!);
  expect(written0).toContain("Tool execution was interrupted");
  expect(written0).toContain("Page 12 is the turning point.");
  expect(written0).toContain(RECOVERY_ATTEMPT);
  expect(written(disk, sessionFiles(disk)[1]!)).toContain("a2");
});

test("a turn that never said where its answer goes is aborted, and the model is not called", async () => {
  const disk = memoryAppData();
  const entered: string[] = [];
  const off = bookDelivery();
  const resumed = resumeSender([{ text: "never sent" }]);
  try {
    await diedMidTool(disk, entered);
    let recovery!: Promise<void>;
    const again = holdHarness({
      lane: SOUL,
      fileSystem: createSessionFileSystem(disk),
      recover: (previous, context) => {
        recovery = recoverSoulSession(
          previous,
          { lane: SOUL.name, settings: async () => settings, send: resumed.send },
          context,
        );
        return recovery;
      },
    });
    const next = await turn(again, [user("q2")], [{ text: "a2" }]);
    expect(next.done).toBe("a2");
    await recovery;
    await again.close(ctx);
  } finally {
    off();
  }
  expect(resumed.rounds).toEqual([]);
  expect(written(disk, sessionFiles(disk)[0]!)).toContain("Tool execution was interrupted");
});

// --- the decision on its own, against a session that answers by hand ---------

interface Stub {
  previous: HeldRecovery;
  acquired: number;
  aborted: string[];
  notes: string[];
}

function stubRecovery(snapshot: Partial<LaneSnapshot>, open: OpenOperation[]): Stub {
  const stub: Stub = {
    acquired: 0,
    aborted: [],
    notes: [],
    previous: {
      open,
      acquire: async (_turn: HeldTurn) => {
        stub.acquired += 1;
        throw new Error("the lane should not have been borrowed");
      },
      inspect: async () =>
        ({ transcript: [], queues: [], ...snapshot }) as unknown as LaneSnapshot,
      note: async (_lane, customType) => void stub.notes.push(customType),
      abort: async (lane) => void stub.aborted.push(lane),
      settle: async () => {},
      close: async () => {},
    },
  };
  return stub;
}

const stamp = {
  id: "e1",
  parentId: null,
  seq: 1,
  timestamp: NOW,
  type: "custom" as const,
  customType: "reading-partner.delivery",
  data: { place: "book", bookId: BOOK, threadId: THREAD },
};

const attempt = (id: string) => ({ ...stamp, id, customType: RECOVERY_ATTEMPT, data: { at: NOW } });

test("a turn resumed twice already is given up on rather than resumed a third time", async () => {
  const off = bookDelivery();
  try {
    const stub = stubRecovery(
      { transcript: [stamp, attempt("a1"), attempt("a2")] as LaneSnapshot["transcript"] },
      [{ lane: "soul", operationId: "op-1", kind: "run", startedAt: NOW }],
    );
    await recoverSoulSession(stub.previous, { lane: "soul", settings: async () => settings });
    expect(stub.acquired).toBe(0);
    expect(stub.aborted).toEqual(["soul"]);
    expect(stub.notes).toEqual([]);
  } finally {
    off();
  }
});

// An attempt written while the run was open sits in the lane's queue until the
// run reaches a boundary. A process that died before that boundary still tried,
// and a count that only read the transcript would resume for ever.
test("an attempt still queued counts as an attempt", async () => {
  const off = bookDelivery();
  try {
    const stub = stubRecovery(
      {
        transcript: [stamp, attempt("a1")] as LaneSnapshot["transcript"],
        queues: [
          { entryId: "q1", kind: "write", type: "custom", customType: RECOVERY_ATTEMPT },
        ] as LaneSnapshot["queues"],
      },
      [{ lane: "soul", operationId: "op-1", kind: "run", startedAt: NOW }],
    );
    expect(MAX_ATTEMPTS).toBe(2);
    await recoverSoulSession(stub.previous, { lane: "soul", settings: async () => settings });
    expect(stub.acquired).toBe(0);
    expect(stub.aborted).toEqual(["soul"]);
  } finally {
    off();
  }
});

test("a compaction left open is aborted: it is nobody's answer", async () => {
  const stub = stubRecovery({ transcript: [stamp] as LaneSnapshot["transcript"] }, [
    { lane: "soul", operationId: "op-1", kind: "compaction", startedAt: NOW },
  ]);
  await recoverSoulSession(stub.previous, { lane: "soul", settings: async () => settings });
  expect(stub.acquired).toBe(0);
  expect(stub.aborted).toEqual(["soul"]);
});
