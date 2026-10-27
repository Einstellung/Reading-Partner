// The device's one call as the rest of the app reaches it (soul/voice/live/call-host.ts).

import { afterEach, expect, test } from "bun:test";
import {
  attachToCall,
  callExtra,
  callIsOpen,
  openCall,
  registerCallHost,
  requestCall,
  resetCallHost,
  sayInCall,
  subscribeCall,
  type CallBuilder,
} from "../../../../src/soul/voice/live/call-host";

afterEach(() => resetCallHost());

test("a start asked for goes to the corner with the call it wants built; none without a corner", () => {
  const build: CallBuilder = async () => null;
  expect(requestCall(build)).toBe(false);
  const asked: (CallBuilder | undefined)[] = [];
  const undo = registerCallHost({ start: (b) => void asked.push(b) });
  expect(requestCall(build)).toBe(true);
  expect(asked).toEqual([build]);
  undo();
  expect(requestCall(build)).toBe(false);
});

test("the program speaks only into an open call, and listeners hear it open and close", () => {
  const heard: boolean[] = [];
  subscribeCall(() => heard.push(callIsOpen()));
  expect(sayInCall("Next: chop")).toBe(false);
  const said: string[] = [];
  const close = openCall((text) => said.push(text));
  expect(sayInCall("Next: chop")).toBe(true);
  close();
  expect(sayInCall("Stove is done.")).toBe(false);
  expect(said).toEqual(["Next: chop"]);
  expect(heard).toEqual([true, false]);
});

test("what a screen attaches is cleared only by its own undo", () => {
  const a = { place: () => "a", tools: () => [] };
  const b = { place: () => "b", tools: () => [] };
  const undoA = attachToCall(a);
  attachToCall(b);
  undoA();
  expect(callExtra()).toBe(b);
});
