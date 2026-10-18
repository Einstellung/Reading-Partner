// A post points at its original, and the original is what gets read (docs/info/88
// 「看原文」, pitfall 657): the search page cuts most posts at about 275
// characters, so their links show only in the full text read off the permalink.
// Fake readers, fetches and clocks; every text invented; no network.

import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import type { LinkReader } from "../../../src/info/links/readers";
import type { XSearchPost } from "../../../src/info/x/search-page";
import { readOriginals, targetsOf, type Draft } from "../../../src/info/topic-search/build-result";
import { composePrompt, ITEM_MATERIAL_CHARS } from "../../../src/info/topic-search/compose";
import { openOriginal } from "../../../src/info/topic-search/open-link";
import type { TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { linksOut, readSource, type FetchText, type OpenLink, type SourceDeps } from "../../../src/info/topic-search/verify";

const signal = new AbortController().signal;
const PAPER = "2610.04242";

const POST: XSearchPost = {
  id: "1979000000000000001",
  handle: "quill_lab",
  name: "Quill Lab",
  text: "We built a solver that plans wet-lab runs on its own. A thread on what it does and what it does not do yet, with the numbers from our first",
  postedAt: Date.parse("2026-10-15T09:00:00Z"),
  shownAt: null,
  counts: { replies: 4, reposts: 12, likes: 80, bookmarks: null, views: 5000, quotes: null },
  links: [],
  truncated: true,
  article: false,
  quoted: null,
  permalink: "https://x.com/quill_lab/status/1979000000000000001",
};

const FULL_POST_HTML =
  "<p>We built a solver that plans wet-lab runs on its own. It ran 30 plates in a week.</p>" +
  `<p>Paper: https://arxiv.org/abs/${PAPER} and code: https://github.com/quill-lab/plate-planner</p>`;

const ARXIV_HTML =
  "<html><head><title>Plate Planner: Autonomous Wet-Lab Scheduling</title></head><body><article>" +
  "<h2>Abstract</h2><p>We schedule wet-lab plates with a planner.</p>" +
  `<h2>1 Introduction</h2><p>${"The planner books plates and reads results back. ".repeat(120)}</p>` +
  `<h2>2 Method</h2><p>${"Each plate gets a slot. ".repeat(200)}</p>` +
  "</article></body></html>";

function deps(over: { fetchText?: FetchText; openLink?: OpenLink; readPdfText?: SourceDeps["readPdfText"]; opened?: string[]; fetched?: string[] }): SourceDeps {
  return {
    fetchText: async (url, s) => {
      over.fetched?.push(url);
      return over.fetchText ? over.fetchText(url, s) : { status: 404, text: "" };
    },
    openLink: async (url, s) => {
      over.opened?.push(url);
      if (over.openLink) return over.openLink(url, s);
      return { ok: false, reason: "not here" };
    },
    lookupRepo: async () => ({ kind: "skipped", reason: "quota" }),
    repoQuotaLeft: () => null,
    ...(over.readPdfText ? { readPdfText: over.readPdfText } : {}),
  };
}

const fullPost: OpenLink = async (url) =>
  url === POST.permalink
    ? {
        ok: true,
        via: "x",
        title: null,
        author: "@quill_lab",
        publishedAt: null,
        sections: [{ heading: null, html: FULL_POST_HTML }],
        whole: null,
        links: [`https://arxiv.org/abs/${PAPER}`, "https://github.com/quill-lab/plate-planner", "https://quill.example/blog/plates"],
      }
    : { ok: false, reason: "not here" };

const registry = () => new MaterialRegistry("runs/t", { write: async () => {} });

test("a post with links only in its full text gets its paper read beside it; the post is still read", async () => {
  const opened: string[] = [];
  const fetched: string[] = [];
  // The export API is rate-limited; arxiv.org's HTML answers.
  const fetchText: FetchText = async (url) =>
    url.startsWith("https://export.arxiv.org/") ? { status: 429, text: "" } : url === `https://arxiv.org/html/${PAPER}` ? { status: 200, text: ARXIV_HTML } : { status: 404, text: "" };
  const reg = registry();
  const got = await readOriginals([{ kind: "post", post: POST }], deps({ fetchText, openLink: fullPost, opened, fetched }), reg, signal);
  expect(opened).toEqual([POST.permalink]);
  expect(got.materials.length).toBe(2);
  const [post, paper] = got.materials.map((id) => reg.get(id)!);
  expect(post.reader).toBe("x");
  expect(post.facts.text).toBe("whole");
  expect(paper.reader).toBe("arxiv");
  expect(paper.url).toBe(`https://arxiv.org/abs/${PAPER}`);
  // No metadata: the title is the HTML's, the HTML's own abstract stands in.
  expect(paper.title).toBe("Plate Planner: Autonomous Wet-Lab Scheduling");
  expect(reg.sections(paper.id)[0].heading).toBe("Abstract");
  expect(paper.facts.body).toBe("HTML");
  expect(got.original).toBe(`https://arxiv.org/abs/${PAPER}`);
  expect(got.first?.facts.kind).toBe("post");
  // Two originals per item: the repository and the blog are left.
  expect(fetched.some((u) => u.includes("github"))).toBe(false);
});

test("a repository link is taken before a page, and the post's own links are not read twice", async () => {
  const opened: string[] = [];
  const openLink: OpenLink = async (url) => {
    const base = await fullPost(url, signal);
    return base.ok ? { ...base, links: ["https://quill.example/blog/plates", "https://github.com/quill-lab/plate-planner"] } : base;
  };
  const fetchText: FetchText = async (url) =>
    url.includes("raw.githubusercontent.com/quill-lab/plate-planner/HEAD/README.md") ? { status: 200, text: "# Plate Planner\n\nSchedules plates." } : { status: 404, text: "" };
  const reg = registry();
  const got = await readOriginals([{ kind: "post", post: POST }], deps({ fetchText, openLink, opened }), reg, signal);
  expect(got.materials.map((id) => reg.get(id)!.reader)).toEqual(["x", "github"]);
  expect(got.original).toBe("https://github.com/quill-lab/plate-planner");
  expect(opened).toEqual([POST.permalink]);
});

test("when neither the arXiv API, the HTML nor the PDF answers, the paper is unread with each reason; the post stays", async () => {
  const fetchText: FetchText = async (url) => {
    if (url.startsWith("https://export.arxiv.org/")) throw new Error("export.arxiv.org is cooling down after a rate limit (9 min left); no request sent");
    return { status: 503, text: "" };
  };
  const reg = registry();
  const got = await readOriginals([{ kind: "post", post: POST }], deps({ fetchText, openLink: fullPost, readPdfText: async () => null }), reg, signal);
  expect(got.materials.length).toBe(1);
  expect(got.original).toBeNull();
  expect(got.reasons).toEqual([
    `arXiv ${PAPER} could not be read: the arXiv API: export.arxiv.org is cooling down after a rate limit (9 min left); no request sent; arXiv HTML answered HTTP 503; the PDF could not be read or has no text layer`,
  ]);
});

test("without arXiv HTML the paper's body comes from its PDF", async () => {
  const asked: string[] = [];
  const readPdfText = async (url: string) => (asked.push(url), `Plate Planner\n\n${"The planner books plates. ".repeat(100)}`);
  const got = await readSource({ kind: "paper", id: PAPER, known: null }, deps({ fetchText: async () => ({ status: 429, text: "" }), readPdfText }), signal);
  if (!got.ok) throw new Error(got.reason);
  expect(asked).toEqual([`https://arxiv.org/pdf/${PAPER}`]);
  expect(got.input.facts).toMatchObject({ depth: "head", body: "PDF" });
  expect(got.input.title).toBeNull();
});

test("an item led by a post also reads the paper its search-page links name", () => {
  const withLink = { ...POST, truncated: false };
  const member = { key: `x:${POST.id}`, mainUrl: null, cand: { post: withLink, paper: null, links: [{ url: `https://arxiv.org/abs/${PAPER}v2`, card: false }] } };
  const draft = { cluster: { events: [{ key: `x:${POST.id}`, members: [member] }] }, members: [member] } as unknown as Draft;
  expect(targetsOf(draft)).toEqual([
    { kind: "post", post: withLink },
    { kind: "paper", id: PAPER, known: null },
  ]);
});

test("links out leave out X, the link's own site and anything #1 did not find", () => {
  const candidates = [
    { url: POST.permalink, from: null },
    { url: `https://arxiv.org/abs/${PAPER}`, from: 1 },
    { url: "https://x.com/someone/status/1979000000000000002", from: 1 },
    { url: "https://quill.example/about", from: 1 },
    { url: "https://elsewhere.example/far", from: 3 },
  ];
  expect(linksOut(candidates, POST.permalink)).toEqual([`https://arxiv.org/abs/${PAPER}`, "https://quill.example/about"]);
  expect(linksOut(candidates, "https://www.quill.example/post")).toEqual([`https://arxiv.org/abs/${PAPER}`]);
});

const fakeX = (html: string): LinkReader => ({
  name: "x",
  claims: (url) => url.startsWith("https://x.com/"),
  read: async (url) => ({
    ok: true,
    receipt: "a long post by @quill_lab",
    lines: [],
    record: { key: "x:1", source: "x", data: {} },
    candidates: [
      { url, material: { kind: "html", html, title: "We built a solver", author: "@quill_lab", publishedAt: "2026-10-15T09:00:00Z", sourceUrl: url }, origin: "body", self: true },
      { url: `https://arxiv.org/abs/${PAPER}`, origin: "body" },
      { url: "https://x.com/quill_lab/status/1979000000000000003", origin: "self-reply" },
    ],
    notes: [],
  }),
});

test("the open route hands back a post's expanded links, and a failed page keeps its message", async () => {
  const fetch = async (url: string) => ({ ok: false, status: 503, bytes: new Uint8Array(), contentType: null, url });
  const post = await openOriginal(POST.permalink, { fetch, readers: [fakeX(FULL_POST_HTML)] });
  if (!post.ok) throw new Error(post.reason);
  expect(post.via).toBe("x");
  expect(post.links).toEqual([`https://arxiv.org/abs/${PAPER}`]);
  const page = await openOriginal("https://quill.example/blog/plates", { fetch, readers: [] });
  expect(page).toEqual({ ok: false, reason: "quill.example answered HTTP 503" });
});

test("a one-section X material takes the item's whole budget, less a share for the original after it", async () => {
  const reg = registry();
  const long = `${"The solver plans plates. ".repeat(200)}Repo at the end.`;
  const xm = await reg.register({ url: POST.permalink, title: null, author: "@quill_lab", publishedAt: null, reader: "x", facts: { text: "whole" }, sections: [{ heading: null, text: long }] });
  const item = (materials: string[]): TopicSearchResultItem => ({
    id: "E1", key: `x:${POST.id}`, keys: [], kind: "post", subtopic: null, title: "We built a solver", titleFrom: "post", summary: null, body: [], unknown: null,
    facts: { kind: "post", handle: "quill_lab", name: "Quill Lab", postedAt: POST.postedAt, counts: { likes: 80, reposts: 12, replies: 4, quotes: null, views: 5000 } },
    links: { original: null, posts: [] }, materials,
    verify: { status: "self", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } }, continuing: null, score: 50,
  });
  const topic = { id: "ts-1", name: "Labs", concernId: null, scope: "", subtopics: [], want: [], avoid: [], judgments: [], anchors: [], queries: [], answers: [], status: "active", revision: 1, createdAt: 0, lastRunAt: null } as TopicSearch;
  const shown = (items: TopicSearchResultItem[]) => {
    const user = composePrompt({ topic, kind: "daily", items, registry: reg, profile: [], questions: [], language: "" }).user;
    return /M1\.§1[^:]*: ([^\n]*)/.exec(user)?.[1] ?? "";
  };
  const alone = shown([item([xm.id])]);
  expect(alone.length).toBeGreaterThan(1200);
  expect(alone.length).toBeLessThanOrEqual(ITEM_MATERIAL_CHARS + 1);
  const paper = await reg.register({ url: `https://arxiv.org/abs/${PAPER}`, title: "Plate Planner", author: null, publishedAt: null, reader: "arxiv", facts: { arxivId: PAPER, depth: "abstract" }, sections: [{ heading: "Abstract", text: "We schedule plates." }] });
  const beside = shown([item([xm.id, paper.id])]);
  expect(beside.length).toBeLessThanOrEqual(1201);
});
