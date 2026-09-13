// Where a translation lands, and what it is made of.
// Run: bash scripts/t.sh tests/reading/translate/apply.test.ts

import { expect, test } from "bun:test";
import { AlreadyTranslatedError, applyTranslations } from "../../../src/reading/translate/apply";
import { placeholder, placeholdersIn, splitMasked } from "../../../src/reading/translate/mask";
import { segmentDocument } from "../../../src/reading/translate/segment";

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");
}

function translate(html: string, texts: Record<string, string>): Document {
  const doc = parse(html);
  const blocks = segmentDocument(doc);
  applyTranslations(doc.body, blocks, new Map(Object.entries(texts)));
  return doc;
}

test("a paragraph gets a paragraph after it, a heading a heading of the same level", () => {
  const doc = translate("<h2 id=\"s\">Section</h2><p>A line.</p>", {
    b1: "小节",
    b2: "一行。",
  });
  const kids = Array.from(doc.body.children).map((el) => el.localName);
  expect(kids).toEqual(["h2", "h2", "p", "p"]);
  const zh = Array.from(doc.body.querySelectorAll(".rp-zh"));
  expect(zh.map((el) => el.getAttribute("lang"))).toEqual(["zh", "zh"]);
  expect(zh.map((el) => el.textContent)).toEqual(["小节", "一行。"]);
  // A translated heading is not an anchor: the outline stays the article's.
  expect(zh.some((el) => el.hasAttribute("id"))).toBe(false);
});

test("a list item's translation goes inside it, above any list nested under it", () => {
  const doc = translate("<ol><li>First<ul><li>Under</li></ul></li></ol>", {
    b1: "第一",
    b2: "下面",
  });
  const outer = doc.querySelector("ol > li") as Element;
  expect(Array.from(outer.children).map((el) => el.localName)).toEqual(["div", "ul"]);
  expect(outer.children[0].getAttribute("class")).toBe("rp-zh");
  expect(outer.children[0].textContent).toBe("第一");
  // Still one list item at each level: nothing grew a second bullet.
  expect(doc.querySelectorAll("li")).toHaveLength(2);
});

test("a placeholder comes back as the element it stood for, without its id", () => {
  const doc = translate(
    '<p>Call <code id="c">parse()</code> first.</p>',
    { b1: `先调用 ${placeholder(1)}。` },
  );
  const zh = doc.querySelector(".rp-zh") as Element;
  expect(zh.innerHTML).toBe("先调用 <code>parse()</code>。");
  expect(zh.querySelector("code")?.hasAttribute("id")).toBe(false);
  // The original keeps its own.
  expect(doc.querySelector("p > code")?.getAttribute("id")).toBe("c");
});

test("a placeholder the model dropped or invented costs the text and nothing else", () => {
  const doc = translate("<p>See <code>x</code> and <code>y</code>.</p>", {
    b1: `见 ${placeholder(2)} 和 ${placeholder(9)}。`,
  });
  const zh = doc.querySelector(".rp-zh") as Element;
  expect(zh.innerHTML).toBe("见 <code>y</code> 和 ⟦9⟧。");
});

test("a block the model returned nothing for, or nothing but space, is left alone", () => {
  const doc = translate("<p>One.</p><p>Two.</p>", { b1: "   " });
  expect(doc.querySelectorAll(".rp-zh")).toHaveLength(0);
  expect(doc.body.children).toHaveLength(2);
});

test("a second pass over a translated document is refused", () => {
  const doc = translate("<p>A line.</p>", { b1: "一行。" });
  expect(() => applyTranslations(doc.body, segmentDocument(doc), new Map([["b1", "再一行"]]))).toThrow(
    AlreadyTranslatedError,
  );
  expect(doc.querySelectorAll(".rp-zh")).toHaveLength(1);
});

test("masking splits on the bracket form and on nothing else", () => {
  expect(splitMasked(`a${placeholder(1)}b`)).toEqual([
    { kind: "text", text: "a" },
    { kind: "mask", index: 1 },
    { kind: "text", text: "b" },
  ]);
  expect(splitMasked("⟦one⟧")).toEqual([{ kind: "text", text: "⟦one⟧" }]);
  expect(placeholdersIn(`${placeholder(2)}x${placeholder(2)}${placeholder(1)}`)).toEqual([2, 1]);
});
