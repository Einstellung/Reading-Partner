import { expect, test } from "bun:test";
import { plainBlocks } from "../../../src/platform/std/markdown-plain";

test("headings are their own block, hashes gone", () => {
  expect(plainBlocks("# Title\nBody line.")).toEqual(["Title", "Body line."]);
  expect(plainBlocks("### Closed heading ###")).toEqual(["Closed heading"]);
  expect(plainBlocks("Setext title\n===\n\nNext.")).toEqual(["Setext title", "Next."]);
  expect(plainBlocks("#hashtag is prose")).toEqual(["#hashtag is prose"]);
});

test("emphasis and strikethrough lose their marks", () => {
  expect(plainBlocks("*Pride and Prejudice*, **bold**, __strong__, _em_, ~~gone~~, ***both***")).toEqual([
    "Pride and Prejudice, bold, strong, em, gone, both",
  ]);
  // Not emphasis: a lone star, snake_case, arithmetic.
  expect(plainBlocks("2 * 3 and snake_case_name")).toEqual(["2 * 3 and snake_case_name"]);
});

test("paragraphs split on blank lines and fold their soft breaks", () => {
  expect(plainBlocks("one\ntwo\n\n  three  ")).toEqual(["one two", "three"]);
  expect(plainBlocks("")).toEqual([]);
  expect(plainBlocks("\n\n")).toEqual([]);
});

test("list items are a block each, markers gone", () => {
  expect(plainBlocks("Three points:\n- first\n* second\n2. third\n- [x] done")).toEqual([
    "Three points:",
    "first",
    "second",
    "third",
    "done",
  ]);
});

test("block quotes and rules lose their marks", () => {
  expect(plainBlocks("> quoted *line*\n> more\n\n---\n\nafter")).toEqual(["quoted line more", "after"]);
});

test("citation tokens are dropped with the space before them", () => {
  expect(plainBlocks('Darcy is proud [p.12], and says so [p.3 "I am"] [pp. 4-5] [fig:3a].')).toEqual([
    "Darcy is proud, and says so.",
  ]);
  // A bracket that is not a citation stays.
  expect(plainBlocks("see [note one] here")).toEqual(["see [note one] here"]);
});

test("links and images keep their text", () => {
  expect(plainBlocks("[the paper](https://x.org/a) and ![a chart](c.png)")).toEqual(["the paper and a chart"]);
});

test("code keeps what is in it", () => {
  expect(plainBlocks("Call `a_*b*_` and `` `x` `` here.")).toEqual(["Call a_*b*_ and `x` here."]);
  expect(plainBlocks("Before.\n```ts\nconst a = *b*;\n# not a heading\n```\nAfter.")).toEqual([
    "Before.",
    "const a = *b*; # not a heading",
    "After.",
  ]);
  // A citation shorthand in code is the literal the model wanted shown.
  expect(plainBlocks("`[p.3]`")).toEqual(["[p.3]"]);
});

test("an unclosed fence runs to the end", () => {
  expect(plainBlocks("```\nopen code")).toEqual(["open code"]);
});
