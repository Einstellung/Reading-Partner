// Local relevance and its tokenizer (src/info/rank/relevance.ts, tokens.ts;
// docs/88 「打分」 step 2). Run: bun test.

import { expect, test } from "bun:test";
import { localRelevance, prepareQuery, RELEVANCE_FLOOR } from "../../../src/info/rank/relevance";
import { segment, tokenize } from "../../../src/info/rank/tokens";

test("Latin text splits into words, CJK runs into bigrams", () => {
  expect(segment("GPT-5 beats o3")).toEqual(["gpt", "5", "beats", "o3"]);
  expect(segment("AI辅助芯片设计")).toEqual(["ai", "辅助", "助芯", "芯片", "片设", "设计"]);
  expect(segment("")).toEqual([]);
});

test("tokenize drops stopwords and one-character tokens and adds synonyms", () => {
  expect([...tokenize("The LLM for a protein")].sort()).toEqual(["llm", "llms", "protein", "proteins"]);
});

test("an exact phrase with every word scores 1", () => {
  expect(localRelevance("protein folding", "New protein folding model from DeepMind")).toBe(1);
});

test("a partial match pays: one of three query tokens", () => {
  // coverage 1/3, informative 1/3, precision 1/3:
  // 0.55·(1/3)^1.35 + 0.25/3 + 0.20/3 = 0.27
  const s = localRelevance("protein folding", "folding chairs on sale");
  expect(s).toBe(0.27);
  expect(s).toBeGreaterThan(RELEVANCE_FLOOR);
});

test("matching only low-signal words is capped under the floor's neighbourhood", () => {
  // Five of seven query tokens match, none of them informative (materials).
  expect(localRelevance("latest AI model for materials", "The latest AI model is out")).toBe(0.24);
});

test("Chinese overlaps by bigrams, and a spaced query still earns the phrase bonus", () => {
  expect(localRelevance("蛋白质 折叠", "DeepMind 发布新的蛋白质折叠模型")).toBe(1);
  // No phrase: coverage 1, informative 1, precision 3/5.
  expect(localRelevance("蛋白质 折叠", "蛋白质的折叠")).toBe(0.92);
});

test("no overlap is 0; a query with no usable words is a neutral 0.5", () => {
  expect(localRelevance("protein folding", "weather in Paris")).toBe(0);
  expect(localRelevance("the of a", "anything")).toBe(0.5);
});

test("a prepared query scores the same as its text", () => {
  const q = prepareQuery("robot manipulation");
  expect(localRelevance(q, "a robot manipulation benchmark")).toBe(localRelevance("robot manipulation", "a robot manipulation benchmark"));
  // A query of low-signal words only keeps them all as informative.
  expect([...prepareQuery("latest news").informative].sort()).toEqual(["latest", "news"]);
});
