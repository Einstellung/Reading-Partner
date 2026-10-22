// A study's graph expansion against scripted S2, OpenAlex and arXiv answers
// (docs/info/92): what it asks, what each stream keeps, the fallbacks, the
// abstracts, the cache, a resume, an update and a retry. No network.

import { describe, expect, test } from "bun:test";
import { HostCoolingDownError } from "../../../src/platform/http/host-gate";
import { readGraphExpansion, type GraphLiveDeps, type GraphReadPlan } from "../../../src/info/topic-search/graph-live";
import { parseGraphCache } from "../../../src/info/topic-search/graph-expand";
import type { GraphRead } from "../../../src/info/topic-search/graph-read";
import type { TopicLabel, TopicLabelKind } from "../../../src/info/topic-search/labels";
import type { TopicSeed } from "../../../src/info/topic-search/types";

const NOW = Date.UTC(2026, 9, 22, 6);
const PLAN: GraphReadPlan = { since: "2025-10-22", only: null, walkedBefore: null };

const A = "2603.00001";
const Y = "2604.00002";
const N = "2605.00003";
const D_ARXIV = "2509.00004";

const SEEDS: TopicSeed[] = [
  { key: `arxiv:${A}`, title: "Seed A", said: "seed a", at: 1 },
  { key: "doi:10.1/d", title: "Seed D", said: "seed d", at: 1 },
];

const label = (item: string, kind: TopicLabelKind, title: string): TopicLabel => ({
  id: `tl-${item.slice(-8)}`,
  searchId: "ts-0a1b2c3d",
  item,
  title,
  label: kind,
  reason: "",
  source: "question",
  evidence: "",
  at: 10,
  brief: null,
  criteria: 1,
});
const LABELS = [label(`arxiv:${Y}`, "yes", "Paper Y"), label(`arxiv:${N}`, "no", "Paper N")];

type S2P = Record<string, unknown>;
const s2p = (paperId: string, title: string, over: S2P = {}): S2P => ({
  paperId,
  title,
  abstract: null,
  year: 2026,
  publicationDate: null,
  citationCount: 0,
  authors: [{ name: "An Author" }],
  externalIds: {},
  ...over,
});
const arxiv = (id: string, title: string, over: S2P = {}) => s2p(`s-${id}`, title, { externalIds: { ArXiv: id }, ...over });

const BATCH: Record<string, S2P | null> = {
  [`ARXIV:${A}`]: arxiv(A, "Seed A", { paperId: "sA", citationCount: 50 }),
  "DOI:10.1/d": s2p("sD", "Seed D", { externalIds: { DOI: "10.1/d", ArXiv: D_ARXIV }, citationCount: 5000 }),
  [`ARXIV:${Y}`]: arxiv(Y, "Paper Y", { paperId: "sY", citationCount: 10 }),
  [`ARXIV:${N}`]: arxiv(N, "Paper N", { paperId: "sN" }),
};

const REC = [
  arxiv("2609.00011", "Rec one", { publicationDate: "2026-09-03" }),
  s2p("j1", "Journal rec", { externalIds: { DOI: "10.1016/j.rec" }, publicationDate: "2026-09-10" }),
  arxiv("2301.00012", "An old one"),
  arxiv(N, "Paper N"),
  arxiv(Y, "Paper Y"),
  arxiv(D_ARXIV, "Seed D preprint"),
];

const EDGES: Record<string, { key: "citingPaper" | "citedPaper"; data: S2P[] | null }> = {
  "sA/citations": {
    key: "citingPaper",
    data: [
      arxiv("2607.00021", "Cite one", { abstract: "c1", citationCount: 2 }),
      arxiv("2608.00022", "Cite two", { citationCount: 7 }),
      s2p("j2", "Journal cite", { externalIds: { DOI: "10.1016/j.cite" } }),
    ],
  },
  "sA/references": { key: "citedPaper", data: [arxiv("1706.03762", "Attention"), arxiv("2511.00031", "Ref one", { abstract: "f1", citationCount: 40 })] },
  "sY/citations": { key: "citingPaper", data: [arxiv("2607.00021", "Cite one", { abstract: "c1", citationCount: 2 })] },
  // Withheld by the publisher (docs/pitfall/73): OpenAlex is asked.
  "sY/references": { key: "citedPaper", data: null },
  "sD/references": { key: "citedPaper", data: [] },
};

