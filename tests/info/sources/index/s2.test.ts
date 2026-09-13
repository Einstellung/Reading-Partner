// Semantic Scholar index provider (docs/69). Fake fetch only: the anonymous
// pool answered 429 to both live probes on 2026-09-13 (docs/pitfall/73), so the
// fixture row follows the shapes and examples in S2's own OpenAPI spec
// (/graph/v1/swagger.json), not a captured response. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import { collectSource } from "../../../../src/info/sources/engine";
import {
  registerIndexProvider,
  resetIndexProvidersForTests,
  type IndexDeps,
} from "../../../../src/info/sources/index-provider";
import { s2IndexUrl, s2Provider, s2SearchTerms } from "../../../../src/info/sources/index/s2";
import type { SourceDescriptor } from "../../../../src/info/sources/descriptor";
import { itemId } from "../../../../src/info/extract/id";
import { jsonResponse } from "../../../support/fetch";

afterEach(() => resetIndexProvidersForTests());

const TODAY = "2026-09-13";
const FIXED_NOW = Date.UTC(2026, 8, 13, 12);

function desc(query: Record<string, unknown>, limit?: number): SourceDescriptor {
  return {
    id: "s2-vla",
    name: "S2 VLA",
    line: "robotics",
    enabled: true,
    discovery: { kind: "index", provider: "s2", query },
    fulltext: { mode: "none" },
    ...(limit !== undefined ? { limit } : {}),
  };
}

function deps(fetchFn: IndexDeps["fetchFn"], limit?: number, signal?: AbortSignal): IndexDeps {
  return { fetchFn, now: () => FIXED_NOW, today: () => TODAY, limit, signal };
}

// A row shaped as the spec documents /paper/search rows: paperId always present;
// externalIds an object keyed by source; openAccessPdf an object with url and
// status; publicationDate YYYY-MM-DD or null; counts integers.
const ARXIV_ROW = {
  paperId: "5c5751d45e298cea054f32b392c12c61027d2fe7",
  externalIds: { ArXiv: "2608.01234", DOI: "10.48550/arXiv.2608.01234", CorpusId: 315416146 },
  url: "https://www.semanticscholar.org/paper/5c5751d45e298cea054f32b392c12c61027d2fe7",
  title: "A Vision Language Action Model for Long-Horizon Manipulation",
  abstract: "We describe a deployed scalable system for organizing published scientific literature. ".repeat(6),
  venue: "arXiv.org",
  year: 2026,
  publicationDate: "2026-08-20",
  citationCount: 12,
  influentialCitationCount: 3,
  openAccessPdf: { url: "https://arxiv.org/pdf/2608.01234", status: "GREEN" },
  authors: [{ authorId: "1741101", name: "A. Author" }],
};
const PDF_ROW = {
  paperId: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
  externalIds: { DOI: "10.18653/V1/2026.ACL-MAIN.447", DBLP: "conf/acl/X26" },
  url: "https://www.semanticscholar.org/paper/0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
  title: "Grounded Robot Instruction Following",
  abstract: null,
  venue: "Annual Meeting of the Association for Computational Linguistics",
  year: 2026,
  publicationDate: "2026-09-01",
  citationCount: 2,
  influentialCitationCount: 0,
  openAccessPdf: { url: "https://aclanthology.org/2026.acl-main.447.pdf", status: "HYBRID" },
  authors: [],
};
const BARE_ROW = {
  paperId: "abababababababababababababababababababab",
  externalIds: {},
  url: "https://www.semanticscholar.org/paper/abababababababababababababababababababab",
  title: "Bare landing page paper",
  abstract: "",
  venue: "",
  year: 2026,
  publicationDate: null,
  citationCount: null,
  influentialCitationCount: null,
  openAccessPdf: null,
  authors: [],
};

// --- schema ------------------------------------------------------------------

test("validateQuery: terms is required, as a string or a list", () => {
  expect(s2Provider.validateQuery({})).toMatch(/terms/);
  expect(s2Provider.validateQuery({ terms: "" })).toMatch(/terms/);
  expect(s2Provider.validateQuery({ terms: [" ", ""] })).toMatch(/terms/);
  expect(s2Provider.validateQuery({ terms: 3 })).toMatch(/terms/);
  expect(s2Provider.validateQuery({ terms: "robot learning" })).toBeNull();
  expect(s2Provider.validateQuery({ terms: ["vision-language-action", "robot"] })).toBeNull();
});

