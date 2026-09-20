// Which pictures the dinner screen can load (src/info/dinner/images.ts): an
// external one only through the img: proxy (docs/pitfall/30), an app-relative
// one straight. Run: bash scripts/t.sh tests/info/dinner/images.test.ts

import { expect, test } from "bun:test";
import { imageSrc, ingredientImageUrl } from "../../../src/info/dinner/images";

test("an external picture is routed through the proxy", () => {
  expect(imageSrc("https://cdn.example/leek.jpg", (u) => `img://localhost/${encodeURIComponent(u)}`)).toBe(
    "img://localhost/https%3A%2F%2Fcdn.example%2Fleek.jpg",
  );
});

// Outside Tauri the scheme does not exist and the live proxy answers null; the
// plain URL is what bun dev renders, and a null src would draw nothing at all.
test("no proxy route leaves the original URL", () => {
  expect(imageSrc("https://cdn.example/leek.jpg", () => null)).toBe("https://cdn.example/leek.jpg");
});

test("an app-relative path and a data URI are loaded as they are", () => {
  const boom = () => {
    throw new Error("nothing local goes near the proxy");
  };
  expect(imageSrc("/dishes/stew.jpg", boom)).toBe("/dishes/stew.jpg");
  expect(imageSrc("dishes/stew.jpg", boom)).toBe("dishes/stew.jpg");
  expect(imageSrc("data:image/png;base64,AAA", boom)).toBe("data:image/png;base64,AAA");
});

test("nothing to show is null, so the caller draws its fallback", () => {
  expect(imageSrc(undefined)).toBe(null);
  expect(imageSrc("")).toBe(null);
  expect(imageSrc("   ")).toBe(null);
});

// The bank is being built separately. Every caller already draws the glyph, so
// the day it answers a URL nothing else on the screen changes.
test("the ingredient bank answers nothing yet", () => {
  expect(ingredientImageUrl("spinach")).toBe(null);
  expect(ingredientImageUrl("")).toBe(null);
});