const oaWork = (id: string, title: string, arxivId: string | null, over: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/${id}`,
  display_name: title,
  publication_date: "2026-01-01",
  cited_by_count: 1,
  locations: arxivId ? [{ landing_page_url: `http://arxiv.org/abs/${arxivId}` }] : [],
  ...over,
});

const OA_WORKS: Record<string, unknown> = {
  [`doi:10.48550/arXiv.${Y}`]: oaWork("W4400000002", "Paper Y", Y, {
    referenced_works: ["https://openalex.org/W2000000001", "https://openalex.org/W4400000100"],
    related_works: ["https://openalex.org/W2000000001"],
  }),
};

const OA_BY_ID: Record<string, unknown> = {
  W4400000100: oaWork("W4400000100", "Ref from OpenAlex", "2512.00041", { abstract_inverted_index: { Found: [0], there: [1] } }),
  W2000000001: oaWork("W2000000001", "Old classic", "1512.03385"),
};

// The abstract lookup by arXiv DOI: one work is another paper the arXiv copy was merged into (docs/pitfall/668).
const OA_BY_ARXIV: Record<string, unknown> = {
  "2609.00011": oaWork("W4400000200", "Something else entirely", "2609.00011", { abstract_inverted_index: { Wrong: [0] } }),
  "2608.00022": oaWork("W4400000201", "Cite two", "2608.00022", { abstract_inverted_index: { Second: [0], abstract: [1] } }),
};

const atom = (entries: { id: string; summary: string }[]) =>
  `<feed>${entries.map((e) => `<entry><id>http://arxiv.org/abs/${e.id}v1</id><title>T</title><summary>${e.summary}</summary></entry>`).join("")}</feed>`;
const ARXIV_SUMMARIES: Record<string, string> = { "2609.00011": "Rec one's abstract from arXiv." };

type Fail = "s2-cooling" | "s2-refused" | "oa-refused";

function world(opts: { fail?: Fail[] } = {}) {
  const asked: string[] = [];
  const fail = new Set(opts.fail ?? []);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    asked.push(`${u.hostname}${u.pathname}${u.searchParams.get("filter") ? `?${u.searchParams.get("filter")!.split(":")[0]}` : ""}`);
    if (u.hostname === "api.semanticscholar.org") {
      if (fail.has("s2-cooling")) throw new HostCoolingDownError("api.semanticscholar.org/graph", NOW + 60_000, NOW);
      if (fail.has("s2-refused")) throw new HostCoolingDownError("api.semanticscholar.org/graph", NOW + 60_000, NOW, true);
      if (u.pathname === "/graph/v1/paper/batch") {
        const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
        return json(ids.map((id) => BATCH[id] ?? null));
      }
      if (u.pathname.startsWith("/recommendations/")) return json({ recommendedPapers: REC });
      const m = /^\/graph\/v1\/paper\/(.+)\/(citations|references)$/.exec(u.pathname);
      const edges = m ? EDGES[`${decodeURIComponent(m[1])}/${m[2]}`] : undefined;
      if (!edges) return json({ error: "Paper not found" }, 404);
      return json({ data: edges.data === null ? null : edges.data.map((p) => ({ [edges.key]: p })) });
    }
    if (u.hostname === "api.openalex.org") {
      if (fail.has("oa-refused")) throw new HostCoolingDownError("api.openalex.org/works+graph", NOW + 60_000, NOW, true);
      const filter = u.searchParams.get("filter") ?? "";
      if (u.pathname.startsWith("/works/")) {
        const work = OA_WORKS[decodeURIComponent(u.pathname.slice("/works/".length))];
        return work ? json(work) : json({ error: "not found" }, 404);
      }
      const pick = (table: Record<string, unknown>, keys: string[]) => keys.map((k) => table[k]).filter(Boolean);
      if (filter.startsWith("openalex_id:")) return json({ meta: { count: 0 }, results: pick(OA_BY_ID, filter.slice(12).split(",")[0].split("|")) });
      if (filter.startsWith("doi:")) {
        const ids = filter.slice(4).split("|").map((d) => d.replace("10.48550/arxiv.", ""));
        return json({ meta: { count: 0 }, results: pick(OA_BY_ARXIV, ids) });
      }
      if (filter.startsWith("cites:")) return json({ meta: { count: 0 }, results: [] });
      return json({ error: "unscripted" }, 400);
    }
    if (u.hostname === "export.arxiv.org") {
      const ids = (u.searchParams.get("id_list") ?? "").split(",");
      return new Response(atom(ids.filter((id) => ARXIV_SUMMARIES[id]).map((id) => ({ id, summary: ARXIV_SUMMARIES[id] }))), { status: 200 });
    }
    throw new Error(`unscripted ${url}`);
  };
  const files = new Map<string, GraphRead>();
  let cacheText: string | null = null;
  const writes: GraphRead[] = [];
  const deps = (dir: string): GraphLiveDeps => ({
    fetchFn,
    load: async () => files.get(dir) ?? null,
    save: async (read) => {
      files.set(dir, read);
      writes.push(read);
    },
    cache: { load: async () => cacheText, save: async (text) => void (cacheText = text) },
    now: () => NOW,
  });
  const read = (dir: string, plan: GraphReadPlan = PLAN, labels = LABELS, seeds = SEEDS) =>
    readGraphExpansion({ seeds, labels }, plan, deps(dir), new AbortController().signal);
  const count = (host: string) => asked.filter((a) => a.startsWith(host)).length;
  return { asked, files, writes, read, count, cache: () => parseGraphCache(cacheText), clear: () => (asked.length = 0) };
}

