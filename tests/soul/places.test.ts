// go_to (src/soul/places.ts, docs/67): the map the model is handed is the
// registered places themselves, and going somewhere is the shell's own
// callback. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { registerPlaces, type Place } from "../../src/desk";
import { buildPlaceTools, GO_TO_TOOL, placesDescription } from "../../src/soul";

function place(id: string, about: string, go: () => void | Promise<void>): Place {
  return { id, about, go };
}

afterEach(() => {
  registerPlaces([])();
});

async function run(tool: { execute: (args: Record<string, unknown>) => unknown }, place: string) {
  return (await tool.execute({ place })) as string;
}

// A headless run — a test, a legion errand — has no shell and nowhere to take
// anybody, and a go_to whose description lists no places is a tool the model can
// only fail with.
test("no places registered, no tool", () => {
  expect(buildPlaceTools()).toEqual([]);
});

test("the description is the map: every place, with its sentence", () => {
  registerPlaces([
    place("today", "Where the reader lands.", () => {}),
    place("briefing", "What came in overnight.", () => {}),
  ]);
  const [tool] = buildPlaceTools();
  expect(tool.name).toBe(GO_TO_TOOL);
  expect(tool.description).toContain("- today: Where the reader lands.");
  expect(tool.description).toContain("- briefing: What came in overnight.");
  // The argument names what may be passed, so the model never has to guess an id
  // out of the prose.
  expect(JSON.stringify(tool.parameters)).toContain("today, briefing");
});

test("going somewhere calls that place's go and says where it went", async () => {
  const went: string[] = [];
  registerPlaces([
    place("today", "Where the reader lands.", () => void went.push("today")),
    place("briefing", "What came in overnight.", async () => void went.push("briefing")),
  ]);
  const [tool] = buildPlaceTools();
  expect(await run(tool, "briefing")).toBe("Went to briefing.");
  expect(went).toEqual(["briefing"]);
});

test("an id nobody registered goes nowhere and hands back the map", async () => {
  let went = 0;
  registerPlaces([
    place("today", "Where the reader lands.", () => void went++),
    place("sources", "Where the briefing comes from.", () => void went++),
  ]);
  const [tool] = buildPlaceTools();
  expect(await run(tool, "the library")).toBe(
    'No place named "the library"; the places are: today, sources.',
  );
  expect(went).toBe(0);
});

// The description is fixed when the turn is assembled, but a shell re-registers
// whenever its callbacks change. What takes the reader anywhere has to be the
// table as it stands when the tool is called, not the one it was built from.
test("the going is looked up when the tool is called", async () => {
  registerPlaces([place("today", "Where the reader lands.", () => expect.unreachable())]);
  const [tool] = buildPlaceTools();
  let went = 0;
  registerPlaces([place("today", "Where the reader lands.", () => void went++)]);
  expect(await run(tool, "today")).toBe("Went to today.");
  expect(went).toBe(1);
});

test("the map is a list, one line per place", () => {
  expect(
    placesDescription([
      place("today", "Where the reader lands.", () => {}),
      place("settings", "The settings.", () => {}),
    ]),
  ).toEndWith("- today: Where the reader lands.\n- settings: The settings.");
});
