// The reader's lines into a turn that is already running (src/reading/steering).
// Pure: the port is a fake, and what it answers is the whole of what this
// object reacts to. Run: bun test.

import { expect, test } from "bun:test";
import { createSteering, type PendingSteer } from "../../../src/reading/turn/steering";
import type { SteerPort } from "../../../src/legion/execute/contract";

// A port that hands back an id per call, and records what it was asked to say.
function fakePort(): { port: SteerPort; said: string[]; ids: string[] } {
  const said: string[] = [];
  const ids: string[] = [];
  const port: SteerPort = async (message) => {
    const text = typeof message === "string" ? message : message.text;
    said.push(text);
    const id = `e${said.length}`;
    ids.push(id);
    return { ok: true, id };
  };
  return { port, said, ids };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a line said before the turn has a run to queue into goes when it does", async () => {
  const injected: PendingSteer[][] = [];
  const steering = createSteering((lines) => injected.push(lines));
  const { port, said } = fakePort();

  steering.say(1, "wait");
  expect(said).toEqual([]);
  expect(steering.outstanding()).toEqual([{ ts: 1, text: "wait" }]);

  steering.open(port);
  await settle();
  expect(said).toEqual(["wait"]);
  // Queued is not injected: the model has not been handed it yet.
  expect(steering.outstanding()).toEqual([{ ts: 1, text: "wait" }]);
  expect(injected).toEqual([]);
});

test("the id the turn reports back is the row the mark comes off", async () => {
  const injected: PendingSteer[][] = [];
  const steering = createSteering((lines) => injected.push(lines));
  const { port, ids } = fakePort();
  steering.open(port);

  steering.say(10, "one");
  steering.say(20, "two");
  await settle();

  steering.injected([ids[1]]);
  expect(injected).toEqual([[{ ts: 20, text: "two" }]]);
  expect(steering.outstanding()).toEqual([{ ts: 10, text: "one" }]);

  steering.injected([ids[0]]);
  expect(injected[1]).toEqual([{ ts: 10, text: "one" }]);
  expect(steering.outstanding()).toEqual([]);
});

test("the same id reported twice delivers once", async () => {
  const injected: PendingSteer[][] = [];
  const steering = createSteering((lines) => injected.push(lines));
  const { port, ids } = fakePort();
  steering.open(port);
  steering.say(1, "one");
  await settle();

  steering.injected([ids[0]]);
  steering.injected([ids[0]]);
  expect(injected).toHaveLength(1);
});

test("lines reach the model in the order they were typed", async () => {
  const steering = createSteering(() => {});
  const said: string[] = [];
  // A port whose first enqueue takes longer than the second would: chained, the
  // order still holds.
  let first = true;
  steering.open(async (message) => {
    const text = typeof message === "string" ? message : message.text;
    if (first) {
      first = false;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    said.push(text);
    return { ok: true, id: text };
  });
  steering.say(1, "one");
  steering.say(2, "two");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(said).toEqual(["one", "two"]);
});

test("a line the turn refused stays outstanding", async () => {
  const steering = createSteering(() => {});
  steering.open(async () => ({ ok: false, reason: "ended", message: "the turn had already ended" }));
  steering.say(1, "too late");
  await settle();
  expect(steering.outstanding()).toEqual([{ ts: 1, text: "too late" }]);
});

test("an injection reported before its enqueue resolved still lands", async () => {
  const injected: PendingSteer[][] = [];
  const steering = createSteering((lines) => injected.push(lines));
  let release: (() => void) | null = null;
  steering.open(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ok: true, id: "e1" };
  });
  steering.say(1, "one");
  await settle();

  steering.injected(["e1"]);
  expect(injected).toEqual([]);
  release!();
  await settle();
  expect(injected).toEqual([[{ ts: 1, text: "one" }]]);
  expect(steering.outstanding()).toEqual([]);
});
