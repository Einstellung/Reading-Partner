// A delegated run put into a turn that is already running (src/reading/
// delivered). Pure: the port is a fake, and what it answers is the whole of
// what this object reacts to. Run: bun test.

import { expect, test } from "bun:test";
import { createDelivered } from "../../src/reading/delivered";
import type { SteerMessage, SteerPort } from "../../src/legion/execute/contract";

// A port that hands back an id per call, and records what it was asked to say.
function fakePort(): { port: SteerPort; said: SteerMessage[]; ids: string[] } {
  const said: SteerMessage[] = [];
  const ids: string[] = [];
  const port: SteerPort = async (message) => {
    said.push(typeof message === "string" ? { text: message } : message);
    const id = `e${said.length}`;
    ids.push(id);
    return { ok: true, id };
  };
  return { port, said, ids };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("what goes into the queue is marked internal, so no row is ever drawn for it", async () => {
  const delivered = createDelivered(() => {});
  const { port, said } = fakePort();
  void delivered.say("r-1", "[bell] the literature is in");
  delivered.open(port);
  await settle();
  expect(said).toEqual([{ text: "[bell] the literature is in", internal: true }]);
});

test("a bell said before the turn has a run to queue into goes when it does", async () => {
  const delivered = createDelivered(() => {});
  const { port, said } = fakePort();
  void delivered.say("r-1", "back");
  expect(said).toEqual([]);
  delivered.open(port);
  await settle();
  expect(said.length).toBe(1);
});

test("the bell is answered only when the model has really been handed it", async () => {
  const landed: string[] = [];
  const delivered = createDelivered((runId) => landed.push(runId));
  const { port, ids } = fakePort();
  delivered.open(port);

  const outcome: (boolean | null)[] = [null];
  void delivered.say("r-1", "back").then((ok) => (outcome[0] = ok));
  await settle();
  // Queued is not landed: the round boundary has not drained it yet.
  expect(outcome[0]).toBeNull();
  expect(landed).toEqual([]);

  delivered.injected([ids[0]!]);
  await settle();
  expect(outcome[0]).toBe(true);
  expect(landed).toEqual(["r-1"]);
});

test("a turn that ends with the bell still queued answers nothing", async () => {
  const landed: string[] = [];
  const delivered = createDelivered((runId) => landed.push(runId));
  const { port } = fakePort();
  delivered.open(port);

  const outcome: (boolean | null)[] = [null];
  void delivered.say("r-1", "back").then((ok) => (outcome[0] = ok));
  await settle();
  delivered.close();
  await settle();
  expect(outcome[0]).toBe(false);
  expect(landed).toEqual([]);
});

test("a turn that never had a run to queue into answers nothing either", async () => {
  const delivered = createDelivered(() => {});
  const outcome: (boolean | null)[] = [null];
  void delivered.say("r-1", "back").then((ok) => (outcome[0] = ok));
  await settle();
  expect(outcome[0]).toBeNull();
  delivered.close();
  await settle();
  expect(outcome[0]).toBe(false);
});

test("a port that refuses leaves the bell unanswered", async () => {
  const delivered = createDelivered(() => {});
  delivered.open(async () => ({ ok: false, reason: "ended", message: "the turn had already ended" }));
  expect(await delivered.say("r-1", "back")).toBe(false);
});

test("a landing reported before its enqueue resolved is not lost", async () => {
  const landed: string[] = [];
  const delivered = createDelivered((runId) => landed.push(runId));
  // The report comes first, which the two promises make possible.
  delivered.injected(["e1"]);
  delivered.open(async () => ({ ok: true, id: "e1" }));
  expect(await delivered.say("r-1", "back")).toBe(true);
  expect(landed).toEqual(["r-1"]);
});

test("two bells reach the model in the order they were answered", async () => {
  const delivered = createDelivered(() => {});
  const { port, said } = fakePort();
  delivered.open(port);
  void delivered.say("r-1", "first");
  void delivered.say("r-2", "second");
  await settle();
  expect(said.map((m) => m.text)).toEqual(["first", "second"]);
});
