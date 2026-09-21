// Which picture each ingredient gets (src/info/dinner/images.ts), and how it is
// loaded: an external one only through the img: proxy (docs/pitfall/30), an
// app-relative one straight. Run: bash scripts/t.sh tests/info/dinner/images.test.ts

import { expect, test } from "bun:test";
import { imageSrc, ingredientImageUrl, MEALDB_ALIASES } from "../../../src/info/dinner/images";
import { MEALDB_INGREDIENTS } from "../../../src/info/dinner/mealdb-ingredients";

test("an external picture is routed through the proxy", () => {
  expect(
    imageSrc("https://cdn.example/leek.jpg", null, (u) => `img://localhost/${encodeURIComponent(u)}`),
  ).toBe("img://localhost/https%3A%2F%2Fcdn.example%2Fleek.jpg");
});

// A web image search result carries the page it was found on, which the proxy
// sends as Referer; everything else passes nothing and none is sent.
test("a page URL rides along to the proxy, and only when there is one", () => {
  const seen: Array<string | null | undefined> = [];
  const proxy = (u: string, page?: string | null) => {
    seen.push(page);
    return u;
  };
  imageSrc("https://cdn.example/dish.jpg", "https://site.example/recipe", proxy);
  imageSrc("https://cdn.example/leek.jpg", null, proxy);
  imageSrc("https://cdn.example/leek.jpg", "   ", proxy);
  imageSrc("https://cdn.example/leek.jpg", undefined, proxy);
  expect(seen).toEqual(["https://site.example/recipe", null, null, null]);
});

// Outside Tauri the scheme does not exist and the live proxy answers null; the
// plain URL is what bun dev renders, and a null src would draw nothing at all.
test("no proxy route leaves the original URL", () => {
  expect(imageSrc("https://cdn.example/leek.jpg", null, () => null)).toBe(
    "https://cdn.example/leek.jpg",
  );
});

test("an app-relative path and a data URI are loaded as they are", () => {
  const boom = () => {
    throw new Error("nothing local goes near the proxy");
  };
  expect(imageSrc("/dishes/stew.jpg", null, boom)).toBe("/dishes/stew.jpg");
  expect(imageSrc("dishes/stew.jpg", null, boom)).toBe("dishes/stew.jpg");
  expect(imageSrc("data:image/png;base64,AAA", null, boom)).toBe("data:image/png;base64,AAA");
});

test("nothing to show is null, so the caller draws its fallback", () => {
  expect(imageSrc(undefined)).toBe(null);
  expect(imageSrc("")).toBe(null);
  expect(imageSrc("   ")).toBe(null);
});

// The forty of docs/research/食材与菜品图片源调研.md, in the English names the
// model is asked for. Every URL here was fetched with curl on 2026-09-20; the
// three blanks are blank on purpose rather than by accident.
const HITS: ReadonlyArray<[string, string]> = [
  ["bok choy", "themealdb.com/images/ingredients/Pak%20Choi-small.png"],
  ["choy sum", "img.spoonacular.com/ingredients_250x250/choy-sum.jpg"],
  ["gai lan", "themealdb.com/images/ingredients/Chinese%20Broccoli-small.png"],
  ["napa cabbage", "themealdb.com/images/ingredients/Napa%20Cabbage-small.png"],
  ["lotus root", "img.spoonacular.com/ingredients_250x250/lotus-root.jpg"],
  ["enoki", "img.spoonacular.com/ingredients_250x250/enoki-mushrooms.jpg"],
  ["shiitake mushroom", "themealdb.com/images/ingredients/Shiitake%20Mushrooms-small.png"],
  ["firm tofu", "themealdb.com/images/ingredients/Tofu-small.png"],
  ["silken tofu", "themealdb.com/images/ingredients/Silken%20Tofu-small.png"],
  ["edamame", "img.spoonacular.com/ingredients_250x250/edamame.jpg"],
  ["kale", "themealdb.com/images/ingredients/Kale-small.png"],
  ["chickpea", "themealdb.com/images/ingredients/Chickpeas-small.png"],
  ["lentil", "themealdb.com/images/ingredients/Lentils-small.png"],
  ["quinoa", "themealdb.com/images/ingredients/Quinoa-small.png"],
  ["bulgur wheat", "themealdb.com/images/ingredients/Bulgur%20Wheat-small.png"],
  ["salmon", "themealdb.com/images/ingredients/Salmon-small.png"],
  ["shrimp", "themealdb.com/images/ingredients/Prawns-small.png"],
  ["chicken thigh", "themealdb.com/images/ingredients/Chicken%20Thighs-small.png"],
  ["ground pork", "themealdb.com/images/ingredients/Ground%20Pork-small.png"],
  ["eggplant", "themealdb.com/images/ingredients/Aubergine-small.png"],
  ["zucchini", "themealdb.com/images/ingredients/Courgettes-small.png"],
  ["bell pepper", "themealdb.com/images/ingredients/Red%20Pepper-small.png"],
  ["cherry tomato", "themealdb.com/images/ingredients/Cherry%20Tomatoes-small.png"],
  ["spinach", "themealdb.com/images/ingredients/Spinach-small.png"],
  ["arugula", "themealdb.com/images/ingredients/Rocket-small.png"],
  ["cucumber", "themealdb.com/images/ingredients/Cucumber-small.png"],
  ["sweet potato", "themealdb.com/images/ingredients/Sweet%20Potatoes-small.png"],
  ["canned tomatoes", "themealdb.com/images/ingredients/Canned%20Tomatoes-small.png"],
  ["greek yogurt", "themealdb.com/images/ingredients/Greek%20Yogurt-small.png"],
  ["feta", "themealdb.com/images/ingredients/Feta-small.png"],
  ["olive oil", "themealdb.com/images/ingredients/Olive%20Oil-small.png"],
  ["tahini", "themealdb.com/images/ingredients/Tahini-small.png"],
  ["lemon", "themealdb.com/images/ingredients/Lemon-small.png"],
  ["garlic", "themealdb.com/images/ingredients/Garlic-small.png"],
  ["ginger", "themealdb.com/images/ingredients/Ginger-small.png"],
  ["scallion", "themealdb.com/images/ingredients/Spring%20Onions-small.png"],
  ["cilantro", "themealdb.com/images/ingredients/Coriander-small.png"],
];

