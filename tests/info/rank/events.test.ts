// URL canonicalization, similarity, events and their clusters
// (src/info/rank/canonical-url.ts, similarity.ts, events.ts; docs/88 「打分」
// step 6). Run: bun test.

import { expect, test } from "bun:test";
import { canonicalizeUrl } from "../../../src/info/rank/canonical-url";
import { charNgrams, hybridSimilarity, wordJaccard } from "../../../src/info/rank/similarity";
import {
  arxivEventKey,
  clusterEvents,
  eventKeyOfUrl,
  groupEvents,
  mergeIntoEvents,
  xEventKey,
  type EventMember,
} from "../../../src/info/rank/events";

test("canonical URLs: lowercase host, no default port, fragment, trailing slash or trackers; sorted query", () => {
  expect(canonicalizeUrl("HTTPS://Example.COM:443/a/b/?utm_source=x&b=2&fbclid=z&a=1#frag")).toBe("https://example.com/a/b?a=1&b=2");
  expect(canonicalizeUrl("http://example.com:8080/")).toBe("http://example.com:8080/");
  expect(canonicalizeUrl("https://example.com")).toBe("https://example.com/");
  // X's share suffix is a tracker on X only.
  expect(canonicalizeUrl("https://x.com/a/status/123?s=20&t=abc")).toBe("https://x.com/a/status/123");
  expect(canonicalizeUrl("https://example.com/search?s=20&t=abc")).toBe("https://example.com/search?s=20&t=abc");
  expect(canonicalizeUrl("https://example.com/?q=a+b&q=a")).toBe("https://example.com/?q=a&q=a+b");
  expect(canonicalizeUrl("ftp://example.com/x")).toBeNull();
  expect(canonicalizeUrl("not a url")).toBeNull();
});

test("event keys name the paper, the repo, the post, or the canonical URL", () => {
  expect(eventKeyOfUrl("https://arxiv.org/pdf/2505.06708v2")).toBe("arxiv:2505.06708");
  expect(eventKeyOfUrl("https://www.alphaxiv.org/abs/2505.06708")).toBe("arxiv:2505.06708");
  expect(eventKeyOfUrl("https://github.com/OpenAI/Whisper/issues/12")).toBe("github:openai/whisper");
  expect(eventKeyOfUrl("https://twitter.com/someone/status/1585341984679469056?s=20")).toBe("x:1585341984679469056");
  expect(eventKeyOfUrl("https://Blog.example.com/post/?utm_medium=x")).toBe("url:https://blog.example.com/post");
  expect(eventKeyOfUrl("mailto:a@b.c")).toBeNull();
  expect(arxivEventKey("arXiv:2505.06708v3")).toBe("arxiv:2505.06708");
  expect(arxivEventKey("nope")).toBeNull();
  expect(xEventKey("42")).toBe("x:42");
});

test("similarity is the larger of trigram and word Jaccard", () => {
  expect(charNgrams("abcd")).toEqual(new Set(["abc", "bcd"]));
  expect(charNgrams("ab")).toEqual(new Set(["ab"]));
  expect(hybridSimilarity("same title here", "Same title, here!")).toBe(1);
  expect(hybridSimilarity("quantum chemistry", "weather forecast")).toBeLessThan(0.1);
  expect(wordJaccard("protein design model", "protein design")).toBeCloseTo(2 / 3, 9);
});

function m(id: string, kind: EventMember["kind"], key: string, score: number, text = id): EventMember {
  return { id, kind, key, score, text };
}

test("members of one key are one event: the best score plus 3 per extra post, at most 10", () => {
  const events = groupEvents([
    m("p1", "post", "arxiv:1", 60, "post one"),
    m("a", "paper", "arxiv:1", 50, "The paper's title"),
    m("p2", "post", "arxiv:1", 70, "post two"),
    m("p3", "post", "url:https://e.com/", 80),
  ]);
  expect(events.map((e) => e.key)).toEqual(["url:https://e.com/", "arxiv:1"]);
  const paper = events[1];
  expect(paper.score).toBe(73);
  expect(paper.posts).toBe(2);
  expect(paper.members.map((x) => x.id)).toEqual(["p2", "p1", "a"]);
  // The original's text stands for the event.
  expect(paper.text).toBe("The paper's title");
  expect(events[0].score).toBe(80);

  const many = groupEvents(["1", "2", "3", "4", "5"].map((i) => m(i, "post", "k", 50)));
  expect(many[0].score).toBe(60);
  // A paper alone gains nothing (and loses nothing).
  expect(groupEvents([m("a", "paper", "k", 50)])[0].score).toBe(50);
});

test("events cluster greedily around the best-scoring lead at 0.48", () => {
  const events = groupEvents([
    m("a", "post", "k1", 90, "OpenAI releases GPT-6 with a longer context window"),
    m("b", "post", "k2", 70, "OpenAI releases GPT-6 with longer context"),
    m("c", "post", "k3", 80, "AlphaFold 4 predicts protein complexes"),
  ]);
  const clusters = clusterEvents(events);
  expect(clusters.map((c) => c.lead.key)).toEqual(["k1", "k3"]);
  expect(clusters[0].events.map((e) => e.key)).toEqual(["k1", "k2"]);
  expect(clusters[0].score).toBe(90);
  // A threshold above their similarity keeps them apart.
  expect(clusterEvents(events, 0.99)).toHaveLength(3);
  expect(mergeIntoEvents(events.flatMap((e) => e.members)).map((c) => c.events.length)).toEqual([2, 1]);
});
