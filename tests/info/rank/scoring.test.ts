// Weighted RRF, X engagement and the final score (src/info/rank/fusion.ts,
// engagement.ts, score.ts; docs/88 「打分」 steps 3 and 5). Run: bun test.

import { expect, test } from "bun:test";
import { normalizeRrf, weightedRrf } from "../../../src/info/rank/fusion";
import { xEngagement } from "../../../src/info/rank/engagement";
import { fallbackRerankScore, finalScore, mentionsAnchor } from "../../../src/info/rank/score";

const items = (...keys: string[]) => keys.map((key) => ({ key }));

test("RRF sums weight / (60 + rank) over streams and normalizes against 0.08", () => {
  const fused = weightedRrf([
    { weight: 1, items: items("a", "b", "c") },
    { weight: 0.6, items: items("b", "d") },
  ]);
  expect(fused.map((f) => f.key)).toEqual(["b", "a", "c", "d"]);
  const b = fused[0];
  expect(b.rrf).toBeCloseTo(1 / 62 + 0.6 / 61, 12);
  expect(b.score).toBeCloseTo(((1 / 62 + 0.6 / 61) / 0.08) * 100, 9);
  expect(normalizeRrf(1)).toBe(100);
  expect(normalizeRrf(0)).toBe(0);
});

test("only the first 12 of a stream count, and a repeat inside a stream counts once", () => {
  const keys = Array.from({ length: 15 }, (_, i) => `k${i}`);
  expect(weightedRrf([{ weight: 1, items: items(...keys) }]).map((f) => f.key)).toEqual(keys.slice(0, 12));
  const [only] = weightedRrf([{ weight: 1, items: items("x", "x", "x") }]);
  expect(only.rrf).toBeCloseTo(1 / 61, 12);
});

test("a stream that says how many it gives overrides the 12", () => {
  const keys = Array.from({ length: 50 }, (_, i) => `k${i}`);
  expect(weightedRrf([{ weight: 1, take: 40, items: items(...keys) }]).length).toBe(40);
  expect(weightedRrf([{ weight: 1, take: 40, items: items(...keys) }, { weight: 1, items: items(...keys.map((k) => `a${k}`)) }]).length).toBe(52);
});

test("one author keeps at most three candidates, the best ones, @ and case ignored", () => {
  const stream = {
    weight: 1,
    items: [
      { key: "1", author: "@Alice" },
      { key: "2", author: "alice" },
      { key: "3", author: "bob" },
      { key: "4", author: "ALICE" },
      { key: "5", author: "alice" },
      { key: "6" },
    ],
  };
  expect(weightedRrf([stream]).map((f) => f.key)).toEqual(["1", "2", "3", "4", "6"]);
});

test("X engagement is a log1p-weighted absolute scale", () => {
  expect(xEngagement({ likes: 3 })).toBe(8);
  expect(xEngagement({ likes: 10_000 })).toBe(55);
  expect(xEngagement({ likes: 10_000, reposts: 10_000, replies: 10_000, quotes: 10_000 })).toBe(100);
  expect(xEngagement({ likes: 0, reposts: null })).toBeNull();
  expect(xEngagement({})).toBeNull();
});

test("a post scores 0.65·score + 0.20·RRF + 0.15·engagement, a paper 0.80·score + 0.20·RRF", () => {
  const post = { kind: "post" as const, rerank: 80, relevance: 0.5, rrf: 50, engagement: 40, mentionsAnchor: true };
  expect(finalScore(post)).toBeCloseTo(68, 9);
  expect(finalScore({ ...post, kind: "paper", engagement: null })).toBeCloseTo(74, 9);
  // No engagement counts as 0.
  expect(finalScore({ ...post, engagement: null })).toBeCloseTo(62, 9);
});

test("a model score under 20 multiplies the sum by 0.3; a missed anchor takes 20 off", () => {
  const post = { kind: "post" as const, rerank: 10, relevance: 0.5, rrf: 50, engagement: 40, mentionsAnchor: true };
  expect(finalScore(post)).toBeCloseTo(22.5 * 0.3, 9);
  expect(finalScore({ ...post, rerank: 80, mentionsAnchor: false })).toBeCloseTo(48, 9);
  expect(finalScore({ ...post, mentionsAnchor: false })).toBe(0);
});

test("without the rerank, 0.7·relevance·100 stands in, less 25 for a missed anchor, with no cliff", () => {
  expect(fallbackRerankScore(0.5, true)).toBeCloseTo(35, 9);
  expect(fallbackRerankScore(0.5, false)).toBeCloseTo(10, 9);
  expect(fallbackRerankScore(0.2, false)).toBe(0);
  const post = { kind: "post" as const, rerank: null, relevance: 0.2, rrf: 50, engagement: 40, mentionsAnchor: true };
  // score 14 < 20, but a stand-in is not cliffed.
  expect(finalScore(post)).toBeCloseTo(0.65 * 14 + 10 + 6, 9);
  // Paper, anchor missed: (0.8·10 + 0.2·100) − 20.
  expect(finalScore({ kind: "paper", rerank: null, relevance: 0.5, rrf: 100, engagement: null, mentionsAnchor: false })).toBeCloseTo(8, 9);
});

test("anchors match whole Latin words, or CJK anywhere with spaces ignored", () => {
  expect(mentionsAnchor(["AI for EDA is moving fast"], ["EDA"])).toBe(true);
  expect(mentionsAnchor(["needa better tools"], ["EDA"])).toBe(false);
  expect(mentionsAnchor(["Title", "an abstract about chip design."], ["EDA", "chip design"])).toBe(true);
  expect(mentionsAnchor(["AI 辅助芯片 设计"], ["芯片设计"])).toBe(true);
  expect(mentionsAnchor(["蛋白质"], ["芯片设计"])).toBe(false);
  // Nothing to check against, or nothing to look in: not a miss.
  expect(mentionsAnchor(["anything"], [])).toBe(true);
  expect(mentionsAnchor(["", "  "], ["EDA"])).toBe(true);
});