const streamOf = (read: GraphRead, id: string) => read.streams.find((s) => s.id === id)!;
const ids = (read: GraphRead, id: string) => streamOf(read, id).papers.map((p) => p.arxivId);

describe("a first look with S2 answering", () => {
  const w = world();
  let read: GraphRead;

  test("one batch, the recommendations and a walk each way from every walked positive; a hub's citations are not asked", async () => {
    read = (await w.read("run-1"))!;
    expect(read.positives.map((p) => [p.key, p.why, p.s2, p.citationCount, p.walked])).toEqual([
      [`arxiv:${A}`, "seed", "sA", 50, true],
      ["doi:10.1/d", "seed", "sD", 5000, true],
      [`arxiv:${Y}`, "yes", "sY", 10, true],
    ]);
    expect(read.negatives).toEqual([`arxiv:${N}`]);
    expect(read.streams.map((s) => [s.id, s.library, s.outcome])).toEqual([
      ["rec", "s2", "ok"],
      [`cites:arxiv:${A}`, "s2", "ok"],
      [`refs:arxiv:${A}`, "s2", "ok"],
      ["cites:doi:10.1/d", null, "hub"],
      ["refs:doi:10.1/d", "s2", "empty"],
      [`cites:arxiv:${Y}`, "s2", "ok"],
      [`refs:arxiv:${Y}`, "openalex", "ok"],
    ]);
    // batch, rec, 2 cites, 3 refs
    expect(w.count("api.semanticscholar.org")).toBe(7);
    expect(w.asked.filter((a) => a.startsWith("api.semanticscholar.org/graph/v1/paper/batch"))).toHaveLength(1);
  });

  test("streams keep in-window arXiv papers, never a positive or a paper labelled no, and count the DOI-only ones", () => {
    expect(ids(read, "rec")).toEqual(["2609.00011"]);
    expect(streamOf(read, "rec").total).toBe(REC.length);
    expect(ids(read, `cites:arxiv:${A}`)).toEqual(["2608.00022", "2607.00021"]);
    expect(ids(read, `refs:arxiv:${A}`)).toEqual(["2511.00031"]);
    expect(ids(read, `cites:arxiv:${Y}`)).toEqual(["2607.00021"]);
    expect(ids(read, `refs:arxiv:${Y}`)).toEqual(["2512.00041"]);
    expect(streamOf(read, `refs:arxiv:${Y}`).total).toBe(2);
    expect(read.doiOnly).toEqual({ count: 2, titles: ["Journal rec", "Journal cite"] });
    expect(read.positives.find((p) => p.key === `arxiv:${Y}`)!.openAlex).toBe("W4400000002");
  });

  test("dates come from the arXiv id; abstracts S2 left out come from OpenAlex when the title matches, else from arXiv", () => {
    const rec = streamOf(read, "rec").papers[0];
    expect(rec.publishedAt).toBe("2026-09-03");
    expect(rec.abstract).toBe("Rec one's abstract from arXiv.");
    expect(streamOf(read, `cites:arxiv:${A}`).papers[0].abstract).toBe("Second abstract");
    expect(streamOf(read, `refs:arxiv:${Y}`).papers[0].abstract).toBe("Found there");
    expect(w.count("export.arxiv.org")).toBe(1);
    // The lookup by id, the bibliography, the abstracts.
    expect(w.count("api.openalex.org")).toBe(3);
  });

  test("written after the batch and after every stream; what came back is in the cache", () => {
    expect(w.writes.length).toBeGreaterThanOrEqual(1 + read.streams.length);
    expect(w.writes[0].streams).toEqual([]);
    const cache = w.cache();
    expect(Object.keys(cache.ids).sort()).toEqual([`arxiv:${A}`, `arxiv:${Y}`, `arxiv:${N}`, "doi:10.1/d"]);
    expect(cache.ids["doi:10.1/d"].arxivId).toBe(D_ARXIV);
    expect(Object.keys(cache.streams).filter((k) => !k.startsWith("rec:")).sort()).toEqual(
      [`cites:arxiv:${A}`, `cites:arxiv:${Y}`, `refs:arxiv:${A}`, `refs:arxiv:${Y}`, "refs:doi:10.1/d"].sort(),
    );
    expect(cache.abstracts["2609.00011"].text).toBe("Rec one's abstract from arXiv.");
  });

  test("another run inside the cache's life asks nothing and keeps the same papers", async () => {
    w.clear();
    const again = (await w.read("run-2"))!;
    expect(w.asked).toEqual([]);
    expect(again.streams.map((s) => [s.id, s.outcome, s.papers.map((p) => [p.arxivId, p.abstract])])).toEqual(
      read.streams.map((s) => [s.id, s.outcome, s.papers.map((p) => [p.arxivId, p.abstract])]),
    );
  });

  test("a resumed read asks only for the streams not on file, by the S2 ids on file", async () => {
    // Nothing cached: the ids come from the file.
    const fresh = world();
    fresh.files.set("run-3", { ...read, streams: read.streams.slice(0, 3) });
    const resumed = (await fresh.read("run-3"))!;
    expect(fresh.asked.filter((a) => a.startsWith("api.semanticscholar.org"))).toEqual([
      "api.semanticscholar.org/graph/v1/paper/sD/references",
      "api.semanticscholar.org/graph/v1/paper/sY/citations",
      "api.semanticscholar.org/graph/v1/paper/sY/references",
    ]);
    expect(resumed.streams.map((s) => [s.id, s.outcome])).toEqual(read.streams.map((s) => [s.id, s.outcome]));
  });
});

