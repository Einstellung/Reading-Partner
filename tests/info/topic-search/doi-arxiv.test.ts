// A DOI link is the arXiv paper it names when the run holds the mapping or a
// lookup finds it (src/info/topic-search/doi-arxiv.ts; docs/info/88 「看原文」):
// scored as a paper, one event with the arXiv candidate, read through arXiv.
// Fake lookups and fetches; every id invented; no network.

import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import type { InfoItem } from "../../../src/info/sources/item";
import { parseArxivAtom } from "../../../src/info/sources/plugins/arxiv-client";
import { parseS2ArxivId, s2DoiUrl } from "../../../src/info/sources/plugins/s2-client";
import { readOriginals, targetsOf, type Draft } from "../../../src/info/topic-search/build-result";
import { doiArxiv, heldDois, poolDois, type DoiLookup } from "../../../src/info/topic-search/doi-arxiv";
import { numberPool, rankEvents, scorePool, type ArxivFound, type Candidate, type RerankAnswer } from "../../../src/info/topic-search/rank-pool";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import type { FetchText, SourceDeps } from "../../../src/info/topic-search/verify";
import type { XSearchPost } from "../../../src/info/x/search-page";

const signal = new AbortController().signal;
const DOI = "10.1103/physrevx.16.041001";
const DOI_URL = "https://doi.org/10.1103/PhysRevX.16.041001";
const PAPER = "2609.30111";

const topic = {
  id: "ts-1",
  name: "Qubits",
  concernId: null,
  scope: "",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [{ id: "q1", subtopic: null, x: "qubits", arxiv: null, ranking: "", weight: 1 }],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
} as unknown as TopicSearch;

function postCand(id: string, links: string[]): Candidate {
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
    engagement: 2,
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

const item = (id: string, doi?: string): InfoItem => ({
  id,
  source: "arxiv",
  sourceName: "arXiv",
  sourceKey: id,
  title: id,
  url: `https://arxiv.org/abs/${id}`,
  publishedAt: "",
  ...(doi ? { doi } : {}),
});

/** A counting fake lookup over a fixed table; a DOI marked "throw" fails. */
function fakeLookup(table: Record<string, string | null | "throw">): { lookup: DoiLookup; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    lookup: async (doi) => {
      asked.push(doi);
      const v = table[doi];
      if (v === "throw") throw new Error("api.semanticscholar.org is cooling down after a rate limit (9 min left); no request sent");
      return v ?? null;
    },
  };
}

test("the arXiv entry's <arxiv:doi> is kept, and an arXiv find carrying a DOI maps it", () => {
  const xml = `<feed><entry><id>http://arxiv.org/abs/${PAPER}v1</id><title>T</title><summary>S</summary>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1103/PhysRevX.16.041001</arxiv:doi></entry>
    <entry><id>http://arxiv.org/abs/2609.30112v1</id><title>U</title><summary>S</summary></entry></feed>`;
  const [a, b] = parseArxivAtom(xml);
  expect(a.doi).toBe("10.1103/PhysRevX.16.041001");
  expect(b.doi).toBeUndefined();
  const found: ArxivFound[] = [{ query: "q", items: [item(PAPER, "10.1103/PhysRevX.16.041001"), item("2609.30112")], error: null }];
  expect([...heldDois(found)]).toEqual([[DOI, PAPER]]);
});

test("Semantic Scholar's DOI route and the arXiv id in its answer", () => {
  expect(s2DoiUrl("10.1000/a(b)<c>")).toBe("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1000/a(b)%3Cc%3E?fields=externalIds");
  expect(parseS2ArxivId({ paperId: "093e", externalIds: { ArXiv: "1602.03837", DOI: "10.1103/PhysRevLett.116.061102", CorpusId: 1 } })).toBe("1602.03837");
  expect(parseS2ArxivId({ paperId: "093e", externalIds: { DOI: "10.1038/x" } })).toBeNull();
  expect(parseS2ArxivId({ error: "not found" })).toBeNull();
});

test("the pool's DOIs: each once, arXiv's own DOI left out (it is keyed as arXiv already)", () => {
  const numbered = numberPool([
    { cand: postCand("1", [DOI_URL, "https://doi.org/10.48550/arXiv.2609.30113", "https://example.com/a"]), rrf: 50 },
    { cand: postCand("2", ["https://journals.aps.org/prx/abstract/10.1103/PhysRevX.16.041001"]), rrf: 40 },
  ]);
  expect(poolDois(numbered)).toEqual([DOI]);
});

test("what the run holds answers without a lookup; the lookup is asked once per DOI, misses and failures included", async () => {
  const { lookup, asked } = fakeLookup({ "10.1038/found": "2609.30114v2", "10.1038/none": null, "10.1038/fails": "throw" });
  const dois = doiArxiv(new Map([[DOI, PAPER]]), lookup);
  expect(await dois.resolve(DOI, signal)).toBe(PAPER);
  // Two at once share the one request.
  const [a, b] = await Promise.all([dois.resolve("10.1038/found", signal), dois.resolve("10.1038/found", signal)]);
  expect([a, b]).toEqual(["2609.30114", "2609.30114"]);
  expect(await dois.resolve("10.1038/none", signal)).toBeNull();
  expect(await dois.resolve("10.1038/fails", signal)).toBeNull();
  for (const d of ["10.1038/found", "10.1038/none", "10.1038/fails"]) await dois.resolve(d, signal);
  expect(asked).toEqual(["10.1038/found", "10.1038/none", "10.1038/fails"]);
  expect(dois.known("10.1038/found")).toBe("2609.30114");
  expect(dois.known("10.1038/none")).toBeNull();
  expect(dois.keyOfUrl("https://doi.org/10.1038/found")).toBe("arxiv:2609.30114");
  expect(dois.keyOfUrl("https://doi.org/10.1038/none")).toBe("doi:10.1038/none");
  expect(dois.keyOfUrl("https://github.com/o/r")).toBe("github:o/r");
});

