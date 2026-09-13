// The GitHub index provider (src/info/sources/plugins/github.ts): query
// validation and description, the URLs both modes build on a fixed day, the
// items they map from OSS Insight / GitHub Search fixtures, topic merging, and
// OpenDigger enrichment that never fails the source. Run: bun test.
//
// Fixtures: the OSS Insight envelope and the OpenDigger objects are trimmed
// live responses (2026-09-13); the trending rows are the API's own OpenAPI
// example, since the live endpoint has served no rows since 2026-03-01
// (pitfall 296); the search body follows GitHub's REST docs.

import { afterEach, expect, test } from "bun:test";
import { collectSource } from "../../../../src/info/sources/engine";
import type { SourceDescriptor } from "../../../../src/info/sources/descriptor";
import {
  githubPlugin,
  githubSearchUrls,
  githubTrendingUrl,
  latestMonthValue,
  openDiggerUrl,
} from "../../../../src/info/sources/plugins/github";
import { registerSourcePlugin, resetSourcePluginsForTests, type PluginDeps } from "../../../../src/info/sources/plugin";
import { jsonResponse, textResponse } from "../../../support/fetch";

afterEach(() => resetSourcePluginsForTests());

const TODAY = "2026-09-13";
const NOW = Date.UTC(2026, 8, 13, 12);

const DESC: SourceDescriptor = {
  id: "gh-1",
  name: "GitHub robotics",
  line: "robotics",
  enabled: true,
  discovery: { kind: "index", provider: "github", query: { mode: "trending" } },
  fulltext: { mode: "none" },
};

// --- fixtures ----------------------------------------------------------------

const TRENDING = {
  type: "sql_endpoint",
  data: {
    columns: [
      { col: "repo_name", data_type: "VARCHAR", nullable: true },
      { col: "stars", data_type: "INT", nullable: true },
    ],
    rows: [
      {
        collection_names: "CICD",
        contributor_logins: "cplee,nektos-ci,usagirei,ae-ou,MrNossiom",
        description: "Run your GitHub Actions locally",
        forks: "5",
        primary_language: "Go",
        pull_requests: "6",
        pushes: "17",
        repo_id: "163883279",
        repo_name: "nektos/act",
        stars: "395",
        total_score: "1565.7526",
      },
      {
        collection_names: "ChatGPT Alternatives",
        contributor_logins: "antonkesy,ruanslv,starplatinum3,AlexandroLuis,realhaik",
        description: "Inference code for LLaMA models",
        forks: "48",
        primary_language: "Python",
        pull_requests: "41",
        pushes: "",
        repo_id: "601538369",
        repo_name: "facebookresearch/llama",
        stars: "209",
        total_score: "1079.0274",
      },
      { repo_id: "1", repo_name: "", stars: "5" },
    ],
    result: { row_count: 3 },
  },
};

// Verbatim live answer, 2026-09-13.
const TRENDING_UNAVAILABLE = {
  type: "sql_endpoint",
  data: { columns: [], rows: [], result: { row_count: 0 } },
  data_quality: {
    status: "unavailable",
    metric: "github_event_derived_ranking",
    source: "github_public_events_firehose",
    unavailable_since: "2026-03-01",
    reason:
      "This ranking is ordered by recent star/PR/issue event counts, and our capture of those events fell to roughly 0.3% of baseline, so the ordering would be noise. An empty result here means the metric cannot be computed, not that there are no matching repositories.",
    alternative: "Totals synced directly from GitHub remain accurate: use /gh/repos/{owner}/{repo} for star and fork counts, or /v1/collections/{id}/repos for collection membership.",
    docs: "https://ossinsight.io/docs/data-quality",
  },
};

function searchRepo(fullName: string, stars: number, extra: Record<string, unknown> = {}) {
  const [owner, name] = fullName.split("/");
  return {
    id: 1,
    name,
    full_name: fullName,
    owner: { login: owner },
    html_url: `https://github.com/${fullName}`,
    description: `About ${name}`,
    created_at: "2026-09-02T08:00:00Z",
    stargazers_count: stars,
    forks_count: Math.floor(stars / 10),
    language: "Python",
    topics: ["robotics", "embodied-ai", "sim", "rl", "manipulation", "extra"],
    ...extra,
  };
}

