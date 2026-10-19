// The Hugging Face step of a topic search (src/info/topic-search/hf-ladder.ts):
// one request, the window narrowed and widened on its answer, the semantic tail
// dropped, the six outcomes; and how what it found merges with arXiv's by id
// (rank-pool.ts gatherCandidates) and shows in the source health. The search is
// scripted; nothing here touches the network.

import { expect, test } from "bun:test";
import { HostCoolingDownError, HttpStatusError, RateLimitError } from "../../../src/platform/http/throttled-fetch";
import type { InfoItem } from "../../../src/info/sources/item";
import { HF_KEEP, hfQueryWords, runHfLadder, type HfSearch } from "../../../src/info/topic-search/hf-ladder";
import { gatherCandidates, streamKey, type ArxivFound } from "../../../src/info/topic-search/rank-pool";
import { sourceHealth } from "../../../src/info/topic-search/build-result";
import { unread } from "../../../src/info/topic-search/run";
import type { TopicSearch } from "../../../src/info/topic-search/types";

const WINDOW = { since: "2026-10-01", until: "2026-10-18" };
const signal = new AbortController().signal;

function hfPaper(id: string, day: string, title: string, extra: Partial<InfoItem> = {}): InfoItem {
  return {
    id: `huggingface-${id}`,
    source: "huggingface",
    sourceName: "Hugging Face",
    sourceKey: id,
    title,
    url: `https://arxiv.org/abs/${id}`,
    publishedAt: day,
    textContent: `${title}. An abstract.`,
    summaryOnly: true,
    ...extra,
  };
}

function scripted(answer: InfoItem[] | (() => never)) {
  const asked: { text: string; window: { since: string; until: string } }[] = [];
  const search: HfSearch = async (text, window) => {
    asked.push({ text, window });
    return typeof answer === "function" ? answer() : answer;
  };
  return { asked, search };
}

test("the Hub is asked with the query's most specific words, in the query's order", () => {
  expect(hfQueryWords("machine learning for materials discovery")).toEqual(["machine", "learning", "materials", "discovery"]);
  expect(hfQueryWords("deep learning symbolic regression physical systems")).toEqual(["deep", "symbolic", "regression", "physical"]);
});

test("enough papers in the run's window: direct, one request over the widened window", async () => {
  const { asked, search } = scripted([
    hfPaper("2610.00001", "2026-10-02", "Symbolic regression one"),
    hfPaper("2610.00002", "2026-10-03", "Symbolic regression two"),
    hfPaper("2501.00003", "2025-01-03", "Symbolic regression old"),
    hfPaper("2610.00004", "2026-10-04", "Symbolic regression three"),
  ]);
  const got = await runHfLadder("symbolic regression", WINDOW, "first", search, signal);
  expect(asked).toEqual([{ text: "symbolic regression", window: { since: "2025-10-01", until: "2026-10-18" } }]);
  expect(got.outcome).toBe("direct");
  expect(got.items.map((i) => i.sourceKey)).toEqual(["2610.00001", "2610.00002", "2610.00004"]);
  expect(got.steps).toEqual([{ terms: ["symbolic", "regression"], ...WINDOW, hits: 3 }]);
  expect(got.error).toBeNull();
});

test("too few in the window: widened on the same answer, the window's papers first", async () => {
  const { asked, search } = scripted([
    hfPaper("2601.00001", "2026-01-05", "Symbolic regression in January"),
    hfPaper("2610.00002", "2026-10-03", "Symbolic regression this month"),
  ]);
  const got = await runHfLadder("symbolic regression", WINDOW, "daily", search, signal);
  expect(asked.length).toBe(1);
  expect(asked[0].window).toEqual({ since: "2026-09-24", until: "2026-10-18" });
  expect(got.outcome).toBe("widened");
  expect(got.items.map((i) => i.sourceKey)).toEqual(["2610.00002", "2601.00001"]);
  expect(got.steps.map((s) => [s.since, s.hits])).toEqual([
    ["2026-10-01", 1],
    ["2026-09-24", 2],
  ]);
});

test("papers naming none of the query's specific words are dropped; nothing left is exhausted", async () => {
  const { search } = scripted([
    hfPaper("2610.00001", "2026-10-02", "Self-driving cars on wet roads", { textContent: "Autonomous vehicles." }),
    hfPaper("2610.00002", "2026-10-03", "A robotic chemistry laboratory", { signals: { aiSummary: "An autonomous lab for synthesis." } }),
  ]);
  const got = await runHfLadder("autonomous laboratory", WINDOW, "first", search, signal);
  expect(got.items.map((i) => i.sourceKey)).toEqual(["2610.00001", "2610.00002"]);
  const narrow = await runHfLadder("chemistry laboratory", WINDOW, "first", scripted([hfPaper("2610.00009", "2026-10-02", "Self-driving cars")]).search, signal);
  expect(narrow.outcome).toBe("exhausted");
  expect(narrow.items).toEqual([]);
});

