// A turn typed at the door, assembled for the durable runtime
// (src/soul/door-chat.ts). Run: scripts/t.sh tests/soul/door-chat.test.ts

import { expect, test } from "bun:test";
import { doorAssemblies, prepareDoorTurn, type DoorSendDeps, type DoorSendInput } from "../../src/soul";
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
    tools: [tool],
    messages: [
      { role: "ai", text: "morning" },
      { role: "user", text: "hello" },
    ],
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
    history: [
      { role: "ai", text: "morning" },
      { role: "user", text: "hello" },
    ],
    signal: new AbortController().signal,
    tools: [tool],
  };
}

function deps(over: Partial<DoorSendDeps> & { opened?: AssembledTurn | null } = {}) {
  const calls = { open: [] as unknown[] };
  const d: DoorSendDeps = {
    loadSettings: async () => settings,
    openTurn: async (i) => {
      calls.open.push(i);
      return over.opened === undefined ? turn() : over.opened;
    },
    ...over,
  };
  return { d, calls };
}

test("a line typed at the door is assembled over the day's thread, its history kept for the place", async () => {
  const { d, calls } = deps();
  const prepared = await prepareDoorTurn(input(), d);
  const opened = calls.open[0] as Record<string, unknown>;
  expect(opened.threadId).toBe("t1");
  expect(opened.date).toBe("2026-10-09");
  // The door's own tools ride beside the soul's.
  expect((opened.tools as { name: string }[]).map((t) => t.name)).toEqual(["door_tool"]);
  if (prepared.kind !== "turn") throw new Error(`expected a turn, got ${prepared.kind}`);
  expect(prepared.origin).toEqual({ place: "door", date: "2026-10-09", threadId: "t1" });
  expect(prepared.systemPrompt).toBe("prompt");
  expect(prepared.line).toBe("hello");
  expect(doorAssemblies.get(prepared.key)?.history).toEqual([{ role: "ai", text: "morning" }]);
  doorAssemblies.delete(prepared.key);
});

test("no model set up: nothing is assembled", async () => {
  const { d, calls } = deps({ loadSettings: async () => ({ ...settings, defaultModelId: "" }) });
  expect(await prepareDoorTurn(input(), d)).toEqual({ kind: "no-provider" });
  expect(calls.open).toEqual([]);
});

test("a turn too big to answer is refused", async () => {
  const { d } = deps({ opened: turn({ refusal: "too long" }) });
  expect(await prepareDoorTurn(input(), d)).toEqual({ kind: "refused", text: "too long" });
});

test("stopped while the soul was read: nothing is assembled", async () => {
  const { d } = deps({ opened: null });
  expect(await prepareDoorTurn(input(), d)).toEqual({ kind: "aborted" });
});
