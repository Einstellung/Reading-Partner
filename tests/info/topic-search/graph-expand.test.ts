// The graph expansion's pure half (docs/info/92): positives and negatives,
// streams, ids, the window, exclusions, OpenAlex's related works, the cache.

import { describe, expect, test } from "bun:test";
import type { OpenAlexHit } from "../../../src/info/sources/plugins/openalex-client";
import type { S2Hit } from "../../../src/info/sources/plugins/s2-client";
import {
  CACHE_TTL_MS,
  cachedStream,
  chooseWalked,
  emptyGraphCache,
  excludedIds,
  filedPositives,
  foundFromOpenAlex,
  foundFromS2,
  keepPapers,
  MAX_WALKED,
  newestWorks,
  OPENALEX_LISTS_MAX,
  openAlexHandle,
  parseGraphCache,
  pickExamples,
  planStreams,
  pruneGraphCache,
  rankRelated,
  REC_KEEP,
  REC_POSITIVES,
  recCacheKey,
  S2_REQUESTS_MAX,
  s2Handle,
  sift,
  streamsToRetry,
  WALK_KEEP,
  walkedKeys,
  type GraphExample,
} from "../../../src/info/topic-search/graph-expand";
import { emptyGraphRead, type GraphPaper, type GraphRead, type GraphStream } from "../../../src/info/topic-search/graph-read";
import type { TopicLabel, TopicLabelKind } from "../../../src/info/topic-search/labels";
import type { TopicSeed } from "../../../src/info/topic-search/types";

const seed = (key: string, title = key): TopicSeed => ({ key, title, said: title, at: 1 });

let ids = 0;
const label = (item: string, kind: TopicLabelKind, at: number, title = item): TopicLabel => ({
  id: `tl-${String(++ids).padStart(8, "0")}`,
  searchId: "ts-0a1b2c3d",
  item,
  title,
  label: kind,
  reason: "",
  source: "question",
  evidence: "",
  at,
  brief: null,
  criteria: 1,
});

const paper = (arxivId: string, over: Partial<GraphPaper> = {}): GraphPaper => ({
  arxivId,
  title: `Paper ${arxivId}`,
  abstract: "",
  authors: [],
  publishedAt: "2026-05-01",
  citationCount: null,
  ...over,
});

describe("positives and negatives", () => {
  test("seeds first, then pinned, then yes, newest label first; borderline is neither; no is a negative", () => {
    const labels = [
      label("arxiv:2601.00001", "yes", 10),
      label("arxiv:2601.00002", "yes", 30),
      label("arxiv:2601.00003", "pinned", 20),
      label("arxiv:2601.00004", "borderline", 40),
      label("arxiv:2601.00005", "no", 50),
      label("arxiv:2601.00006", "no", 60),
      label("x:post-1", "yes", 70),
    ];
    const { positives, negatives } = pickExamples([seed("doi:10.1/a"), seed("arxiv:2512.00009")], labels);
    expect(positives.map((p) => [p.key, p.why])).toEqual([
      ["doi:10.1/a", "seed"],
      ["arxiv:2512.00009", "seed"],
      ["arxiv:2601.00003", "pinned"],
      ["arxiv:2601.00002", "yes"],
      ["arxiv:2601.00001", "yes"],
    ]);
    expect(negatives.map((n) => n.key)).toEqual(["arxiv:2601.00006", "arxiv:2601.00005"]);
  });

  test("the latest label rules: a seed labelled no is a negative, a yes later labelled no is not a positive", () => {
    const labels = [label("arxiv:2601.00001", "yes", 10), label("arxiv:2601.00001", "no", 20), label("arxiv:2512.00009", "no", 5)];
    const { positives, negatives } = pickExamples([seed("arxiv:2512.00009")], labels);
    expect(positives).toEqual([]);
    expect(negatives.map((n) => n.key)).toEqual(["arxiv:2601.00001", "arxiv:2512.00009"]);
  });

  test("no seeds and no labels: nothing to expand from", () => {
    expect(pickExamples([], [])).toEqual({ positives: [], negatives: [] });
  });
});