test("a query keeps at most HF_KEEP papers", async () => {
  const many = Array.from({ length: HF_KEEP + 5 }, (_, i) => hfPaper(`2610.${String(i).padStart(5, "0")}`, "2026-10-05", `Symbolic regression ${i}`));
  const got = await runHfLadder("symbolic regression", WINDOW, "first", scripted(many).search, signal);
  expect(got.items.length).toBe(HF_KEEP);
});

test("a cooldown, a rate limit and any other failure each end the step with their outcome", async () => {
  const cooling = await runHfLadder("symbolic regression", WINDOW, "first", scripted(() => {
    throw new HostCoolingDownError("huggingface.co/api/papers/search", Date.now() + 600_000, Date.now());
  }).search, signal);
  expect(cooling).toMatchObject({ outcome: "cooling_down", items: [], steps: [{ hits: null }] });
  expect(cooling.error).toContain("no request sent");
  const limited = await runHfLadder("symbolic regression", WINDOW, "first", scripted(() => {
    throw new RateLimitError("huggingface.co");
  }).search, signal);
  expect(limited.outcome).toBe("rate_limited");
  const status = await runHfLadder("symbolic regression", WINDOW, "first", scripted(() => {
    throw new HttpStatusError(429, "huggingface.co");
  }).search, signal);
  expect(status.outcome).toBe("rate_limited");
  const failed = await runHfLadder("symbolic regression", WINDOW, "first", scripted(() => {
    throw new HttpStatusError(500, "huggingface.co");
  }).search, signal);
  expect(failed).toMatchObject({ outcome: "failed", error: "HTTP 500 from huggingface.co" });
});

test("a query with no searchable word sends nothing", async () => {
  const { asked, search } = scripted([]);
  expect(await runHfLadder("of the", WINDOW, "first", search, signal)).toEqual({ outcome: "exhausted", steps: [], items: [], error: null });
  expect(asked.length).toBe(0);
});

// --- merged with arXiv's -----------------------------------------------------

const TOPIC: TopicSearch = {
  id: "ts-1",
  name: "Symbolic regression",
  concernId: null,
  scope: "Symbolic regression for physics.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [{ id: "q1", subtopic: null, x: "symbolic regression", arxiv: "symbolic regression", ranking: "", weight: 1 }],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
};

test("a paper both found is one candidate with arXiv's entry and the Hub's facts; one only the Hub found is its own", () => {
  const arxivItem: InfoItem = {
    id: "arxiv-a",
    source: "arxiv",
    sourceName: "arXiv",
    sourceKey: "2610.00001",
    title: "Symbolic regression with transformers",
    url: "https://arxiv.org/abs/2610.00001",
    publishedAt: "2026-10-02T10:00:00Z",
    textContent: "Symbolic regression abstract.",
  };
  const arxiv: ArxivFound[] = [{ query: "q1", items: [arxivItem], error: null, ladder: { outcome: "direct", steps: [] } }];
  const huggingface: ArxivFound[] = [
    {
      query: "q1",
      items: [
        hfPaper("2610.00001", "2026-10-05", "Symbolic regression with transformers", {
          signals: { stars: 120, upvotes: 7, repo: "https://github.com/a/sr", aiSummary: "Transformers do SR." },
        }),
        hfPaper("2610.00002", "2026-10-06", "Symbolic regression benchmarks", { signals: { upvotes: 2 } }),
      ],
      error: null,
      ladder: { outcome: "direct", steps: [] },
    },
  ];
  const x = unread("unavailable", "test");
  const got = gatherCandidates(TOPIC, x, arxiv, 0, huggingface);
  expect(got.all.map((c) => [c.key, c.source, c.foundIn])).toEqual([
    ["arxiv:2610.00001", "arxiv", [streamKey("q1", "arxiv"), streamKey("q1", "huggingface")]],
    ["arxiv:2610.00002", "huggingface", [streamKey("q1", "huggingface")]],
  ]);
  const both = got.all[0].paper!;
  expect(both.publishedAt).toBe("2026-10-02T10:00:00Z");
  expect(both.hub).toEqual({ repo: "https://github.com/a/sr", stars: 120, upvotes: 7, aiSummary: "Transformers do SR." });
  expect(got.all[1].paper!.hub).toEqual({ upvotes: 2 });
  expect(got.streams.get(streamKey("q1", "huggingface"))?.read).toEqual(["arxiv:2610.00001", "arxiv:2610.00002"]);

  const health = sourceHealth(TOPIC, "first", x, arxiv, got.streams, [], 1000, huggingface);
  expect(health.entries.map((e) => [e.source, e.status, e.read])).toEqual([
    ["x", "failed", 0],
    ["arxiv", "ok", 1],
    ["huggingface", "ok", 2],
  ]);
});
