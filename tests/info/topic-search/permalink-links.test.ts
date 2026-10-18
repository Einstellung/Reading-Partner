// The links in a post's full text (pitfall 657, the permalink case): the X
// reader opens a cut-short post's permalink page, and the links out its own text
// and card carry there — t.co ones and ones the text only names — are kept with
// the post and its progress step, so the build reads the paper and the
// repository beside the post. Also: why only the card's text was read, and
// arXiv headings without their footnotes. Fake sessions, fetches and clocks;
// every text invented; no network.

import { describe, expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import type { BrowseEval, BrowseLoad, BrowseOpen, BrowseSession } from "../../../src/workshop/extract/webview-browse";
import { PERMALINK_SCRIPT } from "../../../src/info/x/permalink";
import { PAGE_CHROME_SCRIPT, SEARCH_PAGE_SCRIPT, type XSearchPost } from "../../../src/info/x/search-page";
import { linksInText, postLinksOut } from "../../../src/info/x/text-links";
import { readOriginals } from "../../../src/info/topic-search/build-result";
import { gatherCandidates } from "../../../src/info/topic-search/rank-pool";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { readSource, type FetchText, type OpenLink, type SourceDeps } from "../../../src/info/topic-search/verify";
import { readXSearch, type XReadDeps, type XReadInput, type XReadResult } from "../../../src/info/topic-search/x-reader";
import { X_PACE } from "../../../src/info/topic-search/x-pace";
import { replay, type XStep } from "../../../src/info/topic-search/x-progress";

const signal = new AbortController().signal;
const EPOCH = 1288834974657n;
const NOW = Date.parse("2026-10-14T02:00:00Z");
const ID = String(((BigInt(NOW - 3_600_000) - EPOCH) << 22n) + 7n);
const QUOTED_ID = String(((BigInt(NOW - 9_000_000) - EPOCH) << 22n) + 3n);
const PAPER = "2611.04321";
const PERMALINK = `https://x.com/plate_lab/status/${ID}`;

/** The search card: the first 275 characters or so, no links in the part shown. */
function card() {
  const ms = Number((BigInt(ID) >> 22n) + EPOCH);
  return {
    path: `/plate_lab/status/${ID}`,
    datetime: new Date(Math.floor(ms / 1000) * 1000).toISOString(),
    userName: "Plate Lab@plate_lab·1h",
    text: "Our planner for wet-lab plates is out, with an agent that picks the next protein design to test",
    showMore: true,
    article: false,
    counts: { reply: "3 Replies. Reply", retweet: "9 reposts. Repost", like: "40 Likes. Like", bookmark: "Bookmark", views: "900 views. View post analytics" },
    links: [],
    quote: null,
    top: 100,
    bottom: 400,
    chars: 300,
  };
}

/**
 * The permalink page, signed out: no testids, the post's own article first. Its
 * text spells the paper's t.co link out with X's hidden part and an ellipsis;
 * the repository's t.co link shows only its start, so it is expanded; the blog
 * is a short link the text names with no link under it; the quoted post's link
 * belongs to the quoted post.
 */
const PAGE = {
  url: PERMALINK,
  title: "",
  posts: [
    {
      anchors: [
        { href: "https://x.com/plate_lab", path: "/plate_lab", text: "Plate Lab", quoted: false },
        { href: PERMALINK, path: `/plate_lab/status/${ID}`, text: "", quoted: false },
        { href: "https://t.co/paperAAAA", path: "https://t.co/paperAAAA", text: `https://arxiv.org/abs/${PAPER}…`, quoted: false },
        { href: "https://t.co/codeBBBBB", path: "https://t.co/codeBBBBB", text: "github.com/plate-lab/pla…", quoted: false },
        { href: "https://x.com/hashtag/proteins", path: "/hashtag/proteins", text: "#proteins", quoted: false },
        { href: `https://x.com/other_lab/status/${QUOTED_ID}`, path: `/other_lab/status/${QUOTED_ID}`, text: "", quoted: true },
        { href: "https://t.co/quoteCCCC", path: "https://t.co/quoteCCCC", text: "https://elsewhere.example/q", quoted: true },
      ],
      images: [],
      videos: 0,
      text: [
        "Plate Lab",
        "@plate_lab",
        "Our planner for wet-lab plates is out, with an agent that picks the next protein design to test, and books the plates for it.",
        `Paper: https://arxiv.org/abs/${PAPER}… Code: github.com/plate-lab/pla…`,
        "Blog: goo.gle/plates42 #proteins",
        "2:03 AM · Oct 14, 2026",
        "12",
        "Views",
      ].join("\n"),
    },
  ],
};

function session(navigations: string[]): BrowseSession {
  const load = (url: string): BrowseLoad => ({ status: "ok", url, title: null, loaded: true, value: true, error: null, elapsedMs: 900, detail: null });
  const ev = (value: unknown): BrowseEval => ({ status: "ok", url: null, title: null, value, error: null, elapsedMs: 5, detail: null });
  return {
    id: 1,
    navigate: async (url) => (navigations.push(url), load(url)),
    back: async () => load(""),
    evaluate: async (script) => {
      if (script === SEARCH_PAGE_SCRIPT) {
        return ev({ path: "/search", href: "https://x.com/search", textChars: 5000, viewport: 2000, scrollY: 0, height: 9000, loginWall: false, chrome: "Search", posts: [card()] });
      }
      if (script === PAGE_CHROME_SCRIPT) return ev({ path: `/plate_lab/status/${ID}`, chrome: "Post", loginWall: false });
      if (script === PERMALINK_SCRIPT) return ev(PAGE);
      return ev({ availWidth: 2560, availHeight: 2560 });
    },
    scrollBy: async () => ({ status: "ok", before: 0, after: 0, height: 9000, viewport: 2000, detail: null }),
    close: async () => true,
  };
}

function reader(steps: XStep[], expanded: string[]) {
  let now = NOW;
  const navigations: string[] = [];
  const deps: XReadDeps = {
    open: async (): Promise<BrowseOpen> => ({ status: "ok", session: session(navigations) }),
    progress: { load: async () => [...steps], append: async (s) => void steps.push(s) },
    memory: { load: async () => ({ marks: {}, daily: null }), save: async () => {} },
    expandLink: async (tco) => (expanded.push(tco), tco === "https://t.co/codeBBBBB" ? "https://github.com/plate-lab/plate-planner" : null),
    onHalt: async () => {},
    sleep: async (ms) => void (now += ms),
    now: () => now,
    random: () => 0.5,
  };
  return { deps, navigations };
}

const INPUT: XReadInput = {
  lines: [{ key: "ts-1:q1", query: "protein design", order: "live", relevance: "protein design" }],
  limits: { posts: 400, searchPages: 30, permalinkPages: 40, activeMs: 150 * 60_000 },
  pace: { ...X_PACE, segments: [1, 1], segmentMs: [600 * 60_000, 600 * 60_000] },
};

const READ_LINKS = [
  { tco: "https://t.co/paperAAAA", url: `https://arxiv.org/abs/${PAPER}`, card: false },
  { tco: "https://t.co/codeBBBBB", url: "https://github.com/plate-lab/plate-planner", card: false },
];

// Fails on the code before this change: the permalink read kept only the text,
// so `links` stayed [] and nothing was expanded.
test("a post opened at its permalink keeps the links out of its own text and card, t.co ones expanded", async () => {
  const steps: XStep[] = [];
  const expanded: string[] = [];
  const { deps, navigations } = reader(steps, expanded);
  const result = await readXSearch(INPUT, deps);
  expect(navigations[1]).toBe(PERMALINK);
  const post = result.posts[0].post;
  expect(post.truncated).toBe(false);
  expect(post.text).toContain("books the plates for it");
  expect(post.links).toEqual(READ_LINKS);
  // The spelled-out one needs no request; the quoted post's link is not this post's.
  expect(expanded).toEqual(["https://t.co/codeBBBBB"]);
  const step = steps.find((s) => s.kind === "permalink") as Extract<XStep, { kind: "permalink" }>;
  expect(step.links?.map((l) => l.tco)).toEqual(["https://t.co/paperAAAA", "https://t.co/codeBBBBB"]);
  // The text's own short link comes on top of the page's links.
  expect(postLinksOut(post).map((l) => l.url)).toEqual([
    `https://arxiv.org/abs/${PAPER}`,
    "https://github.com/plate-lab/plate-planner",
    "https://goo.gle/plates42",
  ]);
});

describe("picking up a run", () => {
  test("a run read again from its progress file keeps the permalink page's links, expansions included", async () => {
    const steps: XStep[] = [];
    await readXSearch(INPUT, reader(steps, []).deps);
    expect(replay(steps).posts.get(ID)!.post.links).toEqual(READ_LINKS);
    // Cut off right after the permalink step: the next call expands what is left and opens nothing again.
    const cut = steps.slice(0, steps.findIndex((s) => s.kind === "permalink") + 1);
    const expanded: string[] = [];
    const again = reader(cut, expanded);
    const result = await readXSearch(INPUT, again.deps);
    expect(again.navigations).toEqual([]);
    expect(expanded).toEqual(["https://t.co/codeBBBBB"]);
    expect(result.posts[0].post.links).toEqual(READ_LINKS);
  });

  test("a progress file written before the links were kept still loads: the whole text, the card's links", () => {
    const steps: XStep[] = [];
    const post = { ...(card() as unknown as XSearchPost), id: ID, handle: "plate_lab", links: [], truncated: true };
    steps.push({ n: 1, at: NOW, activeMs: 0, kind: "read", line: "ts-1:q1", screen: 0, ids: [ID], fresh: [post], dropped: 0, textChars: 0, scrollY: 0, height: 0 });
    // An old line: no `links` field.
    steps.push(JSON.parse(JSON.stringify({ n: 2, at: NOW, activeMs: 0, kind: "permalink", line: "ts-1:q1", id: ID, status: "ok", text: "The whole text." })) as XStep);
    const back = replay(steps).posts.get(ID)!.post;
    expect(back.text).toBe("The whole text.");
    expect(back.truncated).toBe(false);
    expect(back.links).toEqual([]);
  });
});

const ARXIV_HTML =
  "<html><head><title>Plate Planner</title></head><body><article>" +
  "<h2>Abstract</h2><p>We schedule wet-lab plates with a planner.</p>" +
  `<h2>1 Introduction<span class="ltx_note ltx_role_thanks"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content">Funded by grant 4471-B; doi 10.5555/plates.2026.17.</span></span></span></h2>` +
  `<p>${"The planner books plates and reads results back. ".repeat(200)}</p>` +
  "</article></body></html>";

function sourceDeps(log: { fetched: string[]; opened: string[] }, openLink?: OpenLink): SourceDeps {
  const fetchText: FetchText = async (url) => {
    log.fetched.push(url);
    if (url === `https://arxiv.org/html/${PAPER}`) return { status: 200, text: ARXIV_HTML };
    if (url.includes("raw.githubusercontent.com/plate-lab/plate-planner/HEAD/README.md")) return { status: 200, text: "# Plate Planner\n\nBooks plates." };
    return { status: 404, text: "" };
  };
  return {
    fetchText,
    openLink: async (url, s) => {
      log.opened.push(url);
      return openLink ? openLink(url, s) : { ok: false, code: "not_found", reason: "not here" };
    },
    lookupRepo: async () => ({ kind: "skipped", reason: "quota" }),
    repoQuotaLeft: () => null,
  };
}

const reg = () => new MaterialRegistry("runs/t", { write: async () => {} });

describe("the build reads what the post points at", () => {
  test("from the reader's x-read.json to the item: the post, then the paper and the repository; the blog waits", async () => {
    const steps: XStep[] = [];
    const read: XReadResult = JSON.parse(JSON.stringify(await readXSearch(INPUT, reader(steps, []).deps)));
    const topic = { id: "ts-1", anchors: [], queries: [{ id: "q1", subtopic: null, x: "protein design", arxiv: null, ranking: "", weight: 1 }] } as unknown as TopicSearch;
    const cand = gatherCandidates(topic, read, [], 0).all[0];
    expect(cand.links.map((l) => l.url)).toEqual([`https://arxiv.org/abs/${PAPER}`, "https://github.com/plate-lab/plate-planner", "https://goo.gle/plates42"]);
    const log = { fetched: [] as string[], opened: [] as string[] };
    const registry = reg();
    // The post was read whole at its permalink: build does not open it again.
    const got = await readOriginals([{ kind: "post", post: cand.post! }], sourceDeps(log), registry, signal);
    expect(log.opened).toEqual([]);
    expect(got.materials.map((id) => registry.get(id)!.reader)).toEqual(["x", "arxiv", "github"]);
    expect(got.original).toBe(`https://arxiv.org/abs/${PAPER}`);
  });

  test("an old post whose links are only in its text: the paper is read, then a short link through the page route", async () => {
    const post: XSearchPost = {
      ...(card() as unknown as XSearchPost),
      id: ID,
      handle: "plate_lab",
      name: "Plate Lab",
      postedAt: NOW,
      shownAt: null,
      counts: { replies: 3, reposts: 9, likes: 40, bookmarks: null, views: 900, quotes: null },
      text: `Our planner is out. Paper: arxiv ${PAPER} and the story →https://goo.gle/plates42`,
      links: [],
      truncated: false,
      article: false,
      quoted: null,
      permalink: PERMALINK,
    };
    const log = { fetched: [] as string[], opened: [] as string[] };
    const got = await readOriginals([{ kind: "post", post }], sourceDeps(log), reg(), signal);
    expect(log.fetched).toContain(`https://arxiv.org/html/${PAPER}`);
    expect(log.opened).toEqual(["https://goo.gle/plates42"]);
    expect(got.reasons).toEqual(["not here"]);
  });
});

test("a cut-short post whose page cannot be opened says why only its card's text was used", async () => {
  const post: XSearchPost = {
    ...(card() as unknown as XSearchPost),
    id: ID,
    handle: "plate_lab",
    name: "Plate Lab",
    postedAt: NOW,
    shownAt: null,
    counts: { replies: 3, reposts: 9, likes: 40, bookmarks: null, views: 900, quotes: null },
    links: [],
    truncated: true,
    article: false,
    quoted: null,
    permalink: PERMALINK,
  };
  const why = "its full text is only on the post's page, which this device cannot read (the desktop app can)";
  const log = { fetched: [] as string[], opened: [] as string[] };
  const got = await readOriginals([{ kind: "post", post }], sourceDeps(log, async () => ({ ok: false, code: "unsupported", reason: why })), reg(), signal);
  expect(got.materials.length).toBe(1);
  expect(got.reasons).toEqual([`only the start of the post the search page showed was read: ${why}`]);
  expect(got.traces[0]).toMatchObject({ url: PERMALINK, outcome: "partial", steps: [{ step: "post", ok: false, code: "unsupported", detail: why }] });
});

test("an arXiv section heading comes without its footnote", async () => {
  const log = { fetched: [] as string[], opened: [] as string[] };
  const got = await readSource({ kind: "paper", id: PAPER, known: null }, sourceDeps(log), signal);
  if (!got.ok) throw new Error(got.reason);
  expect(got.input.sections.map((s) => s.heading)).toEqual(["Abstract", "1 Introduction"]);
});

describe("links a text names", () => {
  test("spelled out, a bare arXiv id, a bare repository and short link; punctuation and ellipses off; each once", () => {
    const text =
      `Paper:https://arxiv.org/abs/${PAPER}… (see also arXiv:${PAPER}v2). ` +
      "Code at github.com/plate-lab/plate-planner, blog goo.gle/plates42. Mail me@github.com/x. " +
      "Docs: https://plates.example/docs/(v2) and https://plates.example/start.";
    expect(linksInText(text)).toEqual([
      `https://arxiv.org/abs/${PAPER}`,
      "https://github.com/plate-lab/plate-planner",
      "https://goo.gle/plates42",
      "https://plates.example/docs/(v2)",
      "https://plates.example/start",
    ]);
  });
});
