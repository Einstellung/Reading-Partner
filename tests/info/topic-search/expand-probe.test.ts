import { expect, test } from "bun:test";
import type { InfoItem } from "../../../src/info/sources/item";
import { HostCoolingDownError } from "../../../src/platform/http/host-gate";
import {
  evaluateFold,
  formatFold,
  formatPlan,
  formatTotals,
  graphTop,
  holdoutFolds,
  requestPlan,
  type ProbeFold,
} from "../../../src/info/topic-search/expand-probe";
import { budgetedFetch, BudgetSpentError, s2Expander, s2IdOfKey } from "../../../src/info/topic-search/expand-probe-s2";
import type { GraphRead } from "../../../src/info/topic-search/graph-read";
import type { RunReads } from "../../../src/info/topic-search/label-replay";
import type { TopicLabel, TopicLabelKind } from "../../../src/info/topic-search/labels";
import type { TopicSeed } from "../../../src/info/topic-search/types";

function label(item: string, kind: TopicLabelKind, at: number): TopicLabel {
  return { id: `tl-${String(at).padStart(8, "0")}`, searchId: "ts-1", item, title: `T ${item}`, label: kind, reason: "", source: "line", evidence: "m1", at, brief: null, criteria: 1 };
}

const SEEDS: TopicSeed[] = [{ key: "arxiv:2601.00001", title: "Seed one", said: "seed one", at: 1 }];
const LABELS = [
  label("arxiv:2601.00001", "yes", 1), // a seed: in both folds, never held out
  label("arxiv:2602.00001", "yes", 2),
  label("arxiv:2602.00002", "yes", 3),
  label("arxiv:2602.00003", "pinned", 4),
  label("arxiv:2602.00004", "yes", 5),
  label("doi:10.1/x", "yes", 6),
  label("github:a/b", "yes", 7),
  label("arxiv:2602.00009", "no", 8),
  label("arxiv:2602.00008", "no", 9),
  label("arxiv:2602.00007", "borderline", 10),
];

test("the folds split the arXiv yes/pinned in turn, keep seeds and DOI labels in both, and split the no labels", () => {
  const { folds, skipped } = holdoutFolds(LABELS, SEEDS);
  // Order: pinned, then yes newest first: 00003, 00004, 00002, 00001; alternating.
  expect(folds[0].request.positives.map((p) => [p.key, p.why])).toEqual([
    ["arxiv:2601.00001", "seed"],
    ["arxiv:2602.00003", "pinned"],
    ["arxiv:2602.00002", "yes"],
    ["doi:10.1/x", "yes"],
  ]);
  expect(folds[0].heldOut).toEqual(["arxiv:2602.00004", "arxiv:2602.00001"]);
  expect(folds[1].request.positives.map((p) => p.key)).toEqual(["arxiv:2601.00001", "arxiv:2602.00004", "arxiv:2602.00001", "doi:10.1/x"]);
  expect(folds[1].heldOut).toEqual(["arxiv:2602.00003", "arxiv:2602.00002"]);
  expect(folds[0].request.negatives).toEqual(["arxiv:2602.00008"]);
  expect(folds[0].heldOutNo).toEqual(["arxiv:2602.00009"]);
  expect(folds[1].request.negatives).toEqual(["arxiv:2602.00009"]);
  expect(skipped).toEqual(["github:a/b"]);
});

test("the plan sends one batch, one recommendation and the walks per fold, a walk both folds share once", () => {
  const { folds } = holdoutFolds(LABELS, SEEDS);
  const plan = requestPlan(folds);
  const of = (fold: number) => plan.requests.filter((r) => r.fold === fold).map((r) => `${r.what} ${r.from ?? ""}`.trim());
  expect(of(1)).toEqual([
    "batch",
    "rec",
    "cites arxiv:2601.00001",
    "refs arxiv:2601.00001",
    "cites arxiv:2602.00003",
    "refs arxiv:2602.00003",
    "cites arxiv:2602.00002",
    "refs arxiv:2602.00002",
    "cites doi:10.1/x",
    "refs doi:10.1/x",
  ]);
  // The seed and the DOI label were walked in fold 1.
  expect(of(2)).toEqual(["batch", "rec", "cites arxiv:2602.00004", "refs arxiv:2602.00004", "cites arxiv:2602.00001", "refs arxiv:2602.00001"]);
  expect(plan.cap).toBe(2 * (2 + 2 * 4));
  const text = formatPlan(holdoutFolds(LABELS, SEEDS), plan);
  expect(text).toContain("S2 requests planned: 16 (cap 20");
  expect(text).toContain("not papers, left out: github:a/b");
});

function paper(id: string): InfoItem {
  return { id: `arxiv-${id}`, source: "arxiv", sourceName: "arXiv", sourceKey: id, title: `P ${id}`, url: `https://arxiv.org/abs/${id}`, publishedAt: "2026-02-02T10:00:00Z", textContent: "" };
}

