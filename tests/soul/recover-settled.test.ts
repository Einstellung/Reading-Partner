// A turn of a conversation that already has an answer, interrupted and
// finished on a real session (src/soul/recover.ts).
//
// A turn's prompt is the conversation so far (docs/71), so the branch the run
// stands on holds the previous answers as assistant messages ahead of anything
// this turn said. What lands is this turn's words only: the answers before it
// were delivered by their own turns.
// Run: scripts/t.sh tests/soul/recover-settled.test.ts

import { beforeEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, type Entry } from "@earendil-works/pi-agent-core";
import {
  Type,
  createAssistantMessageEventStream,
  type Api,
  type Context,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { holdHarness, type HeldHarness } from "../../src/legion/execute/held";
import {
  DELIVERY_ENTRY,
  PROMPT_ENTRY,
  runHarnessTurn,
  type AgentTool,
  type StreamFn,
} from "../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../src/platform/app/session-fs";
import { registerDelivery, type Delivery } from "../../src/soul";
import { recoverSoulSession, saidBefore, type SendResumedTurn } from "../../src/soul/recover";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { createBookThread, getThread, rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import { installAppData } from "../support/appdata-fake";
import { memoryAppData, type MemoryDisk } from "../support/memory-appdata";
import { messageEvents, turnEvents, type Turn } from "../support/scripted-turn";

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
const deliverTo = { place: "book", bookId: BOOK, threadId: THREAD, page: 1 };
const FIRST = "The new week is on the card in front of you.";

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
});

const echo: AgentTool = {
  name: "echo",
  label: () => "Running the fake tool",
  effect: "read" as const,
  description: "Echo the value back",
  parameters: Type.Object({ value: Type.String() }),
  execute: async (args) => `echo:${args.value}`,
};

const ZERO = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function user(content: string): Message {
  return { role: "user", content, timestamp: 0 };
}

function answer(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "faux",
    provider: "faux",
    model: "m",
    usage: ZERO,
    stopReason: "stop",
    timestamp: 0,
  } as Message;
}

function scripted(turns: Turn[]): StreamFn {
  let round = 0;
  return (_model, _context: Context) => {
    const stream = createAssistantMessageEventStream();
    const events = turnEvents(turns[round++] ?? { error: "no scripted turn" });
    void (async () => {
      for (const ev of events) {
        await Promise.resolve();
        stream.push(ev);
      }
      stream.end();
    })();
    return stream;
  };
}

// A request whose answer has begun (the provider's `start`) and goes no further.
const silent: StreamFn = () => {
  const stream = createAssistantMessageEventStream();
  const [start] = messageEvents({ ...answer(""), content: [] } as never);
  void Promise.resolve().then(() => stream.push(start!));
  return stream;
};

async function ask(
  held: HeldHarness,
  stream: StreamFn,
  messages: Message[],
  conversation: string | undefined,
  tools: AgentTool[] = [echo],
): Promise<string | undefined> {
  let done: string | undefined;
  await runHarnessTurn({
    stream,
    model: MODEL,
    messages,
    tools,
    maxRounds: 8,
    held,
    deliverTo,
    ...(conversation === undefined ? {} : { conversation }),
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onDone: (text) => {
      done = text;
    },
    onError: () => {},
  });
  return done;
}

// The conversation so far, as the second turn is prompted with it.
const SECOND = [user("plan the week"), answer(FIRST), user("now the shopping list")];

// The conversation's first turn answers and is delivered; its second dies
// while `second` is still running.
async function killedDuring(
  disk: MemoryDisk,
  conversation: string | undefined,
  second: (held: HeldHarness) => Promise<unknown>,
): Promise<void> {
  const held = holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(disk) });
  expect(await ask(held, scripted([{ text: FIRST }]), [user("plan the week")], conversation)).toBe(FIRST);
  void second(held);
  await Bun.sleep(40);
  await held.close(ctx);
}

const resumeSend =
  (turns: Turn[]): SendResumedTurn =>
  async (resumed) => {
    let said = "";
    await runHarnessTurn({
      stream: scripted(turns),
      model: MODEL,
      systemPrompt: resumed.systemPrompt,
      messages: [],
      tools: resumed.tools,
      maxRounds: 8,
      held: resumed.harness,
      resume: resumed.operationId,
      onDelta: () => {},
      onToolStart: () => {},
      onToolEnd: () => {},
      onDone: (text, _a, turnText) => {
        said = turnText ?? text;
      },
      onError: (message) => {
        throw new Error(message);
      },
    });
    return said;
  };