test("validateQuery: the optional fields are checked when present", () => {
  expect(s2Provider.validateQuery({ terms: "x", days: 0 })).toMatch(/days/);
  expect(s2Provider.validateQuery({ terms: "x", days: "7" })).toMatch(/days/);
  expect(s2Provider.validateQuery({ terms: "x", days: 7 })).toBeNull();
  expect(s2Provider.validateQuery({ terms: "x", minCitations: -1 })).toMatch(/minCitations/);
  expect(s2Provider.validateQuery({ terms: "x", minCitations: 0 })).toBeNull();
  expect(s2Provider.validateQuery({ terms: "x", minCitations: 5 })).toBeNull();
  expect(s2Provider.validateQuery({ terms: "x", fieldsOfStudy: [] })).toMatch(/fieldsOfStudy/);
  expect(s2Provider.validateQuery({ terms: "x", fieldsOfStudy: 1 })).toMatch(/fieldsOfStudy/);
  expect(s2Provider.validateQuery({ terms: "x", fieldsOfStudy: ["Computer Science"] })).toBeNull();
});

test("describeQuery is one line with the defaults filled and the zero floor left out", () => {
  expect(s2Provider.describeQuery({ terms: ["vision-language-action", "robot"], minCitations: 5 })).toBe(
    "Semantic Scholar · vision-language-action robot · last 30 days · ≥ 5 citations",
  );
  expect(s2Provider.describeQuery({ terms: "robot", days: 7, fieldsOfStudy: ["Computer Science"] })).toBe(
    "Semantic Scholar · robot · last 7 days · Computer Science",
  );
});

// --- request -----------------------------------------------------------------

test("the url carries the date window, the index fields, the filters and the limit", () => {
  const u = decodeURIComponent(
    s2IndexUrl({ terms: ["vision-language-action", "robot"], days: 30, minCitations: 5, fieldsOfStudy: ["Computer Science"] }, TODAY, 20),
  );
  expect(u.startsWith("https://api.semanticscholar.org/graph/v1/paper/search?")).toBe(true);
  // Hyphenated terms match nothing on /paper/search (the API docs say so).
  expect(u).toContain("query=vision language action robot");
  expect(u).toContain("publicationDateOrYear=2026-08-14:");
  expect(u).toContain("minCitationCount=5");
  expect(u).toContain("fieldsOfStudy=Computer Science");
  expect(u).toContain("limit=20");
  for (const f of [
    "title",
    "authors",
    "year",
    "publicationDate",
    "externalIds",
    "venue",
    "url",
    "abstract",
    "citationCount",
    "influentialCitationCount",
    "openAccessPdf",
  ]) {
    expect(u).toMatch(new RegExp(`fields=[^&]*\\b${f}\\b`));
  }
  expect(u).not.toContain("year=");
});

test("the defaults: 30 days back, no citation floor, no field filter, and the page is capped at 100", () => {
  const u = decodeURIComponent(s2IndexUrl({ terms: "robot" }, TODAY, 500));
  expect(u).toContain("publicationDateOrYear=2026-08-14:");
  expect(u).not.toContain("minCitationCount");
  expect(u).not.toContain("fieldsOfStudy");
  expect(u).toContain("limit=100");
  expect(s2SearchTerms(["a-b", " c  d "])).toBe("a b c d");
});

// --- discover ----------------------------------------------------------------

test("discover maps rows to items with the counts as signals and the arXiv page as the link", async () => {
  const seen: string[] = [];
  const fetchFn = async (url: string) => {
    seen.push(url);
    return jsonResponse({ total: 3, offset: 0, data: [ARXIV_ROW, PDF_ROW, BARE_ROW] });
  };
  const d = desc({ terms: "vision language action" });
  const items = await s2Provider.discover(d, d.discovery.kind === "index" ? d.discovery.query : {}, deps(fetchFn, 20));
  expect(seen).toHaveLength(1);
  expect(decodeURIComponent(seen[0])).toContain("publicationDateOrYear=2026-08-14:");
  expect(items.map((i) => i.title)).toEqual([ARXIV_ROW.title, PDF_ROW.title, BARE_ROW.title]);

  const [a, p, b] = items;
  expect(a.id).toBe(itemId("s2-vla", ARXIV_ROW.paperId));
  expect(a.sourceKey).toBe(ARXIV_ROW.paperId);
  expect(a.url).toBe("https://arxiv.org/abs/2608.01234");
  expect(a.publishedAt).toBe("2026-08-20");
  expect(a.summaryOnly).toBe(true);
  expect(a.summary).toHaveLength(400);
  expect(a.textContent).toBe(ARXIV_ROW.abstract.trim());
  expect(a.signals).toEqual({ citations: 12, influentialCitations: 3, tags: ["arXiv.org"] });

  // No arXiv id: the open-access PDF. No abstract: no summary, no text.
  expect(p.url).toBe("https://aclanthology.org/2026.acl-main.447.pdf");
  expect(p.summary).toBeUndefined();
  expect(p.textContent).toBeUndefined();
  expect(p.signals).toEqual({
    citations: 2,
    influentialCitations: 0,
    tags: ["Annual Meeting of the Association for Computational Linguistics"],
  });

  // Nothing but the landing page and a year.
  expect(b.url).toBe(BARE_ROW.url);
  expect(b.publishedAt).toBe("2026");
  expect(b.signals).toEqual({});
});

