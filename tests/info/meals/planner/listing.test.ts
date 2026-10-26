// The dish library as the model reads it (src/info/meals/planner/listing.ts):
// grouped by what a draft uses a dish for, without what this reader cannot
// have or cannot cook.
// Run: scripts/t.sh tests/info/meals/planner/listing.test.ts

import { expect, test } from "bun:test";
import type { Equipment } from "../../../../src/info/meals/dishes/types";
import { planLibrary, type PlanLibrary } from "../../../../src/info/meals/planner/library";
import { libraryListing } from "../../../../src/info/meals/planner/listing";
import { PROFILE } from "./fixture";

const HEADS = ["BATCH MAINS", "FRESH MAINS", "BREAKFASTS", "STAPLE DISHES", "SIDES", "FRUIT"];

const lineOf = (lines: readonly string[], id: string) => lines.find((l) => l.startsWith(`- ${id} `));

test("the sections come in a fixed order, the fruit last on one line", () => {
  const lines = libraryListing(planLibrary(PROFILE));
  const heads = lines.filter((l) => HEADS.some((h) => l.startsWith(h)));
  expect(heads.map((h) => HEADS.find((x) => h.startsWith(x)))).toEqual(HEADS);
  const fruit = lines[lines.length - 1]!;
  expect(fruit).toMatch(/(^|, )apple /);
  expect(fruit).toContain("orange ");
});

test("a batch main lists its ways numbered from 1 with their staples, and its protein kind", () => {
  const lines = libraryListing(planLibrary(PROFILE));
  const chili = lineOf(lines, "chicken_bean_chili")!;
  expect(chili).toContain("[american; stove]");
  expect(chili).toContain("protein poultry");
  expect(chili).toContain("hands-on 15 / total 60 min");
  expect(chili).toContain("ways: 1 ");
  expect(chili).toContain("(brown_rice ");
  expect(chili).toContain("; 3 ");
  // It is listed among the batch mains, before the fresh ones begin.
  const fresh = lines.findIndex((l) => l.startsWith("FRESH MAINS"));
  expect(lines.indexOf(chili)).toBeLessThan(fresh);
  expect(lines.indexOf(lineOf(lines, "kung_pao_chicken")!)).toBeGreaterThan(fresh);
});

test("dishes with a food they dislike or cannot get are left out, and so is that fruit", () => {
  const all = libraryListing(planLibrary(PROFILE));
  expect(lineOf(all, "green_pepper_pork_strips")).toBeDefined();
  expect(lineOf(all, "salmon_broccoli_skillet")).toBeDefined();

  const fewer = libraryListing(planLibrary({ ...PROFILE, dislikes: ["pork"], unavailable: ["salmon", "apple"] }));
  expect(lineOf(fewer, "green_pepper_pork_strips")).toBeUndefined();
  expect(lineOf(fewer, "salmon_broccoli_skillet")).toBeUndefined();
  expect(fewer[fewer.length - 1]).not.toMatch(/(^|, )apple /);
  expect(fewer.length).toBeLessThan(all.length);
});

test("dishes the kitchen cannot make are left out", () => {
  const lib = planLibrary(PROFILE);
  const stoveOnly: PlanLibrary = { ...lib, dish: lib.dish, kitchen: new Set<Equipment>(["stove"]) };
  const all = libraryListing(lib);
  const lines = libraryListing(stoveOnly);
  expect(all.some((l) => l.includes("pressure_cooker]"))).toBe(true);
  expect(lines.some((l) => l.includes("pressure_cooker]") || l.includes("pressure_cooker,"))).toBe(false);
  expect(lineOf(lines, "chicken_bean_chili")).toBeDefined();
});
