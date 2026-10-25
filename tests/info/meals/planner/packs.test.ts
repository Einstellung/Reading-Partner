// The shopping list in whole packs (docs/671 整包与开封), in two languages.
// Run: scripts/t.sh tests/info/meals/planner/packs.test.ts

import { afterEach, describe, expect, test } from "bun:test";
import { getLocale, setLocale } from "../../../../src/i18n";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import {
  buyText,
  leftoverMatters,
  packLineText,
  packList,
  potText,
  type PackLine,
} from "../../../../src/info/meals/planner/packs";
import { solveDraft } from "../../../../src/info/meals/planner/solve";
import { goodDraft, PROFILE, targetsFor } from "./fixture";

const initial = getLocale();
afterEach(() => setLocale(initial));

const line = (over: Partial<PackLine> & Pick<PackLine, "food" | "buy">): PackLine => ({
  grams: 100,
  firstDay: 1,
  lastDay: 1,
  freeze: false,
  frozen: false,
  leftover: null,
  ...over,
});

describe("buy text", () => {
  test("zh-CN", () => {
    setLocale("zh-CN");
    expect(buyText(line({ food: "chicken_thigh", buy: { by: "pack", count: 2, packG: 500, kind: "box" } }))).toBe("2 盒（约 1000 g）");
    expect(buyText(line({ food: "celery", buy: { by: "pack", count: 1, packG: 450, kind: "bunch" } }))).toBe("1 把（约 450 g）");
    expect(buyText(line({ food: "apple", buy: { by: "piece", count: 2, pieceG: 182 } }))).toBe("2 个（约 360 g）");
    expect(buyText(line({ food: "egg", buy: { by: "unit", count: 3 } }))).toBe("3 个");
    expect(buyText(line({ food: "salt", buy: { by: "onHand" } }))).toBe("家里常备");
    expect(buyText(line({ food: "cod", buy: { by: "weight" } }))).toBe("");
    expect(potText(3)).toBe("一锅分 3 顿");
  });

  test("en, with singular and plural", () => {
    setLocale("en");
    expect(buyText(line({ food: "chicken_thigh", buy: { by: "pack", count: 1, packG: 500, kind: "box" } }))).toBe("1 pack (about 500 g)");
    expect(buyText(line({ food: "chicken_thigh", buy: { by: "pack", count: 2, packG: 500, kind: "box" } }))).toBe("2 packs (about 1000 g)");
    expect(buyText(line({ food: "whole_wheat_toast", buy: { by: "pack", count: 1, packG: 450, kind: "loaf" } }))).toBe("1 loaf (about 450 g)");
    expect(buyText(line({ food: "whole_wheat_toast", buy: { by: "pack", count: 2, packG: 450, kind: "loaf" } }))).toBe("2 loaves (about 900 g)");
    expect(buyText(line({ food: "apple", buy: { by: "piece", count: 1, pieceG: 182 } }))).toBe("1 piece (about 180 g)");
    expect(buyText(line({ food: "egg", buy: { by: "unit", count: 3 } }))).toBe("3 pieces");
    expect(buyText(line({ food: "salt", buy: { by: "onHand" } }))).toBe("on hand");
    expect(potText(1)).toBe("1 pot, 1 meal");
    expect(potText(2)).toBe("1 pot, 2 meals");
  });

  test("every pack kind has words in both languages", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      setLocale(locale);
      for (const kind of ["box", "bag", "block", "carton", "head", "bunch", "loaf"] as const) {
        const text = buyText(line({ food: "x", buy: { by: "pack", count: 2, packG: 300, kind } }));
        expect(text, `${locale} ${kind}`).not.toContain("meals.pack");
        expect(text, `${locale} ${kind}`).toContain("600");
      }
    }
  });
});

