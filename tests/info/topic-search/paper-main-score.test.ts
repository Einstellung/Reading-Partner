// A post whose main is an arXiv paper is scored as a paper, and shares one
// event with that paper's own candidate (src/info/topic-search/rank-pool.ts
// scorePool, rankEvents; docs/info/88 「打分」 5-6). Run: bun test.

import { expect, test } from "bun:test";
import { finalScore } from "../../../src/info/rank/score";
import { numberPool, rankEvents, scorePool, type Candidate, type RerankAnswer } from "../../../src/info/topic-search/rank-pool";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import type { XSearchPost } from "../../../src/info/x/search-page";

const topic = {
  id: "ts-1",
  name: "Agents",
  concernId: null,
  scope: "",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [{ id: "q1", subtopic: null, x: "agents", arxiv: null, ranking: "", weight: 1 }],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
} as unknown as TopicSearch;

function postCand(id: string, links: string[], engagement: number | null): Candidate {
  const post: XSearchPost = {
    id,
    handle: "small",
    name: "Small",
    text: "worth a read",
    postedAt: 0,
    shownAt: null,
    counts: { likes: 1, replies: 0, reposts: 0, bookmarks: 0, views: 0, quotes: 0 },
    links: [],
    truncated: false,
    article: false,
    quoted: null,
    permalink: `https://x.com/small/status/${id}`,
  };
  return {
    key: `x:${id}`,
    kind: "post",
    source: "x",
    queries: ["q1"],
    foundIn: ["q1|x"],
    text: post.text,
    author: "small",
    at: 0,
    post,
    paper: null,
    links: links.map((url) => ({ url, card: false })),
    relevance: 0.5,
    engagement,
    order: 0,
  };
}

function paperCand(id: string): Candidate {
  return {
    key: `arxiv:${id}`,
    kind: "paper",
    source: "arxiv",
    queries: ["q1"],
    foundIn: ["q1|arxiv"],
    text: "A paper\n\nabstract",
    author: "A",
    at: 0,
    post: null,
    paper: { id, title: "A paper", abstract: "abstract", authors: ["A"], publishedAt: null, url: `https://arxiv.org/abs/${id}` },
    links: [],
    relevance: 0.5,
    engagement: null,
    order: 1,
  };
}

const answer = (score: number, main = "self"): RerankAnswer => ({ score, main, subtopic: null, doubt: null });

test("a post whose main is an arXiv paper scores like a paper, engagement ignored", () => {
  const numbered = numberPool([{ cand: postCand("1", ["https://arxiv.org/abs/2609.20997v2"], 2), rrf: 50 }]);
  const [s] = scorePool(topic, numbered, new Map([["c1", answer(80, "c1.a")]]));
  expect(s.key).toBe("arxiv:2609.20997");
  expect(s.kind).toBe("post");
  expect(s.score).toBeCloseTo(0.8 * 80 + 0.2 * 50, 9);
  expect(s.score).toBe(finalScore({ kind: "paper", rerank: 80, relevance: 0.5, rrf: 50, engagement: null }));
});

test("a paper the rerank put at 98 keeps its score without naming an anchor, and ranks above lower-rerank ones", () => {
  const anchored = { ...topic, anchors: ["symbolic regression", "Bayesian optimization"] } as TopicSearch;
  const paper = (id: string, title: string, abstract: string, order: number): Candidate => {
    const c = paperCand(id);
    return { ...c, text: `${title}\n\n${abstract}`, paper: { ...c.paper!, title, abstract }, order };
  };
  const off = paper("2610.00001", "Equation discovery with LLM agents", "We search for closed-form laws of dynamical systems.", 0);
  const named = paper("2610.00002", "Symbolic regression benchmarks revisited", "A Bayesian optimization baseline for program search.", 1);
  const numbered = numberPool([
    { cand: off, rrf: 30 },
    { cand: named, rrf: 60 },
  ]);
  const scored = scorePool(anchored, numbered, new Map([["c1", answer(98)], ["c2", answer(70)]]));
  expect(scored[0].score).toBeGreaterThanOrEqual(0.8 * 98 + 0.2 * 30 - 1e-9);
  expect(scored[0].score).toBeCloseTo(0.8 * 98 + 0.2 * 30, 9);
  expect(rankEvents(scored).map((c) => c.lead.key)).toEqual(["arxiv:2610.00001", "arxiv:2610.00002"]);
});

test("a post that is its own content, or points at something else, keeps the post formula", () => {
  const numbered = numberPool([
    { cand: postCand("1", ["https://arxiv.org/abs/2609.20997"], 2), rrf: 50 },
    { cand: postCand("2", ["https://github.com/o/r"], 2), rrf: 50 },
  ]);
  const scored = scorePool(
    topic,
    numbered,
    new Map([
      ["c1", answer(80)],
      ["c2", answer(80, "c2.a")],
    ]),
  );
  const post = 0.65 * 80 + 0.2 * 50 + 0.15 * 2;
  expect(scored[0].key).toBe("x:1");
  expect(scored[0].score).toBeCloseTo(post, 9);
  expect(scored[1].key).toBe("github:o/r");
  expect(scored[1].score).toBeCloseTo(post, 9);
});

test("the paper and a post pointing at it are one event: the better score, the post kept on it", () => {
  const numbered = numberPool([
    { cand: paperCand("2609.20997"), rrf: 40 },
    { cand: postCand("1", ["https://arxiv.org/pdf/2609.20997v1"], 0), rrf: 50 },
  ]);
  const scored = scorePool(
    topic,
    numbered,
    new Map([
      ["c1", answer(60)],
      ["c2", answer(80, "c2.a")],
    ]),
  );
  const clusters = rankEvents(scored);
  expect(clusters).toHaveLength(1);
  const [event] = clusters[0].events;
  expect(clusters[0].events).toHaveLength(1);
  expect(event.key).toBe("arxiv:2609.20997");
  expect(event.members.map((m) => m.cand.key)).toEqual(["x:1", "arxiv:2609.20997"]);
  expect(event.posts).toBe(1);
  expect(event.score).toBeCloseTo(0.8 * 80 + 0.2 * 50, 9);
});
