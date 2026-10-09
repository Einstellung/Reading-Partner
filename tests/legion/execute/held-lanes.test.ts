// A lane per conversation on the held harness (src/legion/execute/held.ts):
// turns of two conversations run at the same time, each on its own lane and
// its own pi harness over the one session; turns of one conversation still run
// one after the other, and the second is told it is queued. The session they
// share is written by both at once and still opens, whole, after a restart.
// Run: scripts/t.sh tests/legion/execute/held-lanes.test.ts

import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import {
  Type,
  createAssistantMessageEventStream,
  withoutInitialSystemMessage,
  type Api,
  type Context,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { holdHarness, type HeldHarness } from "../../../src/legion/execute/held";
import {
  runHarnessTurn,
  type AgentTool,
  type HarnessTurnParams,
  type StreamFn,
} from "../../../src/legion/execute/turn";
import type { TurnWait } from "../../../src/legion/execute/contract";
import type { TurnLogLine } from "../../../src/legion/execute/turn-log";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import { memoryAppData, type MemoryDisk } from "../../support/memory-appdata";
import { turnEvents, type Turn } from "../../support/scripted-turn";

const ctx = BACKGROUND_CONTEXT;
const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;
const SOUL = { name: "soul", sessions: "soul" };

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

function user(content: string): Message {
  return { role: "user", content, timestamp: 0 };
}

function hold(disk: MemoryDisk): HeldHarness {
  return holdHarness({ lane: SOUL, fileSystem: createSessionFileSystem(disk) });
}

// A tool whose call waits until `release` is called, and says when it started.
function gatedTool(name: string): { tool: AgentTool; started: Promise<void>; release: () => void } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    started,
    release,
    tool: {
      name: "echo",
      label: () => `Running ${name}`,
      effect: "read" as const,
      description: "Echo the value back",
      parameters: Type.Object({ value: Type.String() }),
      execute: async (args) => {
        markStarted();
        await released;
        return `echo:${args.value}`;
      },
    },
  };
}

interface Outcome {
  done?: string;
  error?: string;
  waits: TurnWait[];
  rounds: Message[][];
}

function turn(
  held: HeldHarness,
  conversation: string | undefined,
  prompt: string,
  turns: Turn[],
  extra: Partial<HarnessTurnParams> = {},
): Promise<Outcome> {
  const script = scriptStream(turns);
  const out: Outcome = { waits: [], rounds: script.rounds };
  return runHarnessTurn({
    stream: script.fn,
    model: MODEL,
    messages: [user(prompt)],
    tools: [],
    maxRounds: 8,
    held,
    ...(conversation !== undefined ? { conversation } : {}),
    onDelta: () => {},
    onWait: (w) => out.waits.push(w),
    onToolStart: () => {},
    onToolEnd: () => {},
    onDone: (text) => {
      out.done = text;
    },
    onError: (message) => {
      out.error = message;
    },
    ...extra,
  }).then(() => out);
}

// Fails the test rather than hanging it when `p` never settles.
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms)),
  ]);
}

function sessionFiles(disk: MemoryDisk): string[] {
  return [...disk.files.keys()].filter((p) => p.includes("--session-soul--/")).sort();
}

test("turns of two conversations run at the same time", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  const a = gatedTool("a");
  const b = gatedTool("b");
  const ra = turn(held, "thread-a", "qa", [{ calls: [{ name: "echo", args: { value: "a" }, id: "ca" }] }, { text: "aa" }], {
    tools: [a.tool],
  });
  const rb = turn(held, "thread-b", "qb", [{ calls: [{ name: "echo", args: { value: "b" }, id: "cb" }] }, { text: "ab" }], {
    tools: [b.tool],
  });
  // Both tools are in flight at once: on one lane the second could not start
  // before the first was released.
  await within(Promise.all([a.started, b.started]), 2_000, "both tools running");
  b.release();
  const outB = await within(rb, 2_000, "turn b");
  a.release();
  const outA = await within(ra, 2_000, "turn a");

  expect([outA.done, outB.done]).toEqual(["aa", "ab"]);
  expect(outA.error).toBeUndefined();
  expect(outB.error).toBeUndefined();
  // Neither waited on the other, and each provider round saw its own turn.
  expect(outA.waits.some((w) => w.kind === "queued")).toBe(false);
  expect(outB.waits.some((w) => w.kind === "queued")).toBe(false);
  expect((outA.rounds[0]![0] as { content: string }).content).toBe("qa");
  expect((outB.rounds[0]![0] as { content: string }).content).toBe("qb");
  await held.close(ctx);

  // The session both wrote at once is one file with both lanes in it.
  const files = sessionFiles(disk);
  expect(files.length).toBe(1);
  const text = new TextDecoder().decode(disk.files.get(files[0]!)!);
  expect(text).toContain("soul/thread-a");
  expect(text).toContain("soul/thread-b");

  // A restart opens it whole: nothing is set aside, nothing left open, and the
  // next turn of either conversation runs.
  let leftOpen = 0;
  const again = holdHarness({
    lane: SOUL,
    fileSystem: createSessionFileSystem(disk),
    recover: (previous) => {
      leftOpen = previous.open.length;
    },
  });
  const next = await turn(again, "thread-a", "qa2", [{ text: "aa2" }]);
  expect(next.done).toBe("aa2");
  expect(leftOpen).toBe(0);
  expect([...disk.files.keys()].some((p) => p.includes(".corrupt-"))).toBe(false);
  await again.close(ctx);
});

