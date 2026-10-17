// The result's reservations (docs/info/88 「打分」 7, select.ts) and the rerank
// pool's (rank-pool.ts POOL_RESERVE).

import { expect, test } from "bun:test";
import { fusePool, POOL_RESERVE, type Candidate } from "../../../src/info/topic-search/rank-pool";
import { ITEM_FLOOR, POST_QUOTA, RESERVE_FLOOR, selectItems, shortlist, type SelectView } from "../../../src/info/topic-search/select";
import type { TopicSearch } from "../../../src/info/topic-search/types";

interface E {
  id: string;
  score: number;
  post: number | null;
  sub: string | null;
}

const VIEW: SelectView<E> = { score: (e) => e.score, postScore: (e) => e.post, subtopic: (e) => e.sub };
const paper = (id: string, score: number, sub: string | null = null): E => ({ id, score, post: null, sub });
const post = (id: string, score: number, sub: string | null = null): E => ({ id, score, post: score, sub });
const ids = (es: E[]) => es.map((e) => e.id);

test("papers all outscoring the posts (the 2026-10-15 shape): the posts still take POST_QUOTA places", () => {
  const ranked = [
    ...Array.from({ length: 20 }, (_, i) => paper(`p${i + 1}`, 79 - i)),
    post("x1", 66),
    post("x2", 55),
    post("x3", 48),
    post("x4", 45),
    post("x5", 12),
  ];
  const chosen = selectItems(ranked, 15, [], VIEW);
  expect(chosen).toHaveLength(15);
  expect(ids(chosen.filter((e) => e.post !== null))).toEqual(["x1", "x2", "x3"]);
  expect(POST_QUOTA).toBe(3);
  // The rest are the best papers, and the list stays best first.
  expect(ids(chosen).slice(0, 12)).toEqual(Array.from({ length: 12 }, (_, i) => `p${i + 1}`));
  expect(chosen.map((e) => e.score)).toEqual([...chosen.map((e) => e.score)].sort((a, b) => b - a));
});

test("posts under the floor get no place; a post in a paper's event counts by its own score", () => {
  const ranked = [paper("p1", 90), paper("p2", 85), post("x1", RESERVE_FLOOR - 1), { id: "p3", score: 70, post: 50, sub: null }, paper("p4", 60)];
  // p3 is a paper's event with a post scoring 50 in it: the quota's one item, already in by score.
  expect(ids(selectItems(ranked, 3, [], VIEW))).toEqual(["p1", "p2", "p3"]);
  expect(ids(selectItems(ranked, 2, [], VIEW))).toEqual(["p1", "p3"]);
});

test("a picked subtopic with only low-ranked but qualifying events still gets one", () => {
  const ranked = [
    ...Array.from({ length: 10 }, (_, i) => paper(`w${i + 1}`, 80 - i, "weather")),
    paper("m1", 60, "materials"),
    paper("pr1", 50, "proteins"),
    paper("pr2", 48, "proteins"),
    paper("math1", 47, "math"),
    paper("d1", 30, "dna"),
  ];
  const chosen = selectItems(ranked, 8, ["weather", "materials", "proteins", "dna"], VIEW);
  expect(ids(chosen)).toEqual(["w1", "w2", "w3", "w4", "w5", "w6", "m1", "pr1"]);
  // dna's only event is under the floor; math is not picked.
});

test("a small pool (a retry, 2026-10-17) leaves slots empty rather than listing what is under the item floor", () => {
  const ranked = [post("x1", 62), paper("p1", 35), post("x2", ITEM_FLOOR), post("promo", 0), post("reply", 0), paper("weak", ITEM_FLOOR - 1)];
  expect(ids(selectItems(ranked, 15, [], VIEW))).toEqual(["x1", "p1", "x2"]);
  // A picked subtopic's reservation still needs RESERVE_FLOOR, so it never reaches under the item floor.
  expect(ids(selectItems([paper("s", 5, "sub")], 15, ["sub"], VIEW))).toEqual([]);
});

test("the shortlist keeps the top and whatever a reservation could still take", () => {
  const ranked = [paper("p1", 90), paper("p2", 80), paper("p3", 70, "proteins"), post("x1", 50), post("x2", 20), paper("p4", 45, "proteins"), paper("p5", 44, "math")];
  expect(ids(shortlist(ranked, 2, ["proteins"], VIEW))).toEqual(["p1", "p2", "p3", "x1", "p4"]);
});

function cand(key: string, kind: "post" | "paper", query: string, relevance: number, order: number): Candidate {
  return {
    key,
    kind,
    source: kind === "post" ? "x" : "arxiv",
    queries: [query],
    text: "materials discovery with machine learning",
    author: key,
    at: 0,
    post: null,
    paper: null,
    links: [],
    relevance,
    engagement: null,
    mentionsAnchor: true,
    order,
  };
}

test("the rerank pool keeps places for posts and for each picked subtopic's queries", () => {
  const topic = {
    queries: [
      { id: "q1", subtopic: null, x: "materials discovery", arxiv: "materials discovery", ranking: "", weight: 1 },
      { id: "q2", subtopic: "proteins", x: "materials discovery", arxiv: "materials discovery", ranking: "", weight: 0.1 },
    ],
    subtopics: [{ id: "proteins", name: "Proteins", picked: true }],
  } as unknown as TopicSearch;
  const kept: Candidate[] = [];
  for (let i = 0; i < 12; i++) kept.push(cand(`arxiv:a${i}`, "paper", "q1", 0.9, kept.length));
  for (let i = 0; i < 12; i++) kept.push(cand(`x:${i}`, "post", "q1", 0.9, kept.length));
  for (let i = 0; i < 6; i++) kept.push(cand(`arxiv:p${i}`, "paper", "q2", 0.9, kept.length));
  const pool = fusePool(topic, kept, 12);
  expect(pool).toHaveLength(12);
  const keys = pool.map((p) => p.cand.key);
  expect(keys.filter((k) => k.startsWith("x:")).length).toBeGreaterThanOrEqual(Math.min(POOL_RESERVE.posts, 12 - POOL_RESERVE.perSubtopic));
  expect(keys.filter((k) => k.startsWith("arxiv:p")).length).toBeGreaterThanOrEqual(1);
  // Fusion order is kept.
  expect(pool.map((p) => p.rrf)).toEqual([...pool.map((p) => p.rrf)].sort((a, b) => b - a));
});
