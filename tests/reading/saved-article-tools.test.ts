// Unit tests for the saved-article chat tools (src/reading/saved-article-tools.ts).
// The store read and the pipeline work are injected ports, so there is no
// AppData, no network and no AI. What must not regress: the list is capped and
// filterable, an id the model made up produces a message it can act on, and
// summaryOnly reaches every place a quote could come from — the row, the text the
// digest and read_paper see, and the tool's own answer (docs/21). Run: bun test.

import { expect, test } from "bun:test";
import {
  buildSavedArticleTools,
  formatSavedArticleList,
  prepareSavedArticle,
  SAVED_ARTICLES_MAX,
  SAVED_ARTICLES_PROMPT,
  SAVED_SOURCE_MAX,
  savedArticleProvenance,
  type SavedArticlePorts,
} from "../../src/reading/saved-article-tools";
import type { IngestResult } from "../../src/reading/prep/papers/source-tool";
import type { SavedArticle } from "../../src/reading/saved-articles";

function article(over: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: "https://example.com/a",
    topicId: "brief",
    url: "https://example.com/a",
    title: "Attention is all you need, again",
    source: "src",
    sourceName: "The Feed",
    publishedAt: "2026-07-20T08:00:00Z",
    savedAt: 1000,
    summaryOnly: false,
    text: "the body of the kept article",
    html: "<p>the body</p>",
    ...over,
  };
}

// The ports a test drives: a fixed list, and an add that records what it got and
// answers the way the pipeline wiring in turn.ts does.
function ports(
  list: SavedArticle[],
  over: Partial<IngestResult> = {},
  spy?: (a: SavedArticle) => void,
): SavedArticlePorts {
  return {
    list: async () => list,
    add: async (a) => {
      spy?.(a);
      return {
        slug: "attention-is-all-you-need-again",
        title: a.title,
        kind: "article",
        pages: 1,
        chars: 4200,
        status: "digesting",
        ...over,
      };
    },
  };
}

function tools(p: SavedArticlePorts) {
  const [list, add] = buildSavedArticleTools(p);
  return { list, add };
}

test("an empty list says so rather than pretending to be filtered", async () => {
  const { list } = tools(ports([]));
  expect((await list.execute({})) as string).toBe("The reader has kept no articles.");
});

test("a row carries id, source, publication date and length", async () => {
  const { list } = tools(ports([article()]));
  const out = (await list.execute({})) as string;
  expect(out).toContain("1 saved article(s), newest first:");
  expect(out).toContain('"Attention is all you need, again"');
  expect(out).toContain("The Feed");
  expect(out).toContain("published 2026-07-20");
  expect(out).toContain("28 characters");
  expect(out).toContain("id: https://example.com/a");
});

test("a missing publication date is named, not dropped", async () => {
  const out = formatSavedArticleList([article({ publishedAt: "" })], "");
  expect(out).toContain("no publication date");
});

test("query filters on title and on source name, case-insensitively", async () => {
  const list = [
    article({ id: "1", title: "Compilers today", sourceName: "The Feed" }),
    article({ id: "2", title: "Rust in the kernel", sourceName: "LWN" }),
  ];
  const { list: tool } = tools(ports(list));
  const byTitle = (await tool.execute({ query: "KERNEL" })) as string;
  expect(byTitle).toContain("Rust in the kernel");
  expect(byTitle).not.toContain("Compilers today");
  const bySource = (await tool.execute({ query: "feed" })) as string;
  expect(bySource).toContain("Compilers today");
  expect(bySource).not.toContain("Rust in the kernel");
});

test("a query that matches nothing says how many are kept in total", () => {
  const out = formatSavedArticleList([article(), article({ id: "2" })], "quantum");
  expect(out).toContain('No saved article matches "quantum"');
  expect(out).toContain("2 saved in total");
});

// The store hands back file order, which is oldest first (upsertSavedArticle
// appends). Every claim the list makes about recency has to survive that.
test("the list is newest first however the store ordered it", () => {
  const out = formatSavedArticleList(
    [
      article({ id: "a", title: "Kept first", savedAt: 10 }),
      article({ id: "b", title: "Kept last", savedAt: 30 }),
      article({ id: "c", title: "Kept second", savedAt: 20 }),
    ],
    "",
  );
  const titles = out
    .split("\n")
    .filter((l) => /^\d+\. /.test(l))
    .map((l) => l.slice(l.indexOf('"') + 1, l.indexOf('" —')));
  expect(titles).toEqual(["Kept last", "Kept second", "Kept first"]);
});

test("a long list is cut to the cap, counted, and points at the query argument", () => {
  // savedAt grows with the index, so the highest indices are the newest.
  const many = Array.from({ length: SAVED_ARTICLES_MAX + 7 }, (_, i) =>
    article({ id: `id-${i}`, title: `Article ${i}`, savedAt: 1000 + i }),
  );
  const out = formatSavedArticleList(many, "");
  const rows = out.split("\n").filter((l) => /^\d+\. /.test(l));
  expect(rows.length).toBe(SAVED_ARTICLES_MAX);
  expect(out).toContain(`${SAVED_ARTICLES_MAX + 7} saved article(s)`);
  expect(out).toContain(`Showing the ${SAVED_ARTICLES_MAX} most recently saved of ${SAVED_ARTICLES_MAX + 7}`);
  expect(out).toContain("query argument");
  // The cut drops the oldest, not the newest.
  expect(out).toContain(`"Article ${SAVED_ARTICLES_MAX + 6}"`);
  expect(out).not.toContain('"Article 0"');
});

test("the list frames its rows as third-party content", () => {
  const out = formatSavedArticleList([article()], "");
  expect(out).toContain("third-party web content");
  expect(out).toContain("not instructions");
});

