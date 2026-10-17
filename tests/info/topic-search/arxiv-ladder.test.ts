import { expect, test } from "bun:test";
import type { SourceHealth } from "../../../src/info/sources/engine";
import type { InfoItem } from "../../../src/info/sources/item";
import { HostCoolingDownError, HttpStatusError, RateLimitError } from "../../../src/platform/http/throttled-fetch";
import {
  ARXIV_ENOUGH,
  ARXIV_LADDER_MAX_REQUESTS,
  bySpecificity,
  ladderSteps,
  runArxivLadder,
  type ArxivSearch,
} from "../../../src/info/topic-search/arxiv-ladder";
import type { SourceHealthFile } from "../../../src/info/topic-search/build-result";
import { foldTopicSearchHealth } from "../../../src/info/topic-search/source-health";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { arxivWindow, FIRST_LOOK_BACK_MS, X_FIRST_LOOK_BACK_DAYS } from "../../../src/info/topic-search/windows";

const WINDOW = { since: "2025-10-16", until: "2026-10-16" };
const signal = new AbortController().signal;

function papers(...ids: string[]): InfoItem[] {
  return ids.map((id) => ({ id: `arxiv-${id}`, source: "arxiv", sourceName: "arXiv", sourceKey: id, title: id, url: `https://arxiv.org/abs/${id}`, publishedAt: "2026-10-01", textContent: "", summaryOnly: true }));
}

/** A search answering by its words, recording each call and whether two ran at once. */
function fake(answers: Record<string, InfoItem[] | Error>) {
  const calls: { text: string; since: string }[] = [];
  let inFlight = 0;
  let overlapped = false;
  const search: ArxivSearch = async (text, window) => {
    calls.push({ text, since: window.since });
    inFlight++;
    if (inFlight > 1) overlapped = true;
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const a = answers[`${text}|${window.since}`] ?? answers[text] ?? [];
    if (a instanceof Error) throw a;
    return a;
  };
  return { search, calls, overlapped: () => overlapped };
}

test("generic words rank after the specific ones; otherwise the query's order holds", () => {
  expect(bySpecificity("machine learning materials discovery")).toEqual(["materials", "discovery", "machine", "learning"]);
  expect(bySpecificity("protein design deep learning")).toEqual(["protein", "design", "deep", "learning"]);
  expect(bySpecificity("AI for science")).toEqual(["science"]);
});

test("the ladder: three core words, the least specific dropped down to two, then the window widened", () => {
  expect(ladderSteps("machine learning weather forecasting nowcasting", WINDOW, "first")).toEqual([
    { terms: ["weather", "forecasting", "nowcasting"], ...WINDOW },
    { terms: ["weather", "forecasting"], ...WINDOW },
    { terms: ["weather", "forecasting"], since: "2024-10-16", until: "2026-10-16" },
  ]);
  // A daily window widens by a week; a one-word query keeps its word.
  expect(ladderSteps("science", { since: "2026-10-15", until: "2026-10-16" }, "daily")).toEqual([
    { terms: ["science"], since: "2026-10-15", until: "2026-10-16" },
    { terms: ["science"], since: "2026-10-08", until: "2026-10-16" },
  ]);
  expect(ladderSteps("AI of the", WINDOW, "first")).toEqual([]);
  expect(ladderSteps("a b c d e f g h", WINDOW, "first").length).toBeLessThanOrEqual(ARXIV_LADDER_MAX_REQUESTS);
});

test("enough at once is a direct hit, and nothing more is asked", async () => {
  const f = fake({ "protein design diffusion": papers("1", "2", "3") });
  const got = await runArxivLadder("protein design diffusion", WINDOW, "first", f.search, signal);
  expect(got.outcome).toBe("direct");
  expect(got.items.length).toBe(ARXIV_ENOUGH);
  expect(f.calls.length).toBe(1);
});

test("too few: words dropped, then the window widened, one request at a time, the narrow finds first", async () => {
  const f = fake({
    "protein design diffusion": papers("1"),
    "protein design": papers("1", "2"),
    "protein design|2024-10-16": papers("2", "3", "4"),
  });
  const got = await runArxivLadder("protein design diffusion", WINDOW, "first", f.search, signal);
  expect(got.outcome).toBe("widened");
  expect(got.items.map((i) => i.sourceKey)).toEqual(["1", "2", "3", "4"]);
  expect(got.steps.map((s) => s.hits)).toEqual([1, 2, 3]);
  expect(f.calls.map((c) => c.text)).toEqual(["protein design diffusion", "protein design", "protein design"]);
  expect(f.overlapped()).toBe(false);
});