describe("S2 not answering", () => {
  test("cooling down: nothing is sent to S2, OpenAlex reads what it knows, the rest waits for a retry", async () => {
    const w = world({ fail: ["s2-cooling"] });
    const read = (await w.read("run-1"))!;
    expect(read.positives.every((p) => p.s2 === null)).toBe(true);
    expect(read.streams.map((s) => [s.id, s.library, s.outcome])).toEqual([
      // Y's related works are old (docs/pitfall/669): answered, and empty.
      ["rec", "openalex", "empty"],
      [`cites:arxiv:${A}`, null, "cooling_down"],
      [`refs:arxiv:${A}`, null, "cooling_down"],
      ["cites:doi:10.1/d", null, "cooling_down"],
      ["refs:doi:10.1/d", null, "cooling_down"],
      [`cites:arxiv:${Y}`, "openalex", "empty"],
      [`refs:arxiv:${Y}`, "openalex", "ok"],
    ]);
    // The positives' lookups, the related works, Y's citations and references.
    expect(w.count("api.openalex.org")).toBe(3 + 1 + 2);
  });

  test("a rate limit on both: every stream is on file to be read again", async () => {
    const w = world({ fail: ["s2-refused", "oa-refused"] });
    const read = (await w.read("run-1"))!;
    // No citation count came back, so no positive is known to be a hub.
    expect(read.streams.map((s) => s.outcome)).toEqual(Array(7).fill("rate_limited"));
  });
});