const examples = (n: number): GraphExample[] =>
  Array.from({ length: n }, (_, i) => ({ key: `arxiv:2601.${String(i + 1).padStart(5, "0")}`, title: `P${i + 1}`, why: "seed" as const }));

describe("which positives are walked", () => {
  test("a first look walks the first six", () => {
    expect([...chooseWalked(examples(9), { only: null, walkedBefore: null })!]).toEqual(examples(MAX_WALKED).map((p) => p.key));
  });

  test("an update walks only the positives no earlier run walked, and nothing when none is new", () => {
    const all = examples(8);
    const before = all.slice(0, 6).map((p) => p.key);
    expect([...chooseWalked(all, { only: null, walkedBefore: before })!]).toEqual([all[6].key, all[7].key]);
    expect(chooseWalked(all.slice(0, 6), { only: null, walkedBefore: before })).toBeNull();
  });

  test("a retry walks the positives its streams start from", () => {
    const all = examples(8);
    const walked = chooseWalked(all, { only: ["rec", `cites:${all[2].key}`, `refs:${all[7].key}`], walkedBefore: null })!;
    expect([...walked]).toEqual([all[2].key, all[7].key]);
  });

  test("the file keeps the recommendation positives and the walked ones; streams follow", () => {
    const all = examples(25);
    const filed = filedPositives(all, new Set([all[1].key, all[24].key]));
    expect(filed.length).toBe(REC_POSITIVES + 1);
    expect(filed.filter((p) => p.walked).map((p) => p.key)).toEqual([all[1].key, all[24].key]);
    const streams = planStreams(filed, null);
    expect(streams.map((s) => s.id)).toEqual(["rec", `cites:${all[1].key}`, `refs:${all[1].key}`, `cites:${all[24].key}`, `refs:${all[24].key}`]);
    expect(streams[0].from.length).toBe(REC_POSITIVES);
    expect(planStreams(filed, [`refs:${all[24].key}`]).map((s) => s.id)).toEqual([`refs:${all[24].key}`]);
  });

  test("the budget a read is held to", () => {
    expect(S2_REQUESTS_MAX).toBe(14);
    expect(OPENALEX_LISTS_MAX).toBe(18);
  });
});

describe("ids", () => {
  test("keys become S2 and OpenAlex handles", () => {
    expect(s2Handle("arxiv:2601.00001")).toBe("ARXIV:2601.00001");
    expect(s2Handle("doi:10.1038/x")).toBe("DOI:10.1038/x");
    expect(s2Handle("x:1")).toBeNull();
    expect(openAlexHandle("arxiv:2601.00001")).toBe("doi:10.48550/arXiv.2601.00001");
    expect(openAlexHandle("doi:10.1038/x")).toBe("doi:10.1038/x");
  });

  const s2 = (over: Partial<S2Hit>): S2Hit => ({
    title: "T",
    authors: [],
    year: 2026,
    doi: null,
    arxivId: null,
    pmid: null,
    paperId: "p",
    venue: null,
    url: null,
    abstract: "",
    citationCount: 3,
    ...over,
  });

  test("an S2 paper is pooled under its arXiv id, dated by the id's month; one with only a DOI is counted", () => {
    expect(foundFromS2(s2({ arxivId: "2609.01234v2", publicationDate: "2026-09-03" }))).toEqual({
      kind: "paper",
      paper: { arxivId: "2609.01234", title: "T", abstract: "", authors: [], publishedAt: "2026-09-03", citationCount: 3 },
    });
    // A journal date outside the id's month is not the arXiv day.
    expect(foundFromS2(s2({ arxivId: "2609.01234", publicationDate: "2027-02-01" }))).toMatchObject({ paper: { publishedAt: "2026-09-30" } });
    expect(foundFromS2(s2({ doi: "10.48550/arXiv.2610.00001" }))).toMatchObject({ kind: "paper", paper: { arxivId: "2610.00001", publishedAt: "2026-10-01" } });
    expect(foundFromS2(s2({ doi: "10.1101/x", publicationDate: "2026-09-10" }))).toEqual({ kind: "doi", title: "T", day: "2026-09-10" });
    expect(foundFromS2(s2({}))).toBeNull();
  });

  test("an OpenAlex work's date is never taken over the arXiv id's month (docs/pitfall/668)", () => {
    const hit: OpenAlexHit = {
      title: "Attention",
      authors: ["A"],
      year: 2025,
      doi: "https://doi.org/10.65215/2q58a426",
      arxivId: "1706.03762",
      openAlexId: "W1",
      venue: null,
      url: null,
      abstract: "The dominant",
      citedByCount: 9,
      publicationDate: "2025-08-23",
    };
    expect(foundFromOpenAlex(hit)).toMatchObject({ kind: "paper", paper: { arxivId: "1706.03762", publishedAt: "2017-06-30", citationCount: 9 } });
  });
});