test("nothing even at the widest is exhausted, not a failure", async () => {
  const f = fake({});
  const got = await runArxivLadder("protein design diffusion", WINDOW, "first", f.search, signal);
  expect(got).toMatchObject({ outcome: "exhausted", error: null, items: [] });
  expect(got.steps.length).toBe(3);
});

test("a rate limit is told apart from a failure, and what was found before it is kept", async () => {
  const limited = fake({ "protein design diffusion": papers("1"), "protein design": new RateLimitError("export.arxiv.org") });
  const a = await runArxivLadder("protein design diffusion", WINDOW, "first", limited.search, signal);
  expect(a.outcome).toBe("rate_limited");
  expect(a.error).toBe("rate limited (HTTP 429 from export.arxiv.org)");
  expect(a.items.length).toBe(1);
  expect(a.steps.map((s) => s.hits)).toEqual([1, null]);
  expect(limited.calls.length).toBe(2);

  const refused = fake({ "protein design diffusion": new HttpStatusError(403, "export.arxiv.org") });
  expect((await runArxivLadder("protein design diffusion", WINDOW, "first", refused.search, signal)).outcome).toBe("rate_limited");

  const broken = fake({ "protein design diffusion": new HttpStatusError(500, "export.arxiv.org") });
  const c = await runArxivLadder("protein design diffusion", WINDOW, "first", broken.search, signal);
  expect(c).toMatchObject({ outcome: "failed", error: "HTTP 500 from export.arxiv.org" });
});

test("a step refused by the host's cooldown ends the ladder as cooling_down, apart from a rate limit", async () => {
  const cooling = new HostCoolingDownError("export.arxiv.org", Date.parse("2026-10-17T10:20:00Z"), Date.parse("2026-10-17T10:10:00Z"));
  const held = fake({ "protein design diffusion": cooling });
  const a = await runArxivLadder("protein design diffusion", WINDOW, "first", held.search, signal);
  expect(a.outcome).toBe("cooling_down");
  expect(a.error).toBe("export.arxiv.org is cooling down after a rate limit (10 min left); no request sent");
  expect(a.steps.map((s) => s.hits)).toEqual([null]);
  expect(held.calls.length).toBe(1);
});

test("arXiv reads a year on the first run and from the last run on a day; X's first window stays 30 days", () => {
  expect(arxivWindow("first", Date.parse("2026-09-16T12:00:00"), "2026-10-16")).toEqual({ since: "2025-10-16", until: "2026-10-16" });
  expect(arxivWindow("daily", Date.parse("2026-10-15T03:00:00"), "2026-10-16")).toEqual({ since: "2026-10-15", until: "2026-10-16" });
  expect(X_FIRST_LOOK_BACK_DAYS).toBe(30);
  expect(FIRST_LOOK_BACK_MS).toBe(30 * 86_400_000);
});

test("the ladder's outcome reaches the source page's line", () => {
  const search = { id: "ts-1", name: "Proteins", queries: [{ id: "q1", subtopic: null, x: "protein design", arxiv: "protein design diffusion", ranking: "", weight: 1 }] } as unknown as TopicSearch;
  const ladder = { outcome: "rate_limited" as const, steps: [{ terms: ["protein", "design", "diffusion"], since: "2025-10-16", until: "2026-10-16", hits: null }] };
  const file: SourceHealthFile = {
    version: 1,
    searchId: "ts-1",
    kind: "first",
    at: 1000,
    entries: [{ searchId: "ts-1", query: "q1", source: "arxiv", status: "failed", why: "rate limited (HTTP 429 from export.arxiv.org)", fetchedAt: null, read: 0, fresh: 0, passedFloor: 0, ladder }],
  };
  const out: Record<string, SourceHealth> = foldTopicSearchHealth({}, file, search);
  const line = out["topic-search:ts-1:q1:arxiv"];
  expect(line.lastError).toBe("rate limited (HTTP 429 from export.arxiv.org)");
  expect(line.topicSearch?.ladder).toEqual(ladder);
});
