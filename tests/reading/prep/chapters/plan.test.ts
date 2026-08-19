// Unit tests for the notes plan (src/reading/notes/plan.ts): the AI
// table-of-contents fallback parse. Reading the PDF outline and assigning page
// ranges moved to src/reading/chapters — those cases are in
// tests/reading/chapters/. Run: bun test.

import { expect, test } from "bun:test";
import { parseNotesPlan } from "../../../../src/reading/prep/chapters/plan";

test("parseNotesPlan reads the JSON chapters and assigns ranges", () => {
  const text =
    'here you go:\n```json\n{ "chapters": [ { "title": "Preface", "startPage": 1 }, ' +
    '{ "title": "Core", "startPage": 8 } ] }\n```';
  const chapters = parseNotesPlan(text, 25);
  expect(chapters.map((c) => c.title)).toEqual(["Preface", "Core"]);
  expect(chapters.map((c) => [c.startPage, c.endPage])).toEqual([
    [1, 7],
    [8, 25],
  ]);
});

test("parseNotesPlan throws with no parseable chapters", () => {
  expect(() => parseNotesPlan('{ "chapters": [] }', 10)).toThrow(/no parseable chapters/);
  expect(() => parseNotesPlan("not json at all", 10)).toThrow(/no JSON object/);
});
