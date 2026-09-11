// The shell sidebar's model (src/ui/components/base/shell-nav.ts): three items,
// where each one goes, and which one is lit for a given screen. Run: bun test.

import { expect, test } from "bun:test";
import {
  activeNavFor,
  screenForNav,
  SHELL_NAV_ITEMS,
  type HomeScreen,
} from "../../../../src/ui/components/base/shell-nav";

test("the sidebar has exactly three items, in the order a day uses them", () => {
  expect(SHELL_NAV_ITEMS.map((i) => i.id)).toEqual(["today", "briefing", "topics"]);
  expect(SHELL_NAV_ITEMS.map((i) => i.label)).toEqual(["Today", "Briefing", "Topics"]);
});

test("each item opens its screen", () => {
  expect(screenForNav("today")).toBe("vestibule");
  expect(screenForNav("briefing")).toBe("briefing");
  expect(screenForNav("topics")).toBe("library");
});

// Round trip: whatever an item opens lights that same item back up, or the
// sidebar goes dark the moment it is used.
test("what an item opens lights that item", () => {
  for (const item of SHELL_NAV_ITEMS) {
    expect(activeNavFor(screenForNav(item.id))).toBe(item.id);
  }
});

// The source list and an opened article are reached from the briefing and go
// back to it, so they are still the briefing as far as the sidebar is concerned.
test("the briefing's side rooms keep Briefing lit", () => {
  expect(activeNavFor("article")).toBe("briefing");
  expect(activeNavFor("sources")).toBe("briefing");
});

test("no screen is left without an item, and the reader has none", () => {
  const screens: HomeScreen[] = [
    "vestibule",
    "library",
    "briefing",
    "article",
    "sources",
    "settings",
  ];
  for (const s of screens) expect(activeNavFor(s)).not.toBe(null);
  expect(activeNavFor(null)).toBe(null);
});

// Settings is a screen of the content area, not a view laid over it (docs/51),
// so it is in the union and it lights the row pinned at the sidebar's foot —
// which is why it is a nav id without being one of the three items above.
test("Settings is a screen, and it lights the row at the foot", () => {
  expect(screenForNav("settings")).toBe("settings");
  expect(activeNavFor("settings")).toBe("settings");
  expect(SHELL_NAV_ITEMS.map((i) => i.id)).not.toContain("settings");
});