describe("an update and a retry", () => {
  test("an update with no new positive reads nothing and writes nothing", async () => {
    const w = world();
    const got = await w.read("run-u", { ...PLAN, walkedBefore: [`arxiv:${A}`, "doi:10.1/d", `arxiv:${Y}`] });
    expect(got).toBeNull();
    expect(w.asked).toEqual([]);
    expect(w.files.size).toBe(0);
  });

  test("an update walks only the new positive, beside the recommendations", async () => {
    const w = world();
    const read = (await w.read("run-u", { ...PLAN, walkedBefore: [`arxiv:${A}`, "doi:10.1/d"] }))!;
    expect(read.positives.filter((p) => p.walked).map((p) => p.key)).toEqual([`arxiv:${Y}`]);
    expect(read.streams.map((s) => s.id)).toEqual(["rec", `cites:arxiv:${Y}`, `refs:arxiv:${Y}`]);
  });

  test("a retry reads only the streams it names", async () => {
    const w = world();
    const read = (await w.read("run-r", { ...PLAN, only: [`refs:arxiv:${A}`] }))!;
    expect(read.streams.map((s) => s.id)).toEqual([`refs:arxiv:${A}`]);
    expect(w.asked.filter((a) => a.startsWith("api.semanticscholar.org"))).toEqual([
      "api.semanticscholar.org/graph/v1/paper/batch",
      "api.semanticscholar.org/graph/v1/paper/sA/references",
    ]);
  });

  test("no seed and no label: nothing to expand from", async () => {
    const w = world();
    expect(await w.read("run-0", PLAN, [], [])).toBeNull();
    expect(w.asked).toEqual([]);
    expect(w.files.size).toBe(0);
  });
});

describe("the budget", () => {
  const many: TopicSeed[] = Array.from({ length: 25 }, (_, i) => ({ key: `arxiv:2601.${String(i).padStart(5, "0")}`, title: `Seed ${i}`, said: "", at: 1 }));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const run = async (fetchFn: GraphLiveDeps["fetchFn"]) => {
    let file: GraphRead | null = null;
    const deps: GraphLiveDeps = {
      fetchFn,
      load: async () => file,
      save: async (r) => void (file = r),
      cache: { load: async () => null, save: async () => {} },
      now: () => NOW,
    };
    return (await readGraphExpansion({ seeds: many, labels: [] }, PLAN, deps, new AbortController().signal))!;
  };

  test("S2 answering for every positive: one batch, the recommendations from twenty, six walked each way", async () => {
    let s2 = 0;
    const read = await run(async (url, init) => {
      const u = new URL(url);
      if (u.hostname !== "api.semanticscholar.org") return json({}, 404);
      s2++;
      if (u.pathname.endsWith("/batch")) {
        const asked = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
        return json(asked.map((id) => arxiv(id.slice(6), "x", { paperId: `p${id.slice(6)}` })));
      }
      if (u.pathname.startsWith("/recommendations/")) {
        expect((JSON.parse(String(init?.body)) as { positivePaperIds: string[] }).positivePaperIds).toHaveLength(20);
        return json({ recommendedPapers: [] });
      }
      return json({ data: [] });
    });
    expect(s2).toBe(14);
    expect(read.positives).toHaveLength(20);
    expect(read.streams).toHaveLength(13);
  });

  test("S2 cooling down: OpenAlex gets no more than eighteen list requests and twenty lookups", async () => {
    let lists = 0;
    let lookups = 0;
    const read = await run(async (url) => {
      const u = new URL(url);
      if (u.hostname === "api.semanticscholar.org") throw new HostCoolingDownError("api.semanticscholar.org/graph", NOW + 60_000, NOW);
      if (u.pathname.startsWith("/works/")) {
        lookups++;
        const id = decodeURIComponent(u.pathname).replace("/works/doi:10.48550/arXiv.", "");
        const n = Number(id.slice(5));
        return json(
          oaWork(`W44000${String(n).padStart(5, "0")}`, `Seed ${n}`, id, {
            related_works: ["https://openalex.org/W4500000001"],
            referenced_works: Array.from({ length: 120 }, (_, i) => `https://openalex.org/W46${String(i).padStart(8, "0")}`),
          }),
        );
      }
      lists++;
      return json({ meta: { count: 0 }, results: [] });
    });
    expect(lookups).toBe(20);
    expect(lists).toBe(13);
    expect(read.streams.every((s) => s.library === "openalex")).toBe(true);
  });
});