test("a stopped run's lookup throws and is not kept", async () => {
  const ac = new AbortController();
  let calls = 0;
  const dois = doiArxiv(new Map(), async () => {
    calls++;
    ac.abort();
    throw new DOMException("aborted", "AbortError");
  });
  expect(await dois.resolve("10.1038/x", ac.signal).catch((e: Error) => e.name)).toBe("AbortError");
  await dois.resolve("10.1038/x", signal);
  expect(calls).toBe(2);
});

test("without a lookup, a DOI the run does not hold stays a DOI", async () => {
  const dois = doiArxiv(new Map(), null);
  expect(await dois.resolve(DOI, signal)).toBeNull();
  expect(dois.keyOfUrl(DOI_URL)).toBe(`doi:${DOI}`);
});

test("a post whose main is a DOI of an arXiv paper scores as the paper and is one event with it", async () => {
  const numbered = numberPool([
    { cand: paperCand(PAPER), rrf: 40 },
    { cand: postCand("1", [DOI_URL]), rrf: 50 },
  ]);
  const answers = new Map([
    ["c1", answer(60)],
    ["c2", answer(80, "c2.a")],
  ]);
  // Unmapped: the post's own event, scored as a post.
  const plain = scorePool(topic, numbered, answers);
  expect(plain[1].key).toBe(`doi:${DOI}`);
  expect(rankEvents(plain).flatMap((c) => c.events)).toHaveLength(2);

  const { lookup } = fakeLookup({ [DOI]: PAPER });
  const dois = doiArxiv(new Map(), lookup);
  for (const d of poolDois(numbered)) await dois.resolve(d, signal);
  const scored = scorePool(topic, numbered, answers, dois.keyOfUrl);
  expect(scored[1].key).toBe(`arxiv:${PAPER}`);
  expect(scored[1].score).toBeCloseTo(0.8 * 80 + 0.2 * 50, 9);
  const clusters = rankEvents(scored);
  expect(clusters).toHaveLength(1);
  expect(clusters[0].events).toHaveLength(1);
  expect(clusters[0].events[0].key).toBe(`arxiv:${PAPER}`);
  expect(clusters[0].events[0].members.map((m) => m.cand.key)).toEqual(["x:1", `arxiv:${PAPER}`]);
});

test("an item's targets name a mapped DOI link as its arXiv paper, once", () => {
  const member = (key: string, over: Record<string, unknown>) => ({ key, mainUrl: null, cand: { post: null, paper: null, links: [], ...over } });
  const post = member("x:1", {
    post: postCand("1", []).post,
    links: [
      { url: DOI_URL, card: false },
      { url: `https://arxiv.org/abs/${PAPER}`, card: false },
    ],
  });
  const draft = { cluster: { events: [{ key: "x:1", members: [post] }] }, members: [post] } as unknown as Draft;
  const dois = doiArxiv(new Map([[DOI, PAPER]]), null);
  expect(targetsOf(draft).filter((t) => t.kind !== "post")).toEqual([
    { kind: "paper", id: PAPER, known: null },
    { kind: "page", url: DOI_URL },
  ]);
  expect(targetsOf(draft, dois.keyOfUrl).filter((t) => t.kind !== "post")).toEqual([{ kind: "paper", id: PAPER, known: null }]);
});

test("a DOI page found while reading is read through arXiv when its paper is found, and as its page when not", async () => {
  const opened: string[] = [];
  const fetched: string[] = [];
  const fetchText: FetchText = async (url) => {
    fetched.push(url);
    return { status: 404, text: "" };
  };
  const deps = (arxivIdOfDoi?: SourceDeps["arxivIdOfDoi"]): SourceDeps => ({
    fetchText,
    openLink: async (url) => {
      opened.push(url);
      return { ok: false, code: "not_found", reason: "not here" };
    },
    lookupRepo: async () => ({ kind: "skipped", reason: "quota" }),
    repoQuotaLeft: () => null,
    ...(arxivIdOfDoi ? { arxivIdOfDoi } : {}),
  });
  const registry = () => new MaterialRegistry("runs/t", { write: async () => {} });
  const got = await readOriginals([{ kind: "page", url: DOI_URL }], deps(async () => PAPER), registry(), signal);
  expect(got.traces.map((t) => t.url)).toEqual([`https://arxiv.org/abs/${PAPER}`]);
  expect(opened).toEqual([]);
  expect(fetched.some((u) => u.includes(PAPER))).toBe(true);

  const miss = await readOriginals([{ kind: "page", url: DOI_URL }], deps(async () => null), registry(), signal);
  expect(miss.traces.map((t) => t.url)).toEqual([DOI_URL]);
  expect(opened).toEqual([DOI_URL]);
});
