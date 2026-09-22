// The held harness (src/legion/execute/held.ts) under the turn (turn.ts):
// several turns on one lane of one session, driven by a scripted stream over
// an in-memory AppData. What is pinned down is that the session records every
// turn and feeds none of them forward: each turn's provider sees that turn's
// prompt and its own tool rounds, and nothing from the turns before — in one
// process, and again after a restart, which settles the previous session and
// starts a fresh one in the same group.
// Run: scripts/t.sh tests/legion/execute/held.test.ts

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, type OpenOperation } from "@earendil-works/pi-agent-core";
import {
  Type,
  createAssistantMessageEventStream,
  withoutInitialSystemMessage,
  type Api,
  type Context,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { holdHarness, type HeldHarness, type HeldTurn } from "../../../src/legion/execute/held";
import {
  runHarnessTurn,
  type AgentTool,
  type HarnessTurnParams,
  type StreamFn,
} from "../../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import { memoryAppData, type MemoryDisk } from "../../support/memory-appdata";
import { turnEvents, type Turn } from "../../support/scripted-turn";

const ctx = BACKGROUND_CONTEXT;
const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;
const OTHER = { id: "m2", provider: "faux" } as unknown as Model<Api>;
const SOUL = { name: "soul", sessions: "soul" };

// One scripted stream per turn, recording the messages each round was sent.
// pi carries the system prompt as a leading system message; this file is about
// which turn's messages a round sees, so that message is dropped here.
function scriptStream(turns: Turn[]): { fn: StreamFn; rounds: Message[][] } {
  let round = 0;
  const rounds: Message[][] = [];
  const fn: StreamFn = (_model, context: Context) => {
    const i = round++;
    rounds.push(withoutInitialSystemMessage(context.messages));
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
  toolEnds: string[];
}

// One turn on `held`, answered by `turns`; what came back and what the
// provider was sent each round.
async function turn(
  held: HeldHarness,
  prompt: Message[],
  turns: Turn[],
  extra: Partial<HarnessTurnParams> = {},
): Promise<Outcome & { rounds: Message[][] }> {
  const script = scriptStream(turns);
  const out: Outcome = { toolEnds: [] };
  await runHarnessTurn({
    stream: script.fn,
    model: MODEL,
    messages: prompt,
    tools: [echo],
    maxRounds: 8,
    held,
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: (info) => out.toolEnds.push(info.name),
    onDone: (text) => {
      out.done = text;
    },
    onError: (message) => {
      out.error = message;
    },
    ...extra,
  });
  return { ...out, rounds: script.rounds };
}

function roles(messages: Message[]): string[] {
  return messages.map((m) =>
    m.role === "user"
      ? `user:${m.content as string}`
      : m.role === "assistant"
        ? "assistant"
        : m.role,
  );
}

// Oldest first: a session file is named after its creation time.
function sessionFiles(disk: MemoryDisk, group: string): string[] {
  return [...disk.files.keys()]
    .filter((p) => p.includes(`--session-${group}--/`) && p.endsWith(".jsonl"))
    .sort();
}

function written(disk: MemoryDisk, path: string): string {
  return new TextDecoder().decode(disk.files.get(path)!);
}

function hold(disk: MemoryDisk): HeldHarness {
  return holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(disk) });
}

// What a session opened without a turn is created with (src/soul/harness.ts).
// Nothing streams through it: a round that reached this one would be a round on
// a turn nobody assembled.
function seed(): HeldTurn {
  return {
    model: MODEL,
    streamFn: () => {
      throw new Error("the seed turn was streamed");
    },
    tools: [],
    systemPrompt: "",
    toProviderMessages: (messages) => messages as Message[],
  };
}