test("turns of one conversation run one after the other, and the second says it is queued", async () => {
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
  const ra = turn(held, "thread-a", "q1", [{ calls: [{ name: "echo", args: { value: "1" }, id: "c1" }] }, { text: "a1" }], {
    tools: [slow],
  });
  const rb = turn(held, "thread-a", "q2", [{ calls: [{ name: "echo", args: { value: "2" }, id: "c2" }] }, { text: "a2" }], {
    tools: [slow],
  });
  const [outA, outB] = await within(Promise.all([ra, rb]), 3_000, "both turns");
  expect([outA.done, outB.done]).toEqual(["a1", "a2"]);
  expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  expect(outA.waits[0]).toEqual({ kind: "first-byte", round: 1 });
  expect(outB.waits[0]).toEqual({ kind: "queued" });
  expect(outB.waits.filter((w) => w.kind === "first-byte")).toEqual([
    { kind: "first-byte", round: 1 },
    { kind: "first-byte", round: 2 },
  ]);
  // The second turn starts from the session root: its first round is its own.
  expect(outB.rounds[0]!.map((m) => m.role)).toEqual(["user"]);
  await held.close(ctx);
});

test("a conversation whose strand was let go of runs again on a fresh one", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  const first = await turn(held, "thread-a", "q1", [{ text: "a1" }]);
  const other = await turn(held, "thread-b", "q2", [{ text: "b1" }]);
  const again = await turn(held, "thread-a", "q3", [{ text: "a2" }]);
  expect([first.done, other.done, again.done]).toEqual(["a1", "b1", "a2"]);
  expect(again.rounds[0]!.map((m) => (m as { content: string }).content)).toEqual(["q3"]);
  await held.close(ctx);
});

test("the log records each moment of a turn, and a queued one says so", async () => {
  const disk = memoryAppData();
  const held = hold(disk);
  const lines: TurnLogLine[] = [];
  const log = (line: TurnLogLine): void => {
    lines.push(line);
  };
  const gate = gatedTool("a");
  const ra = turn(held, "thread-a", "q1", [{ calls: [{ name: "echo", args: { value: "1" }, id: "c1" }] }, { text: "a1" }], {
    tools: [gate.tool],
    log,
  });
  await within(gate.started, 2_000, "first tool");
  const rb = turn(held, "thread-a", "q2", [{ text: "a2" }], { log });
  await Bun.sleep(10);
  gate.release();
  await within(Promise.all([ra, rb]), 2_000, "both turns");
  await held.close(ctx);

  const turns = [...new Set(lines.map((l) => l.turn))];
  expect(turns.length).toBe(2);
  const of = (id: string) => lines.filter((l) => l.turn === id).map((l) => l.event);
  expect(of(turns[0]!)).toEqual(["start", "lane", "first-byte", "round", "first-byte", "round", "end"]);
  expect(of(turns[1]!)).toEqual(["start", "queued", "lane", "first-byte", "round", "end"]);
  const start = lines.find((l) => l.event === "start")!;
  expect(start).toMatchObject({ conversation: "thread-a", provider: "faux", model: "m", held: true });
  const ends = lines.filter((l) => l.event === "end");
  expect(ends.map((l) => (l as { reason: string }).reason)).toEqual(["done", "done"]);
  const rounds = lines.filter((l) => l.event === "round" && l.turn === turns[0]);
  expect(rounds.map((l) => (l as { stop: string }).stop)).toEqual(["toolUse", "stop"]);
});
