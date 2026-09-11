// The places a shell registers (src/desk/places.ts, docs/67): one set at a time,
// what a second registration does to the first, and what a duplicate id does.
// Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { listPlaces, registerPlaces, type Place } from "../../src/desk";

function place(id: string, go: () => void = () => {}): Place {
  return { id, about: `What ${id} is for.`, go };
}

// The registry is one module-level set, so a file that leaves places behind
// mounts go_to in everyone else's turn (pitfall 174: the order is the
// filesystem's).
afterEach(() => {
  registerPlaces([])();
});

test("the places are listed in the order the shell registered them", () => {
  expect(listPlaces()).toEqual([]);
  const off = registerPlaces([place("today"), place("briefing")]);
  expect(listPlaces().map((p) => p.id)).toEqual(["today", "briefing"]);
  off();
  expect(listPlaces()).toEqual([]);
});

test("registering again replaces the set rather than adding to it", () => {
  registerPlaces([place("today"), place("briefing")]);
  registerPlaces([place("today"), place("sources")]);
  expect(listPlaces().map((p) => p.id)).toEqual(["today", "sources"]);
});

// The shell re-registers whenever the callbacks it closed over change, and React
// runs the previous effect's cleanup after the new one has already registered on
// a remount. That cleanup must not empty the table the newer registration left.
test("an unregister from a replaced set leaves the current one alone", () => {
  const stale = registerPlaces([place("today")]);
  registerPlaces([place("today"), place("briefing")]);
  stale();
  expect(listPlaces().map((p) => p.id)).toEqual(["today", "briefing"]);
});

test("two places sharing an id are refused", () => {
  expect(() => registerPlaces([place("today"), place("today")])).toThrow('"today"');
  expect(listPlaces()).toEqual([]);
});

test("a place carries its sentence and its go", async () => {
  let went = 0;
  registerPlaces([place("briefing", () => void went++)]);
  const [briefing] = listPlaces();
  expect(briefing.about).toBe("What briefing is for.");
  await briefing.go();
  expect(went).toBe(1);
});
