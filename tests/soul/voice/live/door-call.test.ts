// A voice call held at the door (src/soul/voice/live/door-call.ts, docs/68).
// Run: scripts/t.sh tests/soul/voice/live/door-call.test.ts

import { expect, test } from "bun:test";

import { callTranscriptWriter } from "../../../../src/soul/voice/live/call-transcript";
import {
  doorBriefKickoff,
  doorCallPlace,
  doorCallSpec,
  doorCallThreads,
  holdingMaterial,
} from "../../../../src/soul/voice/live/door-call";
import { liveDoorMaterial, type DoorCallMaterial } from "../../../../src/soul/voice/live/door-material";
import type { VoiceCall } from "../../../../src/soul/voice/voice-call";

test("the front is told the call is at the door, and that a book is open where one is", () => {
  const plain = doorCallPlace({});
  expect(plain).toContain("At the door");
  expect(plain).not.toContain("book open");
  expect(doorCallPlace({ inReader: false })).toBe(plain);
  expect(doorCallPlace({ inReader: true })).toBe(`${plain}\nThey have a book open in the reader.`);
});

test("a door call writes to the day's door conversation and nowhere else", () => {
  expect(doorCallThreads("2026-10-20", "d1")).toEqual([{ key: "door-2026-10-20", threadId: "d1" }]);
});

test("the spec delivers to the door on the start day and opens that day's thread", async () => {
  const opened: string[] = [];
  const spec = doorCallSpec({ date: "2026-10-20", inReader: true }, async (date) => {
    opened.push(date);
    return { id: "d1" };
  });
  expect(spec.deliverTo).toEqual({ place: "door", date: "2026-10-20" });
  expect(spec.place).toBe(doorCallPlace({ inReader: true }));
  expect(spec.contextualStrings).toEqual([]);
  // Nothing is distilled on hang-up at the door.
  expect(spec.afterStop).toBeUndefined();
  // The thread is opened only when the builder asks, once there is a bridge.
  expect(opened).toEqual([]);
  const threads = await spec.threads();
  expect(opened).toEqual(["2026-10-20"]);

  const ops: string[] = [];
  const write = callTranscriptWriter(threads, {
    append: (key, threadId, m) => ops.push(`append ${key}/${threadId} ${m.role} ${m.text}`),
    patch: (key, threadId, _ts, p) => ops.push(`patch ${key}/${threadId} ${p.text}`),
    now: () => 1,
  });
  write({ key: "1:user", role: "user", text: "hello" });
  write({ key: "1:user", role: "user", text: "hello there" });
  expect(ops).toEqual(["append door-2026-10-20/d1 user hello", "patch door-2026-10-20/d1 hello there"]);
});

function material(lines: () => string): DoorCallMaterial {
  return { opened: () => lines() !== "", place: async () => lines(), desk: async () => null };
}

test("with a provider, the front's place is read again at every turn", async () => {
  const open = async () => ({ id: "d1" });
  let brief = 'They have the brief "No. 7" open in the reader, on page 2 of 9.';
  const spec = doorCallSpec({ date: "2026-10-20", inReader: true, material: material(() => brief) }, open);
  expect(typeof spec.place).toBe("function");
  const place = spec.place as () => Promise<string>;
  expect(await place()).toBe(`At the door: today's conversation with the reader.\n${brief}`);
  brief = 'They have the brief "No. 7" open in the reader, on page 5 of 9.';
  expect(await place()).toContain("page 5 of 9");
  // The brief put away: the plain door call's place, word for word.
  brief = "";
  expect(await place()).toBe(doorCallPlace({ inReader: true }));
});

test("a call started with a brief open greets and asks instead of summing it up; without one the kickoff is the usual", () => {
  const open = async () => ({ id: "d1" });
  const withBrief = doorCallSpec({ date: "2026-10-20", material: material(() => "brief") }, open);
  expect(withBrief.kickoff).toBe(doorBriefKickoff);
  expect(doorBriefKickoff("zh-CN")).toContain("Do not sum the brief up");
  expect(doorBriefKickoff("zh-CN")).toContain("Say it in 简体中文.");
  expect("kickoff" in doorCallSpec({ date: "2026-10-20", material: material(() => "") }, open)).toBe(false);
  expect("kickoff" in doorCallSpec({ date: "2026-10-20" }, open)).toBe(false);
});

function fakeCall(fail = false): VoiceCall & { stops: number } {
  const call = {
    stops: 0,
    start: async () => {
      if (fail) throw new Error("no microphone");
    },
    stop: async () => {
      call.stops++;
    },
  };
  return call as unknown as VoiceCall & { stops: number };
}

test("the provider is live from a call's start to its stop, and a second call does not inherit it", async () => {
  const first = material(() => "brief");
  const a = holdingMaterial(fakeCall(), first);
  expect(liveDoorMaterial()).toBeNull();
  await a.start();
  expect(liveDoorMaterial()).toBe(first);
  await a.stop();
  expect(liveDoorMaterial()).toBeNull();

  // A call left running is replaced by the next one, and its late stop leaves the new one alone.
  const b = holdingMaterial(fakeCall(), first);
  await b.start();
  const c = holdingMaterial(fakeCall(), null);
  await c.start();
  expect(liveDoorMaterial()).toBeNull();
  const second = material(() => "other");
  const d = holdingMaterial(fakeCall(), second);
  await d.start();
  await b.stop();
  expect(liveDoorMaterial()).toBe(second);
  await d.stop();
  await c.stop();
  expect(liveDoorMaterial()).toBeNull();
});

test("a call that fails to start gives the provider up", async () => {
  const call = holdingMaterial(fakeCall(true), material(() => "brief"));
  await expect(call.start()).rejects.toThrow("no microphone");
  expect(liveDoorMaterial()).toBeNull();
});

test("the screen's hooks ride along only when given", () => {
  const open = async () => ({ id: "d1" });
  const bare = doorCallSpec({ date: "2026-10-20" }, open);
  expect("onShow" in bare).toBe(false);
  expect("onRunning" in bare).toBe(false);
  const onRunning = () => {};
  expect(doorCallSpec({ date: "2026-10-20", onRunning }, open).onRunning).toBe(onRunning);
});