function read(streams: { kind: "rec" | "cites" | "refs"; ids: string[] }[], doiOnly = 0): GraphRead {
  return {
    version: 1,
    positives: [
      { key: "arxiv:2601.00001", title: "Seed one", why: "seed", s2: "S1", openAlex: null, citationCount: 10, walked: true },
      { key: "arxiv:2602.00003", title: "", why: "pinned", s2: null, openAlex: null, citationCount: null, walked: false },
    ],
    negatives: [],
    streams: streams.map((s, i) => ({
      id: s.kind === "rec" ? "rec" : `${s.kind}:k${i}`,
      kind: s.kind,
      from: [],
      library: "s2",
      outcome: "ok",
      total: s.ids.length + 1,
      papers: s.ids.map((id) => ({ arxivId: id, title: `G ${id}`, abstract: "", authors: [], publishedAt: "", citationCount: null })),
      at: "",
    })),
    doiOnly: { count: doiOnly, titles: [] },
  };
}

test("a fold is scored on the held-out papers the graph found, those the queries missed, the take and the top's no share", () => {
  const fold: ProbeFold = {
    n: 1,
    request: { positives: [{ key: "arxiv:2601.00001", title: "", why: "seed" }, { key: "arxiv:2602.00003", title: "", why: "pinned" }], negatives: [] },
    heldOut: ["arxiv:2602.00004", "arxiv:2602.00001", "arxiv:2410.00001"],
    heldOutNo: ["arxiv:2602.00009"],
  };
  const runs: RunReads[] = [{ x: null, arxiv: [{ query: "q1", items: [paper("2602.00001")], error: null }], huggingface: [] }];
  const filler = Array.from({ length: 9 }, (_, i) => `2603.0010${i}`);
  const g = read(
    [
      { kind: "rec", ids: ["2602.00009", "2603.00001", "2510.00001"] },
      // 00004 is ninth in a walk: found, past the take of 8.
      { kind: "cites", ids: [...filler.slice(0, 8), "2602.00004", "2602.00001"] },
    ],
    4,
  );
  const r = evaluateFold(fold, g, { runs, labels: [...LABELS, label("arxiv:2603.00001", "no", 20)], since: "2025-10-22" });
  expect(r.heldOut.total).toBe(3);
  expect(r.heldOut.inWindow).toBe(2); // 2410 is before the window
  expect(r.heldOut.lexical).toBe(1);
  expect(r.heldOut.graph).toBe(2);
  expect(r.heldOut.graphInTake).toBe(0);
  expect(r.heldOut.graphNotLexical).toBe(1);
  expect(r.heldOut.rows.find((x) => x.key === "arxiv:2602.00004")!.found).toEqual({ cites: 9 });
  expect(r.top.n).toBe(11); // rec 3 + cites' take of 8
  expect(r.top.no).toBe(2);
  expect(r.top.heldOutNo).toBe(1);
  expect(r.recMonths).toEqual({ "2026-02": 1, "2026-03": 1, "2025-10": 1 });
  expect(r.doiOnly).toBe(4);
  expect(r.positives).toEqual({ total: 2, resolved: 1, walked: ["arxiv:2601.00001"] });
  // The recommendation's first place outweighs a walk's.
  expect(graphTop(g, 1)).toEqual(["arxiv:2602.00009"]);

  const text = formatFold(r);
  expect(text).toContain("graph found 2 (0 within the pool's take); of them the queries missed 1 (0 within the take)");
  expect(text).toContain("graph top 11: 2 labelled no (18%; 1 of them held out)");
  expect(text).toContain("recommendations by month: 2026-03 1, 2026-02 1, 2025-10 1");
  expect(formatTotals([r, r])).toContain("both folds: held out 6; the graph found 4, 2 of them missed by the queries");
});

// --- the S2 expander against a fake S2 ---------------------------------------------

type Call = { url: string; body: unknown };

function fakeS2(calls: Call[], overrides: { cites?: () => Response } = {}) {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const s2 = (id: string, extra: Record<string, unknown> = {}) => ({ paperId: `P${id}`, title: `S2 ${id}`, abstract: "abs", authors: [{ name: "A" }], externalIds: { ArXiv: id }, citationCount: 5, publicationDate: "2026-03-01", ...extra });
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const path = new URL(url).pathname;
    if (path.endsWith("/paper/batch")) {
      return json(
        (body.ids as string[]).map((id) => {
          if (id === "ARXIV:2602.00002") return null;
          if (id === "ARXIV:2601.00001") return s2("2601.00001", { citationCount: 900 });
          return s2(id.replace(/^ARXIV:|^DOI:/, ""));
        }),
      );
    }
    if (path.startsWith("/recommendations/")) {
      return json({ recommendedPapers: [s2("2603.00001"), s2("2602.00003"), { paperId: "D1", title: "Journal only", externalIds: { DOI: "10.1/j" } }, { paperId: "D2", title: "On arXiv by DOI", externalIds: { DOI: "10.48550/arXiv.2603.00002" }, citationCount: 1 }] });
    }
    if (path.endsWith("/citations")) return overrides.cites ? overrides.cites() : json({ data: [{ citingPaper: s2("2603.00010", { citationCount: 1 }) }, { citingPaper: s2("2603.00011", { citationCount: 50 }) }] });
    if (path.endsWith("/references")) return json({ data: null });
    return json({}, 404);
  };
}

