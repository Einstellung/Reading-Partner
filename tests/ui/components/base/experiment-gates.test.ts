// What each experiment's switch hides (platform/experiments): the sidebar rows,
// the screens a request may land on, the box cards and the chat cards.

import { expect, test } from "bun:test";
import { hiddenByExperiments, reachableScreen, shellNavItems } from "../../../../src/ui/components/base/shell-nav";
import { shownBoxItems } from "../../../../src/ui/components/companion/box-jump";
import { CARD_REGISTRY } from "../../../../src/ui/components/cardRegistry";
import {
  gatedRegistry,
  hiddenCardKinds,
  INTEL_CARD_KINDS,
  MEALS_CARD_KINDS,
} from "../../../../src/ui/components/card-gates";
import { ISSUE_BOX_KIND } from "../../../../src/info/issue/types";
import type { BoxItem } from "../../../../src/box/types";

test("Briefs has no row while intel is off, and keeps it when the option is left out", () => {
  const ids = (briefs?: boolean) =>
    shellNavItems({ meals: true, oldBriefing: false, ...(briefs === undefined ? {} : { briefs }) }).map((i) => i.id);
  expect(ids(false)).toEqual(["today", "meals", "topics"]);
  expect(ids(true)).toEqual(["today", "briefs", "meals", "topics"]);
  expect(ids()).toEqual(["today", "briefs", "meals", "topics"]);
});

test("a hidden line's screens land on Today, and nothing else moves", () => {
  for (const s of ["meals", "meals-day", "meals-recipe", "meals-prep", "meals-shopping", "meals-method", "meals-onboarding"] as const) {
    expect(reachableScreen(s, false, { meals: false })).toBe("vestibule");
    expect(reachableScreen(s, false, { meals: true })).toBe(s);
    expect(reachableScreen(s, false)).toBe(s);
  }
  expect(reachableScreen("briefs", false, { intel: false })).toBe("vestibule");
  expect(reachableScreen("briefs", false, { intel: true })).toBe("briefs");
  expect(reachableScreen("library", false, { meals: false, intel: false })).toBe("library");
  expect(reachableScreen("settings", false, { meals: false, intel: false })).toBe("settings");
});

test("the phone's stack kinds ask the same question", () => {
  expect(hiddenByExperiments("briefs", { intel: false })).toBe(true);
  expect(hiddenByExperiments("meals-day", { meals: false })).toBe(true);
  expect(hiddenByExperiments("home", { meals: false, intel: false })).toBe(false);
  expect(hiddenByExperiments("saved", { meals: false, intel: false })).toBe(false);
  expect(hiddenByExperiments("topic", { meals: false, intel: false })).toBe(false);
});

function item(over: Partial<BoxItem>): Pick<BoxItem, "origin" | "kind" | "body"> {
  return { origin: { place: "door", date: "2026-11-14" }, kind: "note", body: "", ...over } as Pick<
    BoxItem,
    "origin" | "kind" | "body"
  >;
}

test("box cards of a hidden line are not drawn; the rest are", () => {
  const meals = item({ origin: { place: "meals" } as BoxItem["origin"] });
  const issue = item({ kind: ISSUE_BOX_KIND, body: "book-1" });
  const door = item({});
  const all = [meals, issue, door];
  expect(shownBoxItems(all, { meals: true, intel: true })).toEqual(all);
  expect(shownBoxItems(all, { meals: false, intel: true })).toEqual([issue, door]);
  expect(shownBoxItems(all, { meals: true, intel: false })).toEqual([meals, door]);
  expect(shownBoxItems(all, { meals: false, intel: false })).toEqual([door]);
});

test("the cards of a hidden line render nothing, and every other card is the registry's own", () => {
  expect(hiddenCardKinds({ meals: true, intel: true })).toEqual([]);
  expect(gatedRegistry(CARD_REGISTRY, [])).toBe(CARD_REGISTRY);
  const gated = gatedRegistry(CARD_REGISTRY, hiddenCardKinds({ meals: false, intel: false }));
  const hidden = new Set<string>([...MEALS_CARD_KINDS, ...INTEL_CARD_KINDS]);
  for (const [kind, card] of Object.entries(gated)) {
    if (hidden.has(kind)) {
      expect(card).not.toBe(CARD_REGISTRY[kind as keyof typeof CARD_REGISTRY]);
      expect((card as () => unknown)()).toBeNull();
    } else {
      expect(card).toBe(CARD_REGISTRY[kind as keyof typeof CARD_REGISTRY]);
    }
  }
  // The intake card is the companion's, not Intel's: it stays.
  expect(gated["link-intake"]).toBe(CARD_REGISTRY["link-intake"]);
});