test("the thirty-seven of the test list that have a photograph get one", () => {
  for (const [en, tail] of HITS) {
    const url = ingredientImageUrl(en);
    expect(url, en).not.toBe(null);
    expect(url, en).toContain(tail);
    expect(url!.startsWith("https://"), en).toBe(true);
  }
});

// Neither source has winter melon or farro, and TheMealDB's only oyster
// mushroom is the flat kind. A glyph does not claim to be the thing; an
// approximate photograph does.
test("the three with no honest photograph get none", () => {
  expect(ingredientImageUrl("winter melon")).toBe(null);
  expect(ingredientImageUrl("farro")).toBe(null);
  expect(ingredientImageUrl("king oyster mushroom")).toBe(null);
});

test("a name nobody wrote a row for, and no name at all, are null", () => {
  expect(ingredientImageUrl("")).toBe(null);
  expect(ingredientImageUrl("   ")).toBe(null);
  expect(ingredientImageUrl("dragon's beard candy")).toBe(null);
});

// The model writes the name; the case and the number it writes it in are not
// worth a re-plan.
test("case, padding and plurals all land on the same picture", () => {
  const one = ingredientImageUrl("eggplant");
  expect(ingredientImageUrl("  Eggplant ")).toBe(one);
  expect(ingredientImageUrl("eggplants")).toBe(one);
  expect(ingredientImageUrl("Chickpeas")).toBe(ingredientImageUrl("chickpea"));
  expect(ingredientImageUrl("cherry tomatoes")).toBe(ingredientImageUrl("cherry tomato"));
  expect(ingredientImageUrl("sweet potatoes")).toBe(ingredientImageUrl("sweet potato"));
});

// An alias that points at a name TheMealDB has since dropped would 404 at load
// time on a device, where nothing is watching. Here it fails a test.
test("every alias points at a name TheMealDB still has", () => {
  const known = new Set(MEALDB_INGREDIENTS.map((n) => n.toLowerCase()));
  for (const [from, to] of Object.entries(MEALDB_ALIASES)) {
    expect(known.has(to.toLowerCase()), `${from} -> ${to}`).toBe(true);
  }
});

test("the list is TheMealDB's 992, deduplicated and sorted", () => {
  expect(MEALDB_INGREDIENTS.length).toBe(992);
  expect(new Set(MEALDB_INGREDIENTS).size).toBe(992);
  const sorted = [...MEALDB_INGREDIENTS].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
  );
  expect(MEALDB_INGREDIENTS).toEqual(sorted);
});

// Both hosts are external https, so both go through the img: scheme or nothing
// loads in the webview at all (docs/pitfall/30).
test("every picture a name resolves to is proxyable", () => {
  for (const [en] of HITS) {
    const url = ingredientImageUrl(en)!;
    expect(imageSrc(url, null, (u) => `img://localhost/${encodeURIComponent(u)}`)).toBe(
      `img://localhost/${encodeURIComponent(url)}`,
    );
  }
});
