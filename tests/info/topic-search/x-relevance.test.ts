// The X reader's permalink floor and its relevance alarm (pitfall 660): the
// floor is measured on the words the build measures it on, and a run where
// nearly every post scores 0 says so and opens a few pages in page order.

import { expect, test } from "bun:test";
import { prepareQuery, RELEVANCE_FLOOR } from "../../../src/info/rank/relevance";
import { sourceHealth } from "../../../src/info/topic-search/build-result";
import { gatherCandidates, relevanceBasis } from "../../../src/info/topic-search/rank-pool";
import { healthLines } from "../../../src/info/topic-search/run-status";
import { foldTopicSearchHealth } from "../../../src/info/topic-search/source-health";
import type { TopicQuery, TopicSearch } from "../../../src/info/topic-search/types";
import { collapseNote, replay, tallySteps, type XStep } from "../../../src/info/topic-search/x-progress";
import {
  COLLAPSE_FALLBACK,
  COLLAPSE_MIN_POSTS,
  permalinkPicks,
  relevanceCollapse,
  type XReadResult,
} from "../../../src/info/topic-search/x-reader";
import type { XSearchPost } from "../../../src/info/x/search-page";

const QUERY: TopicQuery = {
  id: "q2",
  subtopic: null,
  x: "symbolic regression equation discovery from data -filter:retweets lang:en",
  arxiv: null,
  ranking: "怎么从观测数据里自动归纳出规律、方程或可检验的假设？",
  weight: 1,
};

const TOPIC: TopicSearch = {
  id: "ts-0000bbbb",
  name: "自主机制发现",
  concernId: "s-1",
  scope: "AI that finds mechanisms on its own",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: ["symbolic regression"],
  queries: [QUERY],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 1,
  lastRunAt: null,
};

function post(id: number, text: string, truncated = true): XSearchPost {
  return {
    id: String(1_800_000_000_000_000_000n + BigInt(id)),
    handle: "someone",
    name: "Some One",
    text,
    postedAt: 1_790_000_000_000,
    shownAt: null,
    counts: { replies: 0, reposts: 0, likes: 0, bookmarks: 0, views: 0, quotes: null },
    links: [],
    truncated,
    article: false,
    quoted: null,
    permalink: `https://x.com/someone/status/${id}`,
  };
}

const ON_TOPIC = [
  post(1, "New preprint: symbolic regression recovers the governing equation from noisy data"),
  post(2, "Equation discovery from data with sparse regression, a thread"),
  post(3, "Our lab is hiring", false),
];

test("the floor on the ranking question passes no English post; on the X query it passes the on-topic ones", () => {
  const none = permalinkPicks(ON_TOPIC, prepareQuery(QUERY.ranking), { floor: RELEVANCE_FLOOR, collapsed: false, permalinked: new Set() });
  expect(none).toEqual([]);
  const basis = relevanceBasis(QUERY, "x");
  expect(basis).toBe("symbolic regression equation discovery from data");
  const picks = permalinkPicks(ON_TOPIC, prepareQuery(basis), { floor: RELEVANCE_FLOOR, collapsed: false, permalinked: new Set() });
  expect(picks.map((p) => p.permalink).sort()).toEqual([ON_TOPIC[0].permalink, ON_TOPIC[1].permalink]);
});

test("the alarm goes off at 90% zeros once enough posts are scored", () => {
  const scores = (zero: number, total: number) => [...Array(zero).fill(0), ...Array(total - zero).fill(0.3)];
  expect(relevanceCollapse(scores(COLLAPSE_MIN_POSTS - 1, COLLAPSE_MIN_POSTS - 1))).toBeNull();
  expect(relevanceCollapse(scores(54, 60))).toEqual({ posts: 60, zero: 54 });
  expect(relevanceCollapse(scores(53, 60))).toBeNull();
  // The shape of a healthy run (73% at 0, the X query as the basis) stays quiet.
  expect(relevanceCollapse(scores(223, 305))).toBeNull();
});

test("after the alarm, a line the floor passes nothing from opens its first cut-short posts in page order", () => {
  const off = Array.from({ length: 6 }, (_, i) => post(10 + i, `unrelated ${i}`, i !== 1));
  const query = prepareQuery("symbolic regression");
  expect(permalinkPicks(off, query, { floor: RELEVANCE_FLOOR, collapsed: false, permalinked: new Set() })).toEqual([]);
  const picks = permalinkPicks(off, query, { floor: RELEVANCE_FLOOR, collapsed: true, permalinked: new Set() });
  expect(picks.map((p) => p.permalink)).toEqual([off[0], off[2], off[3]].map((p) => p.permalink));
  expect(picks).toHaveLength(COLLAPSE_FALLBACK);
  // Pages already opened for the line count against the few.
  const again = permalinkPicks(off, query, { floor: RELEVANCE_FLOOR, collapsed: true, permalinked: new Set([off[0].id, off[2].id]) });
  expect(again.map((p) => p.permalink)).toEqual([off[3].permalink]);
  // A floor that passes something is kept to, alarm or not.
  const mixed = [...off, post(30, "symbolic regression at scale")];
  expect(permalinkPicks(mixed, query, { floor: RELEVANCE_FLOOR, collapsed: true, permalinked: new Set() }).map((p) => p.permalink)).toEqual([
    mixed[6].permalink,
  ]);
});

test("the alarm is in the progress file, the run's status line, the source health and background_status", () => {
  const collapse = { posts: 305, zero: 303 };
  const steps: XStep[] = [
    { kind: "start", order: ["ts-0000bbbb:q2"], n: 1, at: 0, activeMs: 0 },
    { kind: "relevance-collapse", ...collapse, n: 2, at: 1, activeMs: 0 },
    { kind: "end", status: "done", why: null, n: 3, at: 2, activeMs: 0 },
  ];
  expect(replay(steps).collapse).toEqual(collapse);
  expect(tallySteps(steps).line()).toContain(`warning: ${collapseNote(collapse)}`);

  const x: XReadResult = {
    status: "done",
    why: null,
    halt: null,
    posts: ON_TOPIC.map((p) => ({ line: "ts-0000bbbb:q2", post: p })),
    lines: [{ key: "ts-0000bbbb:q2", why: "bottom", screens: 3, kept: 3 }],
    pages: { search: 1, permalink: 3 },
    activeMs: 0,
    collapse,
  };
  const got = gatherCandidates(TOPIC, x, [], 0);
  const health = sourceHealth(TOPIC, "first", x, [], got.streams, [], 1000);
  expect(health.entries[0].note).toBe(collapseNote(collapse));
  expect(healthLines(health.entries, TOPIC)).toContain(`X warning: ${collapseNote(collapse)}.`);
  const folded = foldTopicSearchHealth({}, health, TOPIC);
  expect(Object.values(folded)[0].topicSearch?.note).toBe(collapseNote(collapse));

  const quiet = sourceHealth(TOPIC, "first", { ...x, collapse: null }, [], got.streams, [], 1000);
  expect(quiet.entries[0].note).toBeUndefined();
});
