// The 30-day result dedupe (src/info/rank/dedupe.ts, docs/88 「结果」). Run: bun test.

import { expect, test } from "bun:test";
import { dedupeBatch, dedupeVerdict, headlineTokens, normalizeHeadline } from "../../../src/info/rank/dedupe";

const h = (id: string, headline: string, ...keys: string[]) => ({ id, headline, keys });

test("headlines normalize to lowercase words, keeping dots beside digits, dropping links", () => {
  expect(normalizeHeadline("OpenAI ships GPT-5.5. See https://t.co/xyz now!")).toBe("openai ships gpt 5.5. see now");
  expect([...headlineTokens("The new Llama 4 is on the way")].sort()).toEqual(["llama", "way"]);
  expect([...headlineTokens("智谱发布GLM")].sort()).toEqual(["glm", "发布", "智谱", "谱发"].sort());
});

test("a shared key or the same normalized headline is a duplicate", () => {
  const history = [h("r1", "Anything at all", "x:1", "url:https://a.com/")];
  expect(dedupeVerdict(h("i", "Different words entirely", "url:https://a.com/"), history)).toEqual({
    kind: "duplicate",
    reason: "key",
    matched: "r1",
  });
  expect(dedupeVerdict(h("i", "anything, at all!", "x:2"), history)).toEqual({ kind: "duplicate", reason: "headline", matched: "r1" });
});

test("the same story reworded under another key: ≥ 4 shared tokens and Jaccard ≥ 0.5", () => {
  const history = [h("r1", "Google DeepMind unveils AlphaFold 4 protein structure model", "x:1")];
  expect(dedupeVerdict(h("i", "AlphaFold 4 protein structure model unveiled by Google DeepMind", "x:2"), history)).toEqual({
    kind: "duplicate",
    reason: "cross-source",
    matched: "r1",
  });
});

test("an appended-fact follow-up in [0.35, 0.5) with ≥ 3 shared tokens goes to the judge", () => {
  const history = [h("r1", "Meta releases Llama 5", "x:1"), h("r2", "Unrelated chip news", "x:9")];
  const v = dedupeVerdict(h("i", "Meta releases Llama 5 with 2M token context and native voice", "x:2"), history);
  expect(v.kind).toBe("judge");
  if (v.kind !== "judge") return;
  expect(v.matches).toEqual([{ id: "r1", headline: "Meta releases Llama 5", jaccard: 3 / 8, shared: 3 }]);
});

test("too few shared tokens is new, however high the Jaccard", () => {
  // Three shared of three each: Jaccard 1, but under the four-token floor and
  // above the judge band, which ends below 0.5.
  const history = [h("r1", "Llama weights leak", "x:1")];
  expect(dedupeVerdict(h("i", "weights leak llama", "x:2"), history)).toEqual({ kind: "new" });
  expect(dedupeVerdict(h("i", "Llama models everywhere", "x:3"), history)).toEqual({ kind: "new" });
});

test("Chinese headlines compare by bigrams", () => {
  const history = [h("r1", "智谱发布新一代大模型GLM-5", "x:1")];
  expect(dedupeVerdict(h("i", "智谱发布了新一代大模型 GLM-5", "x:2"), history)).toMatchObject({ kind: "duplicate", reason: "cross-source" });
  expect(dedupeVerdict(h("i", "天气预报说明天下雨", "x:3"), history)).toEqual({ kind: "new" });
});

test("a batch checks each item against the history and the kept items before it", () => {
  const out = dedupeBatch(
    [
      h("a", "Google DeepMind unveils AlphaFold 4 protein structure model", "x:1"),
      h("b", "AlphaFold 4 protein structure model unveiled by Google DeepMind", "x:2"),
      h("c", "Something else", "x:1"),
    ],
    [],
  );
  expect(out.map((o) => o.verdict.kind)).toEqual(["new", "duplicate", "duplicate"]);
  expect(out[1].verdict).toMatchObject({ reason: "cross-source", matched: "a" });
  expect(out[2].verdict).toMatchObject({ reason: "key", matched: "a" });
});
