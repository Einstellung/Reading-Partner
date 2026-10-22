// The shell sidebar's model (src/ui/components/base/shell-nav.ts): which items
// it has, which of them the settings decide, where each one goes, and which one
// is lit for a given screen. Run: bun test.

import { expect, test } from "bun:test";
import { translate } from "../../../../src/i18n";
import {
  activeNavFor,
  reachableScreen,
  screenForNav,
  shellNavItems,
  showsLaunchCard,
  SHELL_NAV_ITEMS,
  type HomeScreen,
} from "../../../../src/ui/components/base/shell-nav";

test("the sidebar's items are in the order a day uses them", () => {
  expect(SHELL_NAV_ITEMS.map((i) => i.id)).toEqual(["today", "briefing", "briefs", "meals", "topics"]);
  expect(SHELL_NAV_ITEMS.map((i) => translate("en", i.labelKey))).toEqual(["Today", "Briefing", "Briefs", "Meals", "Topics"]);
});

// Meals is opt-in (settings.meals, docs/73), and off it is not in the column
// at all — the reader having said no is not a reason to show them a row.
// With the old briefing's UI forced on (src/info/old-briefing.ts), so its row
// stays covered.
test("Meals is drawn only when it is switched on, in its own place", () => {
  expect(shellNavItems({ meals: false, oldBriefing: true }).map((i) => i.id)).toEqual(["today", "briefing", "briefs", "topics"]);
  expect(shellNavItems({ meals: true, oldBriefing: true }).map((i) => i.id)).toEqual([
    "today",
    "briefing",
    "briefs",
    "meals",
    "topics",
  ]);
});

// Off, as shipped: no Briefing row, and nothing reaches its page or its article.
test("with the old briefing's UI off its row is gone and its screens land on Today", () => {
  expect(shellNavItems({ meals: false }).map((i) => i.id)).toEqual(["today", "briefs", "topics"]);
  expect(shellNavItems({ meals: true }).map((i) => i.id)).toEqual(["today", "briefs", "meals", "topics"]);
  expect(reachableScreen("briefing")).toBe("vestibule");
  expect(reachableScreen("article")).toBe("vestibule");
  expect(reachableScreen("briefs")).toBe("briefs");
  expect(reachableScreen("meals-day")).toBe("meals-day");
  expect(reachableScreen("briefing", true)).toBe("briefing");
  expect(reachableScreen("article", true)).toBe("article");
});

test("each item opens its screen", () => {
  expect(screenForNav("today")).toBe("vestibule");
  expect(screenForNav("briefing")).toBe("briefing");
  expect(screenForNav("briefs")).toBe("briefs");
  expect(screenForNav("meals")).toBe("meals");
  expect(screenForNav("topics")).toBe("library");
});

// Round trip: whatever an item opens lights that same item back up, or the
// sidebar goes dark the moment it is used.
test("what an item opens lights that item", () => {
  for (const item of SHELL_NAV_ITEMS) {
    expect(activeNavFor(screenForNav(item.id))).toBe(item.id);
  }
});

// An opened article is reached from the briefing and goes back to it, so it is
// still the briefing as far as the sidebar is concerned.
test("the briefing's side room keeps Briefing lit", () => {
  expect(activeNavFor("article")).toBe("briefing");
});

test("no screen is left without an item, and the reader has none", () => {
  const screens: HomeScreen[] = [
    "vestibule",
    "library",
    "briefing",
    "article",
    "meals",
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

// The Briefing item opens a screen that has nothing to draw until today's
// briefing exists; it shows the launch card instead of a blank pane.
test("the briefing screen falls back to the launch card without a briefing", () => {
  expect(showsLaunchCard("briefing", false)).toBe(true);
  expect(showsLaunchCard("briefing", true)).toBe(false);
  expect(showsLaunchCard("vestibule", true)).toBe(true);
  expect(showsLaunchCard("vestibule", false)).toBe(true);
  expect(showsLaunchCard("library", false)).toBe(false);
  expect(showsLaunchCard("article", false)).toBe(false);
});