function searchBody(items: unknown[]) {
  return { total_count: items.length, incomplete_results: false, items };
}

// Trimmed live pytorch/pytorch responses: year, quarter and month keys mixed.
const OPENRANK = { "2025": 12345.19, "2026": 4175.53, "2026Q2": 1596.85, "2026Q3": 333.26, "2026-05": 1124.3, "2026-06": 472.55, "2026-07": 333.26 };
const ACTIVITY = { "2026": 5530.74, "2026-05": 632.57, "2026-06": 275.56, "2026-07": 106.76 };

// A fetch keyed by host: OpenDigger answers per metric, 404 for repos it lacks.
function scripted(primary: (url: string) => Response, digger: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetchFn = async (url: string): Promise<Response> => {
    calls.push(url);
    if (url.startsWith("https://oss.open-digger.cn/")) {
      const m = url.match(/github\/(.+)\/(openrank|activity)\.json$/)!;
      const known = digger[m[1]] as Record<string, unknown> | undefined;
      if (!known) return textResponse("<Error><Code>NoSuchKey</Code></Error>", 404);
      return jsonResponse(known[m[2]]);
    }
    return primary(url);
  };
  return { calls, fetchFn };
}

function deps(fetchFn: PluginDeps["fetchFn"], limit?: number, signal?: AbortSignal): PluginDeps {
  return { fetchFn, now: () => NOW, today: () => TODAY, limit, signal };
}

// --- validateQuery ------------------------------------------------------------

test("validateQuery accepts both modes with their own fields", () => {
  expect(githubPlugin.validateQuery({ mode: "trending" })).toBeNull();
  expect(githubPlugin.validateQuery({ mode: "trending", language: "Python", period: "week" })).toBeNull();
  expect(githubPlugin.validateQuery({ mode: "search" })).toBeNull();
  expect(githubPlugin.validateQuery({ mode: "search", topics: ["robotics"], days: 7, minStars: 0, language: "C++" })).toBeNull();
  expect(githubPlugin.validateQuery({ mode: "search", topics: "robotics" })).toBeNull();
});

test("validateQuery rejects a missing mode, a bad enum, and fields from the other mode", () => {
  expect(githubPlugin.validateQuery({})).toMatch(/mode must be/);
  expect(githubPlugin.validateQuery({ mode: "topic" })).toMatch(/mode must be/);
  expect(githubPlugin.validateQuery({ mode: "trending", period: "year" })).toMatch(/period must be/);
  expect(githubPlugin.validateQuery({ mode: "trending", topics: ["x"] })).toMatch(/topics applies to search/);
  expect(githubPlugin.validateQuery({ mode: "trending", minStars: 5 })).toMatch(/minStars applies to search/);
  expect(githubPlugin.validateQuery({ mode: "search", period: "week" })).toMatch(/period applies to trending/);
  expect(githubPlugin.validateQuery({ mode: "search", days: 0 })).toMatch(/days must be a positive/);
  expect(githubPlugin.validateQuery({ mode: "search", days: 2.5 })).toMatch(/days must be a positive/);
  expect(githubPlugin.validateQuery({ mode: "search", minStars: -1 })).toMatch(/minStars must be/);
  expect(githubPlugin.validateQuery({ mode: "search", topics: 3 })).toMatch(/topics must be/);
  expect(githubPlugin.validateQuery({ mode: "search", language: 3 })).toMatch(/language must be/);
});

// --- describeQuery ------------------------------------------------------------

test("describeQuery is one line per mode, defaults filled in", () => {
  expect(githubPlugin.describeQuery({ mode: "trending" })).toBe("GitHub trending · past day");
  expect(githubPlugin.describeQuery({ mode: "trending", language: "Python", period: "week" })).toBe("GitHub trending · Python · past week");
  expect(githubPlugin.describeQuery({ mode: "search" })).toBe("GitHub new repos · created in 14 days · ≥ 20 stars");
  expect(githubPlugin.describeQuery({ mode: "search", topics: ["robotics", "Embodied-AI"], days: 14, minStars: 50 })).toBe(
    "GitHub new repos · topic robotics, embodied-ai · created in 14 days · ≥ 50 stars",
  );
  expect(githubPlugin.describeQuery({ mode: "search", language: "Rust", days: 1 })).toBe("GitHub new repos · Rust · created in 1 day · ≥ 20 stars");
  expect(githubPlugin.describeQuery({ mode: "nope" })).toMatch(/invalid query/);
});

