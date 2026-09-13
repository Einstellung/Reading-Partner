// The answer a batch has to give to be usable.
// Run: bash scripts/t.sh tests/reading/translate/prompt.test.ts

import { expect, test } from "bun:test";
import {
  BatchShapeError,
  glossaryMessage,
  glossarySystemPrompt,
  parseBatchResponse,
  parseGlossaryResponse,
  translateBatchMessage,
  translateSystemPrompt,
  type TranslateBatchRequest,
} from "../../../src/reading/translate/prompt";

const REQUEST: TranslateBatchRequest = {
  title: "How a page becomes a book",
  glossary: [{ source: "spine", zh: "书脊" }],
  blocks: [
    { id: "b1", text: "The first line." },
    { id: "b2", text: "The second line." },
  ],
};

test("the request carries the title, the glossary and the blocks", () => {
  const message = translateBatchMessage(REQUEST);
  expect(message).toContain("How a page becomes a book");
  expect(message).toContain("spine => 书脊");
  expect(message).toContain("The second line.");
  expect(translateSystemPrompt()).toContain("⟦1⟧");
});

test("a well-formed answer comes back as blocks, fences and all", () => {
  const raw = '```json\n{"blocks":[{"id":"b1","text":"第一行。"},{"id":"b2","text":"第二行。"}]}\n```';
  expect(parseBatchResponse(raw, REQUEST).blocks).toEqual([
    { id: "b1", text: "第一行。" },
    { id: "b2", text: "第二行。" },
  ]);
});

test("the glossary pass sends the sample and reads back a checked term list", () => {
  const message = glossaryMessage({
    title: "A Title",
    headings: ["The first section"],
    sample: ["A spine is a list."],
  });
  expect(message).toContain("A Title");
  expect(message).toContain("The first section");
  expect(message).toContain("A spine is a list.");
  expect(glossarySystemPrompt()).toContain("Simplified Chinese");

  const parsed = parseGlossaryResponse(
    '{"terms":[{"source":"spine","zh":"书脊"},{"source":"Spine","zh":"脊"},{"source":"x"}]}',
  );
  // Mis-typed entries drop out, and a term said twice is settled once.
  expect(parsed).toEqual([{ source: "spine", zh: "书脊" }]);
  expect(parseGlossaryResponse('{"terms":[]}')).toEqual([]);
  expect(() => parseGlossaryResponse('{"nope":1}')).toThrow(BatchShapeError);
  expect(() => parseGlossaryResponse("sorry")).toThrow(BatchShapeError);
});

test("a short, a long, a shuffled or a textless answer is refused", () => {
  const bad = [
    '{"blocks":[{"id":"b1","text":"一"}]}',
    '{"blocks":[{"id":"b1","text":"一"},{"id":"b2","text":"二"},{"id":"b3","text":"三"}]}',
    '{"blocks":[{"id":"b2","text":"二"},{"id":"b1","text":"一"}]}',
    '{"blocks":[{"id":"b1","text":"一"},{"id":"b2"}]}',
    '{"nope":1}',
    "sorry, I cannot do that",
  ];
  for (const raw of bad) {
    expect(() => parseBatchResponse(raw, REQUEST)).toThrow(BatchShapeError);
  }
});
