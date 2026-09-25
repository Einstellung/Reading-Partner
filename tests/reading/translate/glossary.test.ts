// What the glossary pass is shown.
// Run: bash scripts/t.sh tests/reading/translate/glossary.test.ts

import { expect, test } from "bun:test";
import { glossaryRequestFor } from "../../../src/reading/translate/glossary";
import { segmentDocument } from "../../../src/reading/translate/segment";

// firstSentence itself now lives in platform/std/text.ts and is tested there
// (src/platform/std/text.test.ts); glossary.ts just imports it.

function blocks(html: string) {
  return segmentDocument(
    new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html"),
  );
}

test("the request is the title, every heading, and opening sentences", () => {
  const request = glossaryRequestFor(
    "A Title",
    blocks(`<h2>The first section</h2>
      <p>A spine is a list. The rest of the paragraph does not matter here.</p>
      <h3>A sub-heading</h3>
      <p>A ruler measures. And then some.</p>`),
  );
  expect(request.title).toBe("A Title");
  expect(request.headings).toEqual(["The first section", "A sub-heading"]);
  expect(request.sample).toEqual(["A spine is a list.", "A ruler measures."]);
});

test("the sample stops at the budget, and the headings come out of it first", () => {
  const many = Array.from({ length: 400 }, (_, i) => `<p>Sentence number ${i}. More words.</p>`);
  const request = glossaryRequestFor("A Title", blocks(many.join("")), 100);
  expect(request.sample.length).toBeGreaterThan(0);
  expect(request.sample.length).toBeLessThan(60);

  const headingHeavy = glossaryRequestFor(
    "A Title",
    blocks(`${Array.from({ length: 40 }, (_, i) => `<h2>A heading of some length ${i}</h2>`).join("")}<p>A line. More.</p>`),
    20,
  );
  expect(headingHeavy.headings).toHaveLength(40);
  expect(headingHeavy.sample).toEqual([]);
});