// --- urls ---------------------------------------------------------------------

test("trending url encodes the period and the language, leaving language off for all", () => {
  expect(githubTrendingUrl({ mode: "trending" })).toBe("https://api.ossinsight.io/v1/trends/repos/?period=past_24_hours");
  expect(githubTrendingUrl({ mode: "trending", period: "month", language: "C++" })).toBe(
    "https://api.ossinsight.io/v1/trends/repos/?period=past_month&language=C%2B%2B",
  );
  expect(() => githubTrendingUrl({ mode: "search" })).toThrow(/not a trending/);
});

test("search urls carry the created/stars/language qualifiers, one request per topic", () => {
  const one = githubSearchUrls({ mode: "search" }, TODAY, 30);
  expect(one).toHaveLength(1);
  const u = new URL(one[0]);
  expect(u.origin + u.pathname).toBe("https://api.github.com/search/repositories");
  expect(u.searchParams.get("q")).toBe("created:>2026-08-30 stars:>=20");
  expect(u.searchParams.get("sort")).toBe("stars");
  expect(u.searchParams.get("order")).toBe("desc");
  expect(u.searchParams.get("per_page")).toBe("30");

  const two = githubSearchUrls(
    { mode: "search", topics: ["robotics", "embodied-ai"], days: 7, minStars: 50, language: "Emacs Lisp" },
    TODAY,
    500,
  );
  expect(two.map((s) => new URL(s).searchParams.get("q"))).toEqual([
    'created:>2026-09-06 stars:>=50 language:"Emacs Lisp" topic:robotics',
    'created:>2026-09-06 stars:>=50 language:"Emacs Lisp" topic:embodied-ai',
  ]);
  // per_page is capped at the API's 100.
  expect(new URL(two[0]).searchParams.get("per_page")).toBe("100");
  expect(() => githubSearchUrls({ mode: "trending" }, TODAY, 1)).toThrow(/not a search/);
});

test("openDigger url and the latest-month pick over mixed keys", () => {
  expect(openDiggerUrl("pytorch/pytorch", "openrank")).toBe("https://oss.open-digger.cn/github/pytorch/pytorch/openrank.json");
  expect(latestMonthValue(OPENRANK)).toBe(333.26);
  expect(latestMonthValue(ACTIVITY)).toBe(106.76);
  expect(latestMonthValue({ "2026": 1, "2026Q3": 2 })).toBeUndefined();
  expect(latestMonthValue({ "2026-07": "x" })).toBeUndefined();
  expect(latestMonthValue(null)).toBeUndefined();
  expect(latestMonthValue([])).toBeUndefined();
});

// --- discover: trending ---------------------------------------------------------

test("trending maps OSS Insight rows to items dated today, with period stars and tags", async () => {
  const { calls, fetchFn } = scripted(() => jsonResponse(TRENDING), { "nektos/act": { openrank: OPENRANK, activity: ACTIVITY } });
  const items = await githubPlugin.discover(DESC, { mode: "trending", language: "Python", period: "week" }, deps(fetchFn));
  expect(calls[0]).toBe("https://api.ossinsight.io/v1/trends/repos/?period=past_week&language=Python");
  // The nameless row is dropped.
  expect(items.map((i) => i.sourceKey)).toEqual(["nektos/act", "facebookresearch/llama"]);
  const act = items[0];
  expect(act.id).toMatch(/^gh-1-/);
  expect(act.title).toBe("nektos/act: Run your GitHub Actions locally");
  expect(act.summary).toBe("Run your GitHub Actions locally");
  expect(act.url).toBe("https://github.com/nektos/act");
  expect(act.publishedAt).toBe(TODAY);
  expect(act.summaryOnly).toBe(true);
  // The API counts the period, not totals: starsPeriod, and no stars/forks.
  expect(act.signals).toEqual({ starsPeriod: 395, tags: ["Go", "CICD"], openrank: 333.26, activity: 106.76 });
  // The second repo is one OpenDigger does not know: two 404s, fields unset.
  expect(items[1].signals).toEqual({ starsPeriod: 209, tags: ["Python", "ChatGPT Alternatives"] });
  expect(calls.slice(1)).toEqual([
    "https://oss.open-digger.cn/github/nektos/act/openrank.json",
    "https://oss.open-digger.cn/github/nektos/act/activity.json",
    "https://oss.open-digger.cn/github/facebookresearch/llama/openrank.json",
    "https://oss.open-digger.cn/github/facebookresearch/llama/activity.json",
  ]);
});