describe("a list line", () => {
  test("the food's name then how much to buy", () => {
    setLocale("zh-CN");
    expect(packLineText(line({ food: "chicken_thigh", buy: { by: "pack", count: 1, packG: 500, kind: "box" } }))).toBe("去皮鸡腿肉 1 盒（约 500 g）");
    setLocale("en");
    expect(packLineText(line({ food: "chicken_thigh", buy: { by: "pack", count: 1, packG: 500, kind: "box" } }))).toBe("去皮鸡腿肉 1 pack (about 500 g)");
  });

  test("a food bought by weight reads as an approximate weight, rounded to 10 g", () => {
    setLocale("zh-CN");
    expect(packLineText(line({ food: "cod", grams: 143, buy: { by: "weight" } }))).toBe("鳕鱼（约 140 g）");
    setLocale("en");
    expect(packLineText(line({ food: "cod", grams: 143, buy: { by: "weight" } }))).toBe("鳕鱼 (about 140 g)");
    expect(packLineText(line({ food: "cod", grams: 3, buy: { by: "weight" } }))).toBe("鳕鱼 (about 10 g)");
  });

  test("an id the table lacks is shown as the id", () => {
    setLocale("en");
    expect(packLineText(line({ food: "no_such_food", buy: { by: "onHand" } }))).toBe("no_such_food on hand");
  });
});

describe("the list of a solved plan", () => {
  const plan = () => solveDraft(goodDraft(), planLibrary(PROFILE), targetsFor());
  const list = (people = 1) => packList(plan(), goodDraft(), people);
  const find = (food: string, people = 1) => list(people).find((l) => l.food === food)!;

  test("raw meat comes in packs and stays chilled when the prep session cooks it", () => {
    const thigh = find("chicken_thigh");
    expect(thigh.buy).toEqual({ by: "pack", count: 1, packG: 500, kind: "box" });
    expect(thigh.freeze).toBe(false);
    expect(thigh.leftover).toBeNull();
  });

  test("a pot's meat is needed on its prep session's day", () => {
    expect(find("chicken_thigh").firstDay).toBe(1);
  });

  test("seasonings are on hand and loose produce is bought by the piece", () => {
    expect(find("ground_cumin").buy).toEqual({ by: "onHand" });
    expect(find("apple").buy.by).toBe("piece");
  });

  test("people multiply the grams and can add a pack", () => {
    const one = find("chicken_thigh");
    const four = find("chicken_thigh", 4);
    expect(four.grams).toBeCloseTo(one.grams * 4, 6);
    expect(four.buy.by === "pack" && four.buy.count).toBeGreaterThan(1);
  });

  test("is sorted by first day, then name", () => {
    const l = list();
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1];
      const b = l[i];
      expect(a.firstDay < b.firstDay || (a.firstDay === b.firstDay && a.food.localeCompare(b.food) <= 0)).toBe(true);
    }
  });

  test("a perishable pack's leftover is counted, and only a fifth of a pack matters", () => {
    // The good draft finishes everything it buys; add 50 g of spinach (a 300 g
    // pack that keeps 3 days once opened) to day 2 to leave one over.
    const solved = plan();
    solved.days[1].meals.breakfast.lines.push({ food: "spinach", grams: 50, role: "veg", source: "breakfast" });
    const spinach = packList(solved, goodDraft()).find((l) => l.food === "spinach")!;
    expect(spinach.buy).toMatchObject({ by: "pack", count: 1, packG: 300 });
    expect(spinach.firstDay).toBe(2);
    expect(spinach.leftover).toEqual({ grams: 250, spoilsDay: 5 });
    expect(leftoverMatters(spinach)).toBe(true);
    const pack = { by: "pack", count: 1, packG: 500, kind: "box" } as const;
    expect(leftoverMatters(line({ food: "x", buy: pack, leftover: { grams: 99, spoilsDay: 3 } }))).toBe(false);
    expect(leftoverMatters(line({ food: "x", buy: pack, leftover: { grams: 100, spoilsDay: 3 } }))).toBe(true);
    expect(leftoverMatters(line({ food: "x", buy: { ...pack, packG: 100 }, leftover: { grams: 40, spoilsDay: 3 } }))).toBe(false);
    expect(leftoverMatters(line({ food: "x", buy: { by: "weight" }, leftover: { grams: 400, spoilsDay: 3 } }))).toBe(false);
    expect(leftoverMatters(line({ food: "x", buy: pack }))).toBe(false);
  });
});