describe("the window, exclusions and what a stream keeps", () => {
  test("sift keeps arXiv papers in the window once and counts dated-in or undated DOI-only titles", () => {
    const found = [
      { kind: "paper" as const, paper: paper("2601.00001", { publishedAt: "2026-01-05" }) },
      { kind: "paper" as const, paper: paper("2601.00001", { publishedAt: "2026-01-05" }) },
      { kind: "paper" as const, paper: paper("2401.00001", { publishedAt: "2024-01-05" }) },
      { kind: "doi" as const, title: "Journal A", day: "2026-03-01" },
      { kind: "doi" as const, title: "Journal B", day: "2020-03-01" },
      { kind: "doi" as const, title: "Journal C", day: null },
      null,
    ];
    const s = sift(found, "2025-10-22");
    expect(s.total).toBe(7);
    expect(s.papers.map((p) => p.arxivId)).toEqual(["2601.00001"]);
    expect(s.doiOnly).toEqual(["Journal A", "Journal C"]);
  });

  test("positives and papers labelled no are excluded; walks rank by citations then day; each kind is cut to its size", () => {
    const ex = excludedIds(
      { positives: [{ key: "arxiv:2601.00001", title: "", why: "seed" }, { key: "doi:10.1/a", title: "", why: "seed" }], negatives: [{ key: "arxiv:2601.00002", title: "" }] },
      ["2601.00009", null],
    );
    expect([...ex].sort()).toEqual(["2601.00001", "2601.00002", "2601.00009"]);
    const papers = [
      paper("2601.00001", { citationCount: 99 }),
      paper("2601.00003", { citationCount: 1, publishedAt: "2026-03-01" }),
      paper("2601.00004", { citationCount: 5 }),
      paper("2601.00005", { citationCount: 1, publishedAt: "2026-04-01" }),
    ];
    expect(keepPapers("cites", papers, ex, "2025-10-22").map((p) => p.arxivId)).toEqual(["2601.00004", "2601.00005", "2601.00003"]);
    expect(keepPapers("rec", papers, ex, "2025-10-22").map((p) => p.arxivId)).toEqual(["2601.00003", "2601.00004", "2601.00005"]);
    const many = Array.from({ length: 80 }, (_, i) => paper(`2602.${String(i).padStart(5, "0")}`));
    expect(keepPapers("rec", many, new Set(), "2025-10-22").length).toBe(REC_KEEP);
    expect(keepPapers("refs", many, new Set(), "2025-10-22").length).toBe(WALK_KEEP);
  });
});

describe("OpenAlex's related works", () => {
  test("ranked by how many positives share them, newer works first on a tie", () => {
    expect(rankRelated([["W10", "W20", "W30"], ["W20", "W5"], ["W20", "W30", "W30"]])).toEqual(["W20", "W30", "W10", "W5"]);
    expect(rankRelated([["W1", "W2", "W3"]], 2)).toEqual(["W3", "W2"]);
  });

  test("a bibliography is read from its newest works", () => {
    expect(newestWorks(["W2064675550", "W4406779522", "W2194775991"], 2)).toEqual(["W4406779522", "W2194775991"]);
  });
});