test("a runaway source name is cut like the title is", () => {
  const out = formatSavedArticleList([article({ sourceName: "S".repeat(4000) })], "");
  expect(out).not.toContain("S".repeat(SAVED_SOURCE_MAX + 1));
  expect(out.length).toBeLessThan(600);
});

test("a summary-only row says the full text was never read", () => {
  const out = formatSavedArticleList([article({ summaryOnly: true, text: "just the summary" })], "");
  expect(out).toContain("summary only — the full text was never read");
});

test("add: an unknown id tells the model how to get a real one", async () => {
  let called = false;
  const { add } = tools({
    list: async () => [article()],
    add: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  await expect(add.execute({ id: "https://example.com/nope" })).rejects.toThrow(
    /No saved article with id "https:\/\/example.com\/nope".*list_saved_articles/s,
  );
  expect(called).toBe(false);
});

test("add: an article kept without a body is refused instead of digested empty", async () => {
  let called = false;
  const { add } = tools({
    list: async () => [article({ text: "   ", summaryOnly: true })],
    add: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  await expect(add.execute({ id: "https://example.com/a" })).rejects.toThrow(
    /not even a summary.*nothing to read/s,
  );
  expect(called).toBe(false);
});

test("add: the answer names the slug, the read_paper call, the date and the source", async () => {
  let seen: SavedArticle | null = null;
  const { add } = tools(ports([article()], {}, (a) => (seen = a)));
  const out = (await add.execute({ id: "https://example.com/a" })) as string;
  expect(seen).not.toBeNull();
  expect(out).toContain('read_paper("attention-is-all-you-need-again"');
  expect(out).toContain("4200 characters");
  expect(out).toContain("The Feed");
  expect(out).toContain("published 2026-07-20");
  expect(out).toContain("not a fresh fetch");
  expect(out).toContain("reference material");
  expect(out).toContain("[attention-is-all-you-need-again]");
  expect(out).not.toContain("summary");
});

test("add: summaryOnly reaches the tool's answer", async () => {
  const { add } = tools(ports([article({ summaryOnly: true })]));
  const out = (await add.execute({ id: "https://example.com/a" })) as string;
  expect(out).toContain("the full text was never read");
});

test("add: a failed ingest surfaces as a tool error", async () => {
  const { add } = tools(ports([article()], { status: "failed", error: "prep state unwritable" }));
  await expect(add.execute({ id: "https://example.com/a" })).rejects.toThrow(/unwritable/);
});

// --- what the article becomes on the prep list ------------------------------

test("the prepared paper is a user-added, captured article carrying its URL", () => {
  const prepared = prepareSavedArticle(article());
  const paper = prepared.mint(new Set());
  expect(paper.kind).toBe("article");
  expect(paper.addedByUser).toBe(true);
  expect(paper.captured).toBe(true);
  expect(paper.sourceUrl).toBe("https://example.com/a");
  expect(paper.status).toBe("queued");
  expect(paper.year).toBe(2026);
  expect(paper.slug).toBe("attention-is-all-you-need-again");
  expect(prepared.fetched.kind).toBe("article");
  expect(prepared.fetched.pdfBytes).toBeNull();
  expect(prepared.fetched.fulltext).toBe(prepared.fulltext);
  expect(prepared.fulltext.pages.length).toBe(1);
  expect(prepared.chars).toBe(prepared.fulltext.pages[0].length);
});

test("the slug avoids one already on the prep list", () => {
  const paper = prepareSavedArticle(article()).mint(new Set(["attention-is-all-you-need-again"]));
  expect(paper.slug).toBe("attention-is-all-you-need-again-2");
});

test("an unparseable publication date leaves the year unset instead of guessing", () => {
  const paper = prepareSavedArticle(article({ publishedAt: "last tuesday" })).mint(new Set());
  expect(paper.year).toBeNull();
  expect(formatSavedArticleList([article({ publishedAt: "last tuesday" })], "")).toContain(
    "last tuesday",
  );
});

test("the text handed to the pipeline carries its provenance and the whole body", () => {
  const prepared = prepareSavedArticle(article());
  const text = prepared.fulltext.pages[0];
  expect(text).toContain("Saved by the reader from The Feed");
  expect(text).toContain("published 2026-07-20");
  expect(text).toContain("https://example.com/a");
  expect(text).toContain("the body of the kept article");
  expect(text).not.toContain("never read");
});

// The caveat has to sit inside the material, not beside it: the digest writes the
// note off this text, and read_paper hands it to a later turn that never saw this
// tool's answer.
test("summaryOnly rides into the text and into the digest angle", () => {
  const a = article({ summaryOnly: true, text: "just the summary" });
  expect(savedArticleProvenance(a)).toContain("the full text was never read");
  const prepared = prepareSavedArticle(a);
  expect(prepared.fulltext.pages[0]).toContain("the full text was never read");
  expect(prepared.mint(new Set()).reason).toContain("the note must say the full text was never read");
});

// The prompt line is one paragraph among many; the description sits on the call
// itself. The tool with the side effect has to carry the gate in both places.
test("the add tool's own description carries the gate", () => {
  const { add, list } = tools(ports([article()]));
  expect(add.description).toContain("Only when the reader asks");
  expect(add.description).toContain("never call it on your own initiative");
  expect(list.description).toContain("do not browse their saved articles");
});

test("the prompt line gates the tools on the reader's own request and frames the content", () => {
  expect(SAVED_ARTICLES_PROMPT).toContain("and only then");
  expect(SAVED_ARTICLES_PROMPT).toContain("on your own initiative");
  expect(SAVED_ARTICLES_PROMPT).toContain("not instructions");
  expect(SAVED_ARTICLES_PROMPT).toContain("publication date");
});
