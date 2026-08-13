// Keeping a briefing article (src/ui/components/info/use-info-home.ts): what is
// written, and — the rule this exists for — when nothing is. Over ports, so no
// topic store and no saved-article file are touched. Run: bun test.

import { expect, test } from "bun:test";
import {
  keepBriefingArticle,
  type KeepArticlePorts,
} from "../../../src/ui/components/info/use-info-home";
import type { ArticleState } from "../../../src/info/briefing/reader";
import type { BriefingItemMeta } from "../../../src/info/briefing/types";
import type { SavedArticle, SavedArticleInput } from "../../../src/reading/saved-articles";

const META: BriefingItemMeta = {
  title: "A paper",
  url: "https://example.com/a",
  source: "s1",
  sourceName: "Example",
  publishedAt: "2026-07-25",
};

const BODY: ArticleState = {
  kind: "body",
  body: { html: "<p>the article</p>", text: "the article", summaryOnly: false },
};

function ports(read?: ArticleState) {
  const saved: SavedArticleInput[] = [];
  const reads: string[] = [];
  let topics = 0;
  const p: KeepArticlePorts & {
    saved: SavedArticleInput[];
    reads: string[];
    topics: () => number;
  } = {
    saved,
    reads,
    topics: () => topics,
    article: async (id) => {
      reads.push(id);
      return read;
    },
    ensureTopic: async () => {
      topics += 1;
      return { id: "brief" };
    },
    save: async (input) => {
      saved.push(input);
      return { id: "https://example.com/a", ...input } as unknown as SavedArticle;
    },
  };
  return p;
}

test("an article with a body is filed under the Brief topic with its snapshot", async () => {
  const p = ports();
  expect(await keepBriefingArticle("x", META, BODY, p)).toBe("https://example.com/a");
  expect(p.saved).toEqual([
    {
      topicId: "brief",
      url: META.url,
      title: META.title,
      source: META.source,
      sourceName: META.sourceName,
      publishedAt: META.publishedAt,
      summaryOnly: false,
      text: "the article",
      html: "<p>the article</p>",
    },
  ]);
});

// Keeping an item without a body would write an empty snapshot over the
// full-text record the collector saved under the same id (docs/36).
test("keepArticle refuses to write when the state is not a body", async () => {
  const states: ArticleState[] = [
    { kind: "pending" },
    { kind: "filtered", category: "vendor PR" },
    { kind: "summaryOnly" },
    { kind: "unknown" },
  ];
  for (const state of states) {
    const p = ports();
    expect(await keepBriefingArticle("x", META, state, p)).toBe(null);
    expect(p.saved).toEqual([]);
    expect(p.topics()).toBe(0);
  }
});

// The screen may not have read the body yet — the Save button is on the article
// view, which can be showing while the read is still in flight.
test("with nothing on screen the body is read first, and the same rule applies", async () => {
  const withBody = ports(BODY);
  expect(await keepBriefingArticle("x", META, null, withBody)).toBe("https://example.com/a");
  expect(withBody.reads).toEqual(["x"]);

  const withNone = ports({ kind: "summaryOnly" });
  expect(await keepBriefingArticle("x", META, null, withNone)).toBe(null);
  expect(withNone.saved).toEqual([]);

  const withNothing = ports(undefined);
  expect(await keepBriefingArticle("x", META, null, withNothing)).toBe(null);
  expect(withNothing.saved).toEqual([]);
});

test("an item the briefing does not carry is not read and not written", async () => {
  const p = ports(BODY);
  expect(await keepBriefingArticle("x", undefined, null, p)).toBe(null);
  expect(p.reads).toEqual([]);
  expect(p.saved).toEqual([]);
});

// An article whose URL and title are both empty has no identity to file it
// under, and the store answers with null rather than inventing one.
test("a save the store refused reports nothing kept", async () => {
  const p = ports();
  p.save = async () => null;
  expect(await keepBriefingArticle("x", META, BODY, p)).toBe(null);
});
