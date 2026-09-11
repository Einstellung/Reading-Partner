// The shells' places (src/ui/components/base/places.ts, docs/67): which places
// there are, which screen each one opens, and what going anywhere does to an
// open book. Run: bun test.

import { expect, test } from "bun:test";
import {
  PHONE_PLACES,
  PLACE_ABOUT,
  PLACE_IDS,
  screenForPlace,
  shellPlaces,
} from "../../../../src/ui/components/base/places";
import type { HomeScreen } from "../../../../src/ui/components/base/shell-nav";

function shell(over: { inReader?: boolean } = {}) {
  const log: string[] = [];
  const places = shellPlaces({
    goToScreen: (screen: HomeScreen) => void log.push(`screen:${screen}`),
    reader: { isOpen: () => !!over.inReader, close: () => void log.push("close-reader") },
  });
  return { places, log };
}

test("the tablet shell has all five places, in the order a day uses them", () => {
  expect(shell().places.map((p) => p.id)).toEqual([
    "today",
    "briefing",
    "topics",
    "sources",
    "settings",
  ]);
});

test("each place opens its screen", () => {
  expect(screenForPlace("today")).toBe("vestibule");
  expect(screenForPlace("briefing")).toBe("briefing");
  expect(screenForPlace("topics")).toBe("library");
  expect(screenForPlace("sources")).toBe("sources");
  expect(screenForPlace("settings")).toBe("settings");
});

test("going anywhere from the shelf just changes the screen", async () => {
  const { places, log } = shell();
  for (const place of places) await place.go();
  expect(log).toEqual([
    "screen:vestibule",
    "screen:briefing",
    "screen:library",
    "screen:sources",
    "screen:settings",
  ]);
});

// None of these screens is drawn while a book is open, so arriving at one means
// leaving the book first — and in that order, or the screen would be set behind
// a reader that is still up.
test("going anywhere from inside a book closes the book first", async () => {
  const { places, log } = shell({ inReader: true });
  await places[1].go();
  expect(log).toEqual(["close-reader", "screen:briefing"]);
});

// The phone has no shelf — nothing on its home screen leads to the library — and
// opens no books, so it registers four places and no way out of a reader.
test("the phone registers the places it has, and needs no reader to leave", async () => {
  const log: string[] = [];
  const places = shellPlaces(
    { goToScreen: (screen: HomeScreen) => void log.push(screen) },
    PHONE_PLACES,
  );
  expect(places.map((p) => p.id)).toEqual(["today", "briefing", "sources", "settings"]);
  for (const place of places) await place.go();
  expect(log).toEqual(["vestibule", "briefing", "sources", "settings"]);
});

// The sentence is what the soul reads out when it shows somebody around, so
// every place has to have one and it has to read as a sentence.
test("every place says in one sentence what it is for", () => {
  for (const id of PLACE_IDS) {
    const about = PLACE_ABOUT[id];
    expect(about.length).toBeGreaterThan(20);
    expect(about).toEndWith(".");
  }
  expect(PHONE_PLACES.every((id) => PLACE_IDS.includes(id))).toBe(true);
});