test("three turns on one harness: each provider round sees its own turn only", async () => {
  const disk = memoryAppData();
  const held = hold(disk);

  const first = await turn(held, [user("h1"), user("q1")], [
    { text: "looking", calls: [{ name: "echo", args: { value: "a" }, id: "c1" }] },
    { text: "a1" },
  ]);
  const second = await turn(held, [user("h2"), user("q2")], [{ text: "a2" }]);
  const third = await turn(held, [user("q3")], [
    { calls: [{ name: "echo", args: { value: "b" }, id: "c2" }] },
    { text: "a3" },
  ]);

  expect([first.done, second.done, third.done]).toEqual(["a1", "a2", "a3"]);
  expect(first.toolEnds).toEqual(["echo"]);

  // Turn one: its prompt, then its prompt plus its own tool round.
  expect(roles(first.rounds[0]!)).toEqual(["user:h1", "user:q1"]);
  expect(roles(first.rounds[1]!)).toEqual(["user:h1", "user:q1", "assistant", "toolResult"]);
  // Turn two: only its prompt. Nothing of turn one.
  expect(roles(second.rounds[0]!)).toEqual(["user:h2", "user:q2"]);
  // Turn three: its prompt, then its own tool round. Nothing of turns one or two.
  expect(roles(third.rounds[0]!)).toEqual(["user:q3"]);
  expect(roles(third.rounds[1]!)).toEqual(["user:q3", "assistant", "toolResult"]);

  // One session file in the group, and every turn is in it.
  const files = sessionFiles(disk, "soul");
  expect(files).toHaveLength(1);
  const body = written(disk, files[0]!);
  for (const needle of ["q1", "q2", "q3", "a1", "a2", "a3", "echo:a", "echo:b"]) {
    expect(body).toContain(needle);
  }
  await held.close(ctx);
});

test("a restart starts a fresh session, and the next turn still sees itself only", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  await turn(held, [user("q1")], [{ text: "a1" }]);
  await turn(held, [user("q2")], [{ text: "a2" }]);
  await turn(held, [user("q3")], [{ text: "a3" }]);
  await held.close(ctx);

  // --- second process, same files ---
  const again = hold(disk);
  const fourth = await turn(again, [user("h4"), user("q4")], [
    { calls: [{ name: "echo", args: { value: "d" }, id: "c4" }] },
    { text: "a4" },
  ]);
  expect(fourth.done).toBe("a4");
  expect(roles(fourth.rounds[0]!)).toEqual(["user:h4", "user:q4"]);
  expect(roles(fourth.rounds[1]!)).toEqual(["user:h4", "user:q4", "assistant", "toolResult"]);

  // The process before it wrote its own file and this one writes another; the
  // three turns of the first process stay where they were.
  const files = sessionFiles(disk, "soul");
  expect(files).toHaveLength(2);
  expect(written(disk, files[0]!)).toContain("q1");
  expect(written(disk, files[1]!)).toContain("q4");
  expect(written(disk, files[1]!)).not.toContain("q1");
  await again.close(ctx);
});

test("a tool left running by a dead process is settled as interrupted, not rerun, and the model is not called for it", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  const entered: string[] = [];
  const hang: AgentTool = {
    name: "echo",
    label: () => "Running the fake tool",
    effect: "read" as const,
    description: "never returns",
    parameters: Type.Object({ value: Type.String() }),
    execute: async (args) => {
      entered.push(`first:${args.value}`);
      await new Promise<void>(() => {});
      return "unreachable";
    },
  };
  void turn(
    held,
    [user("hang")],
    [{ calls: [{ name: "echo", args: { value: "x" }, id: "c1" }] }, { text: "never sent" }],
    { tools: [hang] },
  );
  await Bun.sleep(40);
  expect(entered).toEqual(["first:x"]);
  // The process dies: the session handle goes away without the turn ending.
  await held.close(ctx);

  // --- second process ---
  const again = hold(disk);
  const next = await turn(again, [user("q2")], [{ text: "a2" }], { model: OTHER });
  expect(next.done).toBe("a2");
  // The one stream call of this process was turn two's; the interrupted run
  // got no continuation.
  expect(next.rounds).toHaveLength(1);
  expect(roles(next.rounds[0]!)).toEqual(["user:q2"]);
  expect(entered).toEqual(["first:x"]);

  // The interrupted run is settled on the file that holds it, and turn two is
  // in this process's own.
  const files = sessionFiles(disk, "soul");
  expect(files).toHaveLength(2);
  expect(written(disk, files[0]!)).toContain("Tool execution was interrupted");
  expect(written(disk, files[1]!)).toContain("q2");
  await again.close(ctx);
});