test("trending honours the limit before enriching", async () => {
  const { calls, fetchFn } = scripted(() => jsonResponse(TRENDING));
  const items = await githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn, 1));
  expect(items.map((i) => i.sourceKey)).toEqual(["nektos/act"]);
  expect(calls).toHaveLength(3);
});

test("trending with the data_quality 'unavailable' block is a source failure naming the reason", async () => {
  const { fetchFn } = scripted(() => jsonResponse(TRENDING_UNAVAILABLE));
  await expect(githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn))).rejects.toThrow(
    /OSS Insight trending unavailable since 2026-03-01: This ranking/,
  );
});

test("trending with no rows and no quality note is an empty day", async () => {
  const { fetchFn } = scripted(() => jsonResponse({ type: "sql_endpoint", data: { columns: [], rows: [], result: { row_count: 0 } } }));
  expect(await githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn))).toEqual([]);
});

test("a failed primary request throws with the status", async () => {
  const { fetchFn } = scripted(() => textResponse("down", 502));
  await expect(githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn))).rejects.toThrow(/HTTP 502 from https:\/\/api\.ossinsight\.io/);
});

// --- discover: search -----------------------------------------------------------

test("search maps repos with total stars, forks, createdAt and topic tags, and sends GitHub's headers", async () => {
  let init: RequestInit | undefined;
  const fetchFn = async (url: string, i?: RequestInit) => {
    if (url.startsWith("https://api.github.com/")) {
      init = i;
      return jsonResponse(searchBody([searchRepo("lerobot/lerobot", 1200), searchRepo("acme/quiet", 30, { description: null, language: null, topics: [] })]));
    }
    return textResponse("nope", 404);
  };
  const items = await githubPlugin.discover(DESC, { mode: "search", topics: ["robotics"], minStars: 30 }, deps(fetchFn));
  expect(new Headers(init?.headers).get("Accept")).toBe("application/vnd.github+json");
  expect(new Headers(init?.headers).get("X-GitHub-Api-Version")).toBe("2022-11-28");
  expect(items).toHaveLength(2);
  const le = items[0];
  expect(le.sourceKey).toBe("lerobot/lerobot");
  expect(le.title).toBe("lerobot/lerobot: About lerobot");
  expect(le.url).toBe("https://github.com/lerobot/lerobot");
  expect(le.publishedAt).toBe("2026-09-02T08:00:00Z");
  expect(le.signals).toEqual({
    stars: 1200,
    forks: 120,
    createdAt: "2026-09-02T08:00:00Z",
    tags: ["Python", "robotics", "embodied-ai", "sim", "rl", "manipulation"],
  });
  // Nulls from the API leave the fields off rather than "null" in a title.
  expect(items[1].title).toBe("acme/quiet");
  expect(items[1].summary).toBeUndefined();
  expect(items[1].signals).toEqual({ stars: 30, forks: 3, createdAt: "2026-09-02T08:00:00Z" });
});

test("search issues one request per topic, merges by full_name, sorts by stars and caps at the limit", async () => {
  const { calls, fetchFn } = scripted((url) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    if (q.endsWith("topic:robotics")) return jsonResponse(searchBody([searchRepo("a/shared", 500), searchRepo("b/robots", 90), searchRepo("c/tiny", 25)]));
    if (q.endsWith("topic:embodied-ai")) return jsonResponse(searchBody([searchRepo("d/embodied", 900), searchRepo("a/shared", 500)]));
    throw new Error(`unexpected ${url}`);
  });
  const items = await githubPlugin.discover(DESC, { mode: "search", topics: ["robotics", "embodied-ai"] }, deps(fetchFn, 3));
  expect(calls.filter((u) => u.startsWith("https://api.github.com/"))).toHaveLength(2);
  expect(items.map((i) => i.sourceKey)).toEqual(["d/embodied", "a/shared", "b/robots"]);
  // Enrichment asks about the kept three only, sequentially, openrank then activity.
  expect(calls.filter((u) => u.startsWith("https://oss.open-digger.cn/")).map((u) => u.replace("https://oss.open-digger.cn/github/", ""))).toEqual([
    "d/embodied/openrank.json",
    "d/embodied/activity.json",
    "a/shared/openrank.json",
    "a/shared/activity.json",
    "b/robots/openrank.json",
    "b/robots/activity.json",
  ]);
});