describe("across a study's runs", () => {
  const stream = (id: string, outcome: GraphStream["outcome"], at: string): GraphStream => ({
    id,
    kind: id === "rec" ? "rec" : (id.split(":")[0] as "cites" | "refs"),
    from: [],
    library: null,
    outcome,
    total: 0,
    papers: [],
    at,
  });
  const read = (streams: GraphStream[], walked: string[] = []): GraphRead => ({
    ...emptyGraphRead(
      walked.map((key) => ({ key, title: "", why: "seed", s2: null, openAlex: null, citationCount: null, walked: true })),
      [],
    ),
    streams,
  });

  test("a retry reads again the streams whose latest reading did not come back", () => {
    const first = read([
      stream("rec", "cooling_down", "2026-10-20T01:00:00.000Z"),
      stream("cites:arxiv:1", "rate_limited", "2026-10-20T01:00:01.000Z"),
      stream("refs:arxiv:1", "ok", "2026-10-20T01:00:02.000Z"),
      stream("cites:arxiv:2", "failed", "2026-10-20T01:00:03.000Z"),
    ]);
    const retry = read([stream("rec", "ok", "2026-10-21T01:00:00.000Z"), stream("cites:arxiv:2", "cooling_down", "2026-10-21T01:00:01.000Z")]);
    expect(streamsToRetry([first])).toEqual(["rec", "cites:arxiv:1", "cites:arxiv:2"]);
    expect(streamsToRetry([first, retry])).toEqual(["cites:arxiv:1", "cites:arxiv:2"]);
  });

  test("the positives some run walked", () => {
    expect(walkedKeys([read([], ["arxiv:1", "arxiv:2"]), read([], ["arxiv:2", "arxiv:3"])])).toEqual(["arxiv:1", "arxiv:2", "arxiv:3"]);
  });
});

describe("the cache", () => {
  const DAY = 86_400_000;
  const now = 100 * DAY;

  test("an entry stands for its life and for a window no earlier than the one it was sifted to", () => {
    const cache = emptyGraphCache();
    cache.streams["cites:arxiv:1"] = { library: "s2", since: "2025-10-20", total: 1, papers: [paper("2601.00001")], doiOnly: [], at: now - 2 * DAY };
    cache.streams["refs:arxiv:1"] = { library: "s2", since: "2025-10-20", total: 1, papers: [], doiOnly: [], at: now - 20 * DAY };
    expect(cachedStream(cache, "cites:arxiv:1", "2025-10-22", now)).not.toBeNull();
    expect(cachedStream(cache, "cites:arxiv:1", "2025-10-19", now)).toBeNull();
    expect(cachedStream(cache, "cites:arxiv:1", "2025-10-22", now + 2 * DAY)).toBeNull();
    expect(cachedStream(cache, "refs:arxiv:1", "2025-10-22", now)).not.toBeNull();
  });

  test("a write drops what has expired; a file that does not read is an empty cache", () => {
    const cache = emptyGraphCache();
    cache.ids.a = { s2: "x", arxivId: null, citationCount: null, at: now - CACHE_TTL_MS.ids };
    cache.ids.b = { s2: null, arxivId: null, citationCount: null, at: now - DAY };
    cache.streams["rec:00000000"] = { library: "s2", since: "2025-01-01", total: 0, papers: [], doiOnly: [], at: now - 4 * DAY };
    cache.abstracts["2601.00001"] = { text: "A", at: now };
    const pruned = pruneGraphCache(cache, now);
    expect(Object.keys(pruned.ids)).toEqual(["b"]);
    expect(pruned.streams).toEqual({});
    expect(parseGraphCache(JSON.stringify(pruned))).toEqual(pruned);
    expect(parseGraphCache("{not json")).toEqual(emptyGraphCache());
    expect(parseGraphCache(JSON.stringify({ version: 2 }))).toEqual(emptyGraphCache());
    expect(parseGraphCache(null)).toEqual(emptyGraphCache());
  });

  test("the recommendations' key is the two sets, in any order", () => {
    const key = recCacheKey(["arxiv:1", "arxiv:2"], ["arxiv:9"]);
    expect(key).toMatch(/^rec:[0-9a-f]{8}$/);
    expect(recCacheKey(["arxiv:2", "arxiv:1"], ["arxiv:9"])).toBe(key);
    expect(recCacheKey(["arxiv:1", "arxiv:2"], [])).not.toBe(key);
  });
});