test("two turns asked at once run one after the other", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  const order: string[] = [];
  const slow: AgentTool = {
    name: "echo",
    label: () => "Running the fake tool",
    effect: "read" as const,
    description: "slow",
    parameters: Type.Object({ value: Type.String() }),
    execute: async (args) => {
      order.push(`start:${args.value}`);
      await Bun.sleep(20);
      order.push(`end:${args.value}`);
      return `echo:${args.value}`;
    },
  };
  const a = turn(
    held,
    [user("qa")],
    [{ calls: [{ name: "echo", args: { value: "a" }, id: "c1" }] }, { text: "aa" }],
    { tools: [slow] },
  );
  const b = turn(
    held,
    [user("qb")],
    [{ calls: [{ name: "echo", args: { value: "b" }, id: "c2" }] }, { text: "ab" }],
    { tools: [slow] },
  );
  const [ra, rb] = await Promise.all([a, b]);
  expect([ra.done, rb.done]).toEqual(["aa", "ab"]);
  expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  expect(roles(rb.rounds[0]!)).toEqual(["user:qb"]);
  await held.close(ctx);
});

test("a turn's hooks do not outlive it on the held harness", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  const first = await turn(held, [user("q1")], [
    { calls: [{ name: "echo", args: { value: "a" }, id: "c1" }] },
    { text: "a1" },
  ]);
  const second = await turn(held, [user("q2")], [
    { calls: [{ name: "echo", args: { value: "b" }, id: "c2" }] },
    { text: "a2" },
  ]);
  // Each turn heard its own tool end once, not the other turn's as well.
  expect(first.toolEnds).toEqual(["echo"]);
  expect(second.toolEnds).toEqual(["echo"]);
  await held.close(ctx);
});

// A process that is killed mid-answer leaves a run open, and the reader who
// lost that answer has no reason to ask a second question. So the session is
// opened at start rather than by the first turn: recovery has to run with
// nobody asking for anything (src/soul/harness.ts, docs/pitfall/394).
test("opening the session at start hands the previous process's open run to recover", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  const hang: AgentTool = {
    name: "echo",
    label: () => "Running the fake tool",
    effect: "read" as const,
    description: "never returns",
    parameters: Type.Object({ value: Type.String() }),
    execute: async () => {
      await new Promise<void>(() => {});
      return "unreachable";
    },
  };
  void turn(
    held,
    [user("hang")],
    [{ calls: [{ name: "echo", args: { value: "x" }, id: "c1" }] }, { text: "never sent" }],
    { tools: [hang] },
  );
  // Long enough for the round to be written and the tool to be entered.
  await Bun.sleep(50);

  // --- second process, same files, and nobody asks it anything ---
  const taken: OpenOperation[][] = [];
  const again = holdHarness({
    lane: SOUL,
    fileSystem: createSessionFileSystem(disk),
    recover: async (previous) => {
      taken.push(previous.open);
      await previous.settle(ctx);
      await previous.close(ctx);
    },
  });
  await again.open?.(seed(), ctx);
  // The recovery is started by the open and not awaited by it.
  await Bun.sleep(50);

  expect(taken).toHaveLength(1);
  expect(taken[0]!.map((o) => o.kind)).toEqual(["run"]);
  // The session was opened by `open` and not by a turn: a fresh file is there
  // beside the dead one, with nothing of anybody's in it.
  const files = sessionFiles(disk, "soul");
  expect(files).toHaveLength(2);
  expect(written(disk, files[1]!)).not.toContain("hang");
  await again.close(ctx);
});

test("the first turn opens the session when nothing opened it at start", async () => {
  const disk = memoryAppData();
  const opens: number[] = [];
  const held = holdHarness({
    lane: SOUL,
    fileSystem: createSessionFileSystem(disk),
    recover: (previous) => {
      opens.push(previous.open.length);
    },
  });
  // No `open` call: the turn pays for it, the way every turn did before.
  expect(await turn(held, [user("q1")], [{ text: "a1" }])).toMatchObject({ done: "a1" });
  expect(opens).toEqual([]); // nothing was there to recover
  await held.close(ctx);
});

test("opening twice opens one session", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  await held.open?.(seed(), ctx);
  await held.open?.(seed(), ctx);
  await turn(held, [user("q1")], [{ text: "a1" }]);
  expect(sessionFiles(disk, "soul")).toHaveLength(1);
  await held.close(ctx);
});