test("discover drops rows under the citation floor and untitled rows", async () => {
  const fetchFn = async () => jsonResponse({ data: [ARXIV_ROW, PDF_ROW, BARE_ROW, { paperId: "x", title: "" }] });
  const d = desc({ terms: "robot", minCitations: 5 });
  const items = await s2Provider.discover(d, { terms: "robot", minCitations: 5 }, deps(fetchFn));
  expect(items.map((i) => i.title)).toEqual([ARXIV_ROW.title]);
});

test("discover reads a null page as nothing, not as a crash", async () => {
  const d = desc({ terms: "robot" });
  expect(await s2Provider.discover(d, { terms: "robot" }, deps(async () => jsonResponse({ data: null })))).toEqual([]);
  expect(await s2Provider.discover(d, { terms: "robot" }, deps(async () => jsonResponse({})))).toEqual([]);
});

test("discover passes the caller's signal to the request and stops before it when already aborted", async () => {
  const ac = new AbortController();
  let seen: AbortSignal | null | undefined = null;
  const fetchFn = async (_url: string, init?: RequestInit) => {
    seen = init?.signal;
    return jsonResponse({ data: [] });
  };
  const d = desc({ terms: "robot" });
  await s2Provider.discover(d, { terms: "robot" }, deps(fetchFn, undefined, ac.signal));
  expect(seen).toBe(ac.signal);
  ac.abort();
  let calls = 0;
  await expect(
    s2Provider.discover(d, { terms: "robot" }, deps(async () => (calls++, jsonResponse({ data: [] })), undefined, ac.signal)),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

// A terminal 429 after the one interactive retry, so the source fails loudly
// instead of hammering the pool (docs/pitfall/73). The retry sleeps its 1.5s
// backoff on a real timer: the call site has no sleep to inject.
test("a rate limit that holds is a thrown error, after exactly one retry", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return jsonResponse({ message: "Too Many Requests", code: "429" }, 429);
  };
  const d = desc({ terms: "robot" });
  await expect(s2Provider.discover(d, { terms: "robot" }, deps(fetchFn))).rejects.toThrow(/429/);
  expect(calls).toBe(2);
});

test("a status the search cannot use throws instead of reading as no results", async () => {
  const d = desc({ terms: "robot" });
  await expect(
    s2Provider.discover(d, { terms: "robot" }, deps(async () => jsonResponse({ error: "bad" }, 400))),
  ).rejects.toThrow(/400/);
});

// --- through the engine ------------------------------------------------------

test("collectSource runs an s2 descriptor through the registered provider", async () => {
  registerIndexProvider(s2Provider);
  const seen: string[] = [];
  const fetchFn = async (url: string) => {
    seen.push(url);
    return jsonResponse({ data: [ARXIV_ROW, PDF_ROW] });
  };
  const items = await collectSource(desc({ terms: ["vision-language-action", "robot"], days: 7 }, 5), {
    fetchFn,
    now: () => FIXED_NOW,
  });
  expect(seen).toHaveLength(1);
  const u = decodeURIComponent(seen[0]);
  expect(u).toContain("publicationDateOrYear=2026-09-06:");
  expect(u).toContain("limit=5");
  expect(items).toHaveLength(2);
  expect(items[0].source).toBe("s2-vla");
  expect(items[0].sourceName).toBe("S2 VLA");
  expect(items[0].signals?.citations).toBe(12);

  await expect(collectSource(desc({}), { fetchFn })).rejects.toThrow(/index query rejected.*terms/);
});