test("the S2 expander resolves once, recommends, walks the resolved positives, and keeps the arXiv papers", async () => {
  const calls: Call[] = [];
  const expand = s2Expander({ fetchFn: fakeS2(calls), apiKey: "k", now: () => new Date("2026-10-22T00:00:00Z") });
  const { folds } = holdoutFolds(LABELS, SEEDS);
  const r1 = await expand(folds[0].request);
  expect(calls[0].body).toEqual({ ids: ["ARXIV:2601.00001", "ARXIV:2602.00003", "ARXIV:2602.00002", "DOI:10.1/x", "ARXIV:2602.00008"] });
  // 00002 is unknown to S2: not recommended from, not walked.
  expect(r1.positives.map((p) => [p.key, p.s2, p.walked])).toEqual([
    ["arxiv:2601.00001", "P2601.00001", true],
    ["arxiv:2602.00003", "P2602.00003", true],
    ["arxiv:2602.00002", null, false],
    ["doi:10.1/x", "P10.1/x", true],
  ]);
  expect(calls[1].body).toEqual({ positivePaperIds: ["P2601.00001", "P2602.00003", "P10.1/x"], negativePaperIds: ["P2602.00008"] });
  const rec = r1.streams.find((s) => s.id === "rec")!;
  // The positive itself is dropped; the arXiv DOI counts as arXiv; the journal paper is DOI-only.
  expect(rec.papers.map((p) => p.arxivId)).toEqual(["2603.00001", "2603.00002"]);
  expect(rec.total).toBe(4);
  expect(r1.doiOnly).toEqual({ count: 1, titles: ["Journal only"] });
  const seedCites = r1.streams.find((s) => s.id === "cites:arxiv:2601.00001")!;
  expect(seedCites.outcome).toBe("hub");
  const cites = r1.streams.find((s) => s.id === "cites:arxiv:2602.00003")!;
  expect(cites.papers.map((p) => p.arxivId)).toEqual(["2603.00011", "2603.00010"]); // most cited first
  expect(r1.streams.find((s) => s.id === "refs:arxiv:2602.00003")!.outcome).toBe("not_found");
  // batch + rec + (refs for the hub seed) + (cites, refs) x 2
  expect(calls.length).toBe(1 + 1 + 1 + 4);

  const before = calls.length;
  const r2 = await expand(folds[1].request);
  // Only the keys not looked up before; the seed's and the DOI label's walks are not read again.
  expect(calls[before].body).toEqual({ ids: ["ARXIV:2602.00004", "ARXIV:2602.00001", "ARXIV:2602.00009"] });
  expect(calls.slice(before).map((c) => new URL(c.url).pathname.split("/").pop())).toEqual(["batch", "", "citations", "references", "citations", "references"]);
  expect(r2.streams.find((s) => s.id === "refs:arxiv:2601.00001")).toBeDefined();
  expect(calls.every((c) => !c.url.includes("api_key"))).toBe(true);
});

test("a cooling-down lane is recorded on the stream, not retried; the cap stops requests before they go out", async () => {
  const calls: Call[] = [];
  const expand = s2Expander({
    fetchFn: fakeS2(calls, {
      cites: () => {
        throw new HostCoolingDownError("api.semanticscholar.org/graph/v1/paper/batch+edges", 60_000, 0);
      },
    }),
  });
  const r = await expand({ positives: [{ key: "arxiv:2602.00004", title: "", why: "yes" }], negatives: [] });
  expect(r.streams.find((s) => s.kind === "cites")!.outcome).toBe("cooling_down");
  expect(calls.filter((c) => c.url.includes("/citations")).length).toBe(1);

  const sent: string[] = [];
  const budget = budgetedFetch(async (url) => {
    sent.push(url);
    return new Response("[]");
  }, { "api.semanticscholar.org": 1 });
  await budget.fetchFn("https://api.semanticscholar.org/graph/v1/paper/batch", {});
  await expect(budget.fetchFn("https://api.semanticscholar.org/graph/v1/paper/batch", {})).rejects.toBeInstanceOf(BudgetSpentError);
  await expect(budget.fetchFn("https://api.openalex.org/works", {})).rejects.toBeInstanceOf(BudgetSpentError);
  expect(sent.length).toBe(1);
  expect(budget.spent()).toEqual({ "api.semanticscholar.org": 1 });

  // A spent cap is a failed stream.
  const capped = s2Expander({ fetchFn: budgetedFetch(fakeS2([]), { "api.semanticscholar.org": 2 }).fetchFn });
  const c = await capped({ positives: [{ key: "arxiv:2602.00004", title: "", why: "yes" }], negatives: [] });
  expect(c.streams.find((s) => s.kind === "cites")!.outcome).toBe("failed");
  expect(s2IdOfKey("github:a/b")).toBeNull();
});
