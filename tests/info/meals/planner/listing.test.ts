// The dish library as the model reads it (src/info/meals/planner/listing.ts):
// the mains it picks and the breakfasts it may name, without what this reader
// cannot have or cannot cook; with their portions, each main's sodium and the
// packs only mains use up.
// Run: scripts/t.sh tests/info/meals/planner/listing.test.ts

import { expect, test } from "bun:test";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import type { Equipment } from "../../../../src/info/meals/dishes/types";
import { planLibrary, type PlanLibrary } from "../../../../src/info/meals/planner/library";
import { libraryListing } from "../../../../src/info/meals/planner/listing";
import { readerPortions } from "../../../../src/info/meals/planner/portions";
import { PROFILE, targetsFor } from "./fixture";

const HEADS = ["BATCH MAINS", "FRESH MAINS", "BREAKFASTS"];

const lineOf = (lines: readonly string[], id: string) => lines.find((l) => l.startsWith(`- ${id} `));

test("the sections come in a fixed order, and sides, staples and fruit are the program's", () => {
  const lines = libraryListing(planLibrary(PROFILE));
  const heads = lines.filter((l) => /^[A-Z][A-Z ]+(\(|$)/.test(l));
  expect(heads.map((h) => HEADS.find((x) => h.startsWith(x)))).toEqual(HEADS);
  expect(lines.some((l) => l.startsWith("SIDES") || l.startsWith("FRUIT") || l.startsWith("STAPLE DISHES"))).toBe(false);
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

test("with their portions, each way and fresh main says its sodium and the packs only mains use are listed", () => {
  const lib = planLibrary(PROFILE);
  const lines = libraryListing(lib, SEED_DISHES, readerPortions(lib, SEED_DISHES, targetsFor()[0]!));
  expect(lines[0]).toStartWith("Sodium: a day holds at most 2000 mg.");
  expect(lineOf(lines, "chicken_bean_chili")).toMatch(/\(brown_rice [^)]*\) \d+ mg;/);
  expect(lineOf(lines, "kung_pao_chicken")).toMatch(/min\. \d+ mg staples:/);
  const packs = lines.findIndex((l) => l.startsWith("PACKS ONLY MAINS USE UP"));
  expect(packs).toBeGreaterThan(0);
  const beans = lines.slice(packs).find((l) => l.startsWith("- green_beans "))!;
  expect(beans).toContain("450 g a bag, under 90 g left is fine.");
  expect(beans).toMatch(/lemon_dill_steamed_salmon \d+ g/);
  // A side uses spinach, so the program finishes its packs.
  expect(lines.slice(packs).some((l) => l.startsWith("- spinach "))).toBe(false);
});

test("dishes with a food they dislike or cannot get are left out", () => {
  const all = libraryListing(planLibrary(PROFILE));
  expect(lineOf(all, "green_pepper_pork_strips")).toBeDefined();
  expect(lineOf(all, "salmon_broccoli_skillet")).toBeDefined();

  const fewer = libraryListing(planLibrary({ ...PROFILE, dislikes: ["pork"], unavailable: ["salmon", "apple"] }));
  expect(lineOf(fewer, "green_pepper_pork_strips")).toBeUndefined();
  expect(lineOf(fewer, "salmon_broccoli_skillet")).toBeUndefined();
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
