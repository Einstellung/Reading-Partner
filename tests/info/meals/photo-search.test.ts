// Reading a page of Bing image results (src/info/meals/photo-search.ts).
//
// The fixture is a real response, stripped to its result anchors: Bing answers
// curl with the right page and decoy pictures (坑 372), so what is asserted
// here is the shape of the anchors and never the pictures themselves.
// Run: scripts/t.sh tests/info/dinner

import { expect, test } from "bun:test";
import {
  BING_RESULTS_SCRIPT,
  bingImageQuery,
  ingredientQuery,
  parseBingImages,
  pickPhoto,
  siteOf,
  type BingImage,
} from "../../../src/info/meals/photo-search";

const PAGE = await Bun.file(
  new URL("./fixtures/bing-images-shakshuka.html", import.meta.url).pathname,
).text();

test("the query is the photograph filter and the words, encoded", () => {
  const url = bingImageQuery("  Mapo Tofu ");
  expect(url.startsWith("https://www.bing.com/images/search?")).toBe(true);
  const params = new URL(url).searchParams;
  expect(params.get("q")).toBe("Mapo Tofu");
  expect(params.get("qft")).toBe("+filterui:photo-photo");
  expect(params.get("form")).toBe("IRFLTR");
});

test("the script reads the result anchors and stops at ten", () => {
  expect(BING_RESULTS_SCRIPT).toContain('querySelectorAll("a.iusc")');
  expect(BING_RESULTS_SCRIPT).toContain('getAttribute("m")');
  expect(BING_RESULTS_SCRIPT).toContain("out.length < 10");
});

test("a saved page of results parses into pictures", () => {
  const results = parseBingImages(PAGE);
  expect(results.length).toBe(5);
  for (const r of results) {
    expect(r.url.startsWith("https://")).toBe(true);
    expect(r.pageUrl.startsWith("https://")).toBe(true);
    expect(r.site).not.toContain("www.");
    expect(r.thumb).toContain("bing.net");
  }
  expect(results[0]?.site).toBe("themodernproper.com");
});

// What the worker actually gets: the script's value, the `m` attributes as
// strings, still HTML-escaped exactly as the attribute holds them.
test("the script's own value parses the same way", () => {
  const raw = [...PAGE.matchAll(/\sm="([^"]*)"/g)].map((m) => m[1] as string);
  expect(raw.length).toBe(5);
  expect(parseBingImages(raw)).toEqual(parseBingImages(PAGE));
  expect(parseBingImages(JSON.stringify(raw))).toEqual(parseBingImages(PAGE));
});

test("a shape nobody expected is no results rather than a throw", () => {
  expect(parseBingImages(null)).toEqual([]);
  expect(parseBingImages("<html><body>nothing</body></html>")).toEqual([]);
  expect(parseBingImages("[not json")).toEqual([]);
  expect(parseBingImages(["{bad}", 7, { murl: "" }])).toEqual([]);
});

function image(over: Partial<BingImage> = {}): BingImage {
  return {
    url: "https://cdn.example/a.jpg",
    thumb: "",
    pageUrl: "https://example.com/a",
    site: "example.com",
    ...over,
  };
}

test("the first usable picture is taken, and a landscape one before it", () => {
  expect(pickPhoto([])).toBeNull();
  expect(pickPhoto([image({ url: "http://cdn.example/a.jpg" })])).toBeNull();
  expect(pickPhoto([image({ url: "data:image/png;base64,AAA" })])).toBeNull();
  expect(pickPhoto([image({ url: "https://cdn.example/logo.svg" })])).toBeNull();

  const portrait = image({ url: "https://cdn.example/p.jpg", width: 600, height: 900 });
  const wide = image({ url: "https://cdn.example/w.jpg", width: 1200, height: 800 });
  expect(pickPhoto([portrait, wide])?.url).toBe(wide.url);
  // Nothing says what shape any of them are: the first one stands.
  expect(
    pickPhoto([image({ url: "https://cdn.example/1.jpg" }), image({ url: "https://cdn.example/2.jpg" })])
      ?.url,
  ).toBe("https://cdn.example/1.jpg");
});

test("an ingredient is searched for with the word that disambiguates it", () => {
  expect(ingredientQuery("Kale", "produce")).toBe("kale vegetable");
  expect(ingredientQuery("firm tofu", "protein")).toBe("firm tofu food");
  expect(ingredientQuery("  ", "produce")).toBe("");
});

test("the site a caption names is the host without www", () => {
  expect(siteOf("https://www.foodiecrush.com/a/b?c=1")).toBe("foodiecrush.com");
  expect(siteOf("not a url")).toBe("");
});
