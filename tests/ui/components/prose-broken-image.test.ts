// hideBrokenImage (src/ui/components/common/proseCss.ts): the article views'
// answer to an image that failed to load. Run: bun test.

import { expect, test } from "bun:test";
import { hideBrokenImage } from "../../../src/ui/components/common/proseCss";

function el(tagName: string) {
  return { tagName, style: { display: "" } };
}

test("hides an img that failed to load", () => {
  const img = el("IMG");
  hideBrokenImage(img as unknown as EventTarget);
  expect(img.style.display).toBe("none");
});

test("leaves any other element and a null target alone", () => {
  const div = el("DIV");
  hideBrokenImage(div as unknown as EventTarget);
  expect(div.style.display).toBe("");
  expect(() => hideBrokenImage(null)).not.toThrow();
  expect(() => hideBrokenImage({ tagName: "IMG" } as unknown as EventTarget)).not.toThrow();
});