test("search: a spent rate limit is named in the failure", async () => {
  const fetchFn = async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
  await expect(githubPlugin.discover(DESC, { mode: "search" }, deps(fetchFn))).rejects.toThrow(/HTTP 403 .*rate limit spent/);
});

// --- enrichment tolerance and cancellation ------------------------------------------

test("OpenDigger junk, 5xx and a thrown fetch leave signals alone and the source alive", async () => {
  let n = 0;
  const fetchFn = async (url: string) => {
    if (url.startsWith("https://api.ossinsight.io/")) return jsonResponse(TRENDING);
    n += 1;
    if (n === 1) return textResponse("not json", 200);
    if (n === 2) return textResponse("boom", 503);
    throw new Error("connection reset");
  };
  const items = await githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn));
  expect(items).toHaveLength(2);
  expect(items[0].signals).toEqual({ starsPeriod: 395, tags: ["Go", "CICD"] });
  expect(items[1].signals).toEqual({ starsPeriod: 209, tags: ["Python", "ChatGPT Alternatives"] });
});

test("enrichment stops at the top five", async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ repo_name: `o/r${i}`, stars: String(100 - i) }));
  const { calls, fetchFn } = scripted(() => jsonResponse({ type: "sql_endpoint", data: { rows } }));
  const items = await githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn));
  expect(items).toHaveLength(8);
  expect(calls.filter((u) => u.startsWith("https://oss.open-digger.cn/"))).toHaveLength(10);
});

test("an abort during enrichment surfaces instead of passing for a miss", async () => {
  const controller = new AbortController();
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://api.ossinsight.io/")) return jsonResponse(TRENDING);
    controller.abort();
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    return jsonResponse(OPENRANK);
  };
  await expect(githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn, undefined, controller.signal))).rejects.toThrow(/aborted/);
});

test("a query already aborted sends nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const { calls, fetchFn } = scripted(() => jsonResponse(TRENDING));
  await expect(githubPlugin.discover(DESC, { mode: "trending" }, deps(fetchFn, undefined, controller.signal))).rejects.toThrow();
  expect(calls).toEqual([]);
});

// --- through the engine -------------------------------------------------------------

test("collectSource runs a github index descriptor and stamps the descriptor's identity", async () => {
  registerSourcePlugin(githubPlugin);
  const desc: SourceDescriptor = {
    ...DESC,
    id: "gh-new",
    name: "New robotics repos",
    limit: 2,
    discovery: { kind: "index", provider: "github", query: { mode: "search", topics: ["robotics"], days: 7, minStars: 50 } },
  };
  const { calls, fetchFn } = scripted((url) => {
    expect(new URL(url).searchParams.get("q")).toBe("created:>2026-09-06 stars:>=50 topic:robotics");
    expect(new URL(url).searchParams.get("per_page")).toBe("2");
    return jsonResponse(searchBody([searchRepo("x/one", 300), searchRepo("y/two", 200), searchRepo("z/three", 100)]));
  }, { "x/one": { openrank: OPENRANK, activity: ACTIVITY } });
  const items = await collectSource(desc, { fetchFn, now: () => NOW });
  expect(items.map((i) => [i.source, i.sourceName, i.sourceKey])).toEqual([
    ["gh-new", "New robotics repos", "x/one"],
    ["gh-new", "New robotics repos", "y/two"],
  ]);
  expect(items[0].signals?.openrank).toBe(333.26);
  expect(items[0].signals?.stars).toBe(300);
  expect(items[1].signals?.openrank).toBeUndefined();
  expect(calls).toHaveLength(1 + 4);

  // A rejected query is a source failure with the provider's reason.
  const bad = { ...desc, id: "gh-bad", discovery: { kind: "index" as const, provider: "github", query: { mode: "search", period: "week" } } };
  await expect(collectSource(bad, { fetchFn })).rejects.toThrow(/index query rejected.*period applies to trending/);
});
