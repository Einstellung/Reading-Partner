// A turn typed at the door (src/soul/door-chat.ts). Run: bun test.

import { expect, test } from "bun:test";
import { sendAtTheDoor, type DoorSendDeps, type DoorSendInput } from "../../src/soul";
import type { AssembledTurn } from "../../src/soul/turn";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

const tool = { name: "door_tool", description: "", parameters: {}, execute: async () => "" } as never;

function turn(over: Partial<AssembledTurn> = {}): AssembledTurn {
  return {
    systemPrompt: "prompt",
    tools: [],
    messages: [{ role: "user", text: "hello" }],
    notice: "",
    refusal: "",
    report: {},
    origin: { place: "door", date: "2026-10-09" },
    ...over,
  };
}

function input(): DoorSendInput {
  return {
    threadId: "t1",
    date: "2026-10-09",
    history: [{ role: "user", text: "hello" }],
    signal: new AbortController().signal,
    handlers: { onDelta: () => {} } as never,
    tools: [tool],
  };
}

function deps(over: Partial<DoorSendDeps> & { opened?: AssembledTurn | null } = {}) {
  const calls = { open: [] as unknown[], run: [] as Record<string, unknown>[] };
  const d: DoorSendDeps = {
    loadSettings: async () => settings,
    openTurn: async (i) => {
      calls.open.push(i);
      return over.opened === undefined ? turn() : over.opened;
    },
    runTurn: (async (o: Record<string, unknown>) => {
      calls.run.push(o);
    }) as never,
    ...over,
  };
  return { d, calls };
}

test("a line typed at the door is assembled over the day's thread and sent", async () => {
  const { d, calls } = deps();
  expect(await sendAtTheDoor(input(), d)).toEqual({ kind: "sent" });
  const opened = calls.open[0] as Record<string, unknown>;
  expect(opened.threadId).toBe("t1");
  expect(opened.date).toBe("2026-10-09");
  expect(opened.messages).toEqual([{ role: "user", text: "hello" }]);
  // The door's own tools ride beside the soul's.
  expect((opened.tools as { name: string }[]).map((t) => t.name)).toEqual(["door_tool"]);
  const sent = calls.run[0]!;
  expect(sent.systemPrompt).toBe("prompt");
  expect(sent.telemetry).toEqual({ surface: "door", thread: "t1" });
  // A run delegated here is answered at the door.
  expect(sent.deliverTo).toEqual({ place: "door", date: "2026-10-09" });
  expect(typeof sent.onDelta).toBe("function");
});

test("no model set up: nothing is assembled", async () => {
  const { d, calls } = deps({ loadSettings: async () => ({ ...settings, defaultModelId: "" }) });
  expect(await sendAtTheDoor(input(), d)).toEqual({ kind: "no-provider" });
  expect(calls.open).toEqual([]);
});

test("a turn too big to answer is refused, and nothing is sent", async () => {
  const { d, calls } = deps({ opened: turn({ refusal: "too long" }) });
  expect(await sendAtTheDoor(input(), d)).toEqual({ kind: "refused", text: "too long" });
  expect(calls.run).toEqual([]);
});

test("stopped while the soul was read: nothing is sent", async () => {
  const { d, calls } = deps({ opened: null });
  expect(await sendAtTheDoor(input(), d)).toEqual({ kind: "aborted" });
  expect(calls.run).toEqual([]);
});