// The next process: its harness opens, and the previous session is finished.
async function recover(disk: MemoryDisk, turns: Turn[] = []): Promise<void> {
  const off = registerDelivery("book", async (input) => {
    if (input.origin.place !== "book") return null;
    return {
      key: input.origin.bookId,
      threadId: input.origin.threadId,
      turn: { systemPrompt: "the book is on the desk", tools: [echo], messages: [], refusal: "" },
      watching: () => true,
    } satisfies Delivery;
  });
  try {
    let recovery: Promise<void> = Promise.resolve();
    const again = holdHarness({
      lane: SOUL,
      fileSystem: createSessionFileSystem(disk),
      recover: (previous, context) => {
        recovery = recoverSoulSession(
          previous,
          { lane: SOUL.name, settings: async () => settings, send: resumeSend(turns), now: () => NOW },
          context,
        );
        return recovery;
      },
    });
    await again.open?.(
      {
        model: MODEL,
        streamFn: scripted([]),
        tools: [],
        systemPrompt: "",
        toProviderMessages: (messages) => messages as Message[],
      },
      ctx,
    );
    await recovery;
    await again.close(ctx);
  } finally {
    off();
  }
}

function landed(): string[] {
  return getThread(BOOK, THREAD)?.messages.map((m) => m.text) ?? [];
}

for (const [name, conversation] of [
  ["the soul's own lane", undefined],
  ["a conversation's lane", THREAD],
] as const) {
  test(`a turn killed before it said anything lands nothing, not the answer before it (${name})`, async () => {
    const disk = memoryAppData();
    createBookThread(BOOK, THREAD);
    await killedDuring(disk, conversation, (held) => ask(held, silent, SECOND, conversation));
    await recover(disk);
    expect(landed()).toEqual([]);
  });

  test(`a turn killed in a tool lands its own words, not the answer before it (${name})`, async () => {
    const disk = memoryAppData();
    createBookThread(BOOK, THREAD);
    const hang: AgentTool = { ...echo, execute: () => new Promise<string>(() => {}) };
    const before = { text: "Let me look in the fridge.", calls: [{ name: "echo", args: { value: "x" }, id: "c1" }] };
    await killedDuring(disk, conversation, (held) =>
      ask(held, scripted([before]), SECOND, conversation, [hang]),
    );
    await recover(disk, [{ text: "Eggs, spinach and oats." }]);
    expect(landed()).toEqual(["Let me look in the fridge.\n\nEggs, spinach and oats."]);
  });
}

// --- the reading on its own ---------------------------------------------------

const entry = (id: string, message: Message) => ({ id, parentId: null, timestamp: NOW, type: "message", message });
const custom = (id: string, customType: string, data: unknown) => ({
  id,
  parentId: null,
  timestamp: NOW,
  type: "custom",
  customType,
  data,
});
const toolResult: Message = {
  role: "toolResult",
  toolCallId: "c1",
  toolName: "echo",
  content: [],
  isError: false,
  timestamp: 0,
} as Message;

test("a steered turn keeps what it said before the steer: the prompt is skipped by its size", () => {
  const transcript = [
    custom("s", DELIVERY_ENTRY, deliverTo),
    custom("p", PROMPT_ENTRY, { messages: 3 }),
    entry("1", user("plan the week")),
    entry("2", answer(FIRST)),
    entry("3", user("now the shopping list")),
    entry("4", answer("Let me look in the fridge.")),
    entry("5", toolResult),
    entry("6", user("also keep breakfasts under 400 kcal")),
    entry("7", answer("Oats for breakfast, then.")),
  ] as unknown as Entry[];
  expect(saidBefore(transcript)).toEqual(["Let me look in the fridge.", "Oats for breakfast, then."]);
});

test("a branch with no prompt size is read from its last user message on", () => {
  const transcript = [
    custom("s", DELIVERY_ENTRY, deliverTo),
    entry("1", user("plan the week")),
    entry("2", answer(FIRST)),
    entry("3", user("now the shopping list")),
    entry("4", answer("Let me look in the fridge.")),
  ] as unknown as Entry[];
  expect(saidBefore(transcript)).toEqual(["Let me look in the fridge."]);
});
