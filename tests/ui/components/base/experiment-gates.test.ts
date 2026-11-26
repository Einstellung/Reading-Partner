// What each experiment's switch hides (platform/experiments): the sidebar rows,
// the screens a request may land on, the box cards and the chat cards.

import { expect, test } from "bun:test";
import { hiddenByExperiments, reachableScreen, shellNavItems } from "../../../../src/ui/components/base/shell-nav";
import { shownBoxItems } from "../../../../src/ui/components/companion/box-jump";
import { CARD_REGISTRY } from "../../../../src/ui/components/cardRegistry";
import { gatedRegistry, hiddenCardKinds, MEALS_CARD_KINDS } from "../../../../src/ui/components/card-gates";
import type { BoxItem } from "../../../../src/box/types";

test("Meals has no row while meals is off", () => {
  const ids = (meals: boolean) => shellNavItems({ meals }).map((i) => i.id);
  expect(ids(false)).toEqual(["today", "topics"]);
  expect(ids(true)).toEqual(["today", "meals", "topics"]);
});

test("a hidden line's screens land on Today, and nothing else moves", () => {
  for (const s of ["meals", "meals-day", "meals-recipe", "meals-prep", "meals-shopping", "meals-method", "meals-onboarding"] as const) {
    expect(reachableScreen(s, { meals: false })).toBe("vestibule");
    expect(reachableScreen(s, { meals: true })).toBe(s);
    expect(reachableScreen(s)).toBe(s);
  }
  expect(reachableScreen("library", { meals: false })).toBe("library");
  expect(reachableScreen("settings", { meals: false })).toBe("settings");
});

test("the phone's stack kinds ask the same question", () => {
  expect(hiddenByExperiments("meals-day", { meals: false })).toBe(true);
  expect(hiddenByExperiments("home", { meals: false })).toBe(false);
  expect(hiddenByExperiments("topic", { meals: false })).toBe(false);
});

function item(over: Partial<BoxItem>): Pick<BoxItem, "origin" | "kind" | "body"> {
  return { origin: { place: "door", date: "2026-11-14" }, kind: "note", body: "", ...over } as Pick<
    BoxItem,
    "origin" | "kind" | "body"
  >;
}

test("box cards of a hidden line are not drawn; the rest are", () => {
  const meals = item({ origin: { place: "meals" } as BoxItem["origin"] });
  const door = item({});
  const all = [meals, door];
  expect(shownBoxItems(all, { meals: true })).toEqual(all);
  expect(shownBoxItems(all, { meals: false })).toEqual([door]);
});

// Intel is gone (2026-11); a brief's issue card a box still holds is never drawn.
test("a brief's issue card left in the box is not drawn", () => {
  const issue = item({ kind: "brief-issue" as BoxItem["kind"], body: "book-1" });
  const door = item({});
  expect(shownBoxItems([issue, door], { meals: true })).toEqual([door]);
});

test("the cards of a hidden line render nothing, and every other card is the registry's own", () => {
  expect(hiddenCardKinds({ meals: true })).toEqual([]);
  expect(gatedRegistry(CARD_REGISTRY, [])).toBe(CARD_REGISTRY);
  const gated = gatedRegistry(CARD_REGISTRY, hiddenCardKinds({ meals: false }));
  const hidden = new Set<string>(MEALS_CARD_KINDS);
  for (const [kind, card] of Object.entries(gated)) {
    if (hidden.has(kind)) {
      expect(card).not.toBe(CARD_REGISTRY[kind as keyof typeof CARD_REGISTRY]);
      expect((card as () => unknown)()).toBeNull();
    } else {
      expect(card).toBe(CARD_REGISTRY[kind as keyof typeof CARD_REGISTRY]);
    }
  }
  // The intake card is the companion's, not a line's: it stays.
  expect(gated["link-intake"]).toBe(CARD_REGISTRY["link-intake"]);
});
