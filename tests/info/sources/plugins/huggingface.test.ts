// The Hugging Face index provider (src/info/sources/plugins/huggingface.ts): query
// validation and description, the request urls, and discovery for the three
// kinds against fixtures trimmed from live Hub responses (2026-09-13). Fetch is
// scripted, so nothing here touches the network. Run: bun test.

import { afterEach, expect, test } from "bun:test";
import {
  HF_SEARCH_MAX,
  huggingfacePlugin,
  inWindow,
  isConversion,
  paperDay,
  papersUrl,
  paperSearchUrl,
  reposUrl,
  searchItem,
} from "../../../../src/info/sources/plugins/huggingface";
import {
  registerSourcePlugin,
  resetSourcePluginsForTests,
  type PluginDeps,
} from "../../../../src/info/sources/plugin";
import { collectSource } from "../../../../src/info/sources/engine";
import { itemId } from "../../../../src/workshop/extract/id";
import type { SourceDescriptor } from "../../../../src/info/sources/descriptor";
import { jsonResponse, textResponse } from "../../../support/fetch";

const P = huggingfacePlugin;

function desc(query: Record<string, unknown>, limit?: number): SourceDescriptor {
  return {
    id: "hf-test",
    name: "HF test",
    line: "AI",
    enabled: true,
    limit,
    discovery: { kind: "index", provider: "huggingface", query },
    fulltext: { mode: "none" },
  };
}

// A scripted fetch that answers by url and records what it was asked.
function scripted(answer: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return answer(url);
  };
  return { calls, fetchFn };
}

function deps(fetchFn: PluginDeps["fetchFn"], extra: Partial<PluginDeps> = {}): PluginDeps {
  return {
    fetchFn,
    now: () => Date.UTC(2026, 8, 13, 12),
    today: () => "2026-09-13",
    ...extra,
  };
}

// --- fixtures (trimmed live rows) -------------------------------------------

// api/daily_papers?date=2026-09-11, authors and avatars dropped. `upvotes` and
// `numComments` are the documented names; the live capture was cut before them.
const PAPER_ROW = {
  paper: {
    id: "2609.10715",
    publishedAt: "2026-09-09T00:00:00.000Z",
    submittedOnDailyAt: "2026-09-11T00:00:00.000Z",
    title:
      "NCP-ArchPreview Technical Report: Moving towards Latent Space Language Models through Next Concept Prediction",
    summary:
      "We introduce NCP-ArchPreview, a latent-space language model that pushes autoregressive pretraining beyond standard next-token prediction (NTP). Alongside NTP, the model learns through Next Concept Prediction (NCP) to predict discrete concepts that span multiple tokens,\nintroducing an explicit and more challenging concept-level objective while preserving standard token-level autoregressive generation. NCP-ArchPreview builds a latent space by constructing a product-quantized concept vocabulary directly from its hidden states, and subsequently learns to predict future concepts via a dedicated Concept Module. These predicted concepts are then fed back to the token level to guide subsequent generation.",
    upvotes: 41,
  },
  publishedAt: "2026-09-09T00:00:00.000Z",
  title:
    "NCP-ArchPreview Technical Report: Moving towards Latent Space Language Models through Next Concept Prediction",
  numComments: 3,
};

// api/models?sort=trendingScore&direction=-1&limit=3&pipeline_tag=robotics&filter=lerobot
const MODEL_ROWS = [
  {
    _id: "683c069f3f2842f6afffe5ff",
    id: "lerobot/smolvla_base",
    likes: 439,
    trendingScore: 6,
    private: false,
    downloads: 164345,
    tags: [
      "lerobot",
      "safetensors",
      "vision-language-action",
      "imitation-learning",
      "robotics",
      "en",
      "arxiv:2506.01844",
      "region:us",
    ],
    pipeline_tag: "robotics",
    library_name: "lerobot",
    createdAt: "2025-06-01T07:51:59.000Z",
    modelId: "lerobot/smolvla_base",
  },
  {
    _id: "68c03fe5abde8f659687b5e8",
    id: "lerobot/pi05_base",
    likes: 102,
    trendingScore: 3,
    private: false,
    downloads: 19989,
    tags: ["lerobot", "safetensors", "vision-language-action", "robotics", "license:gemma", "region:us"],
    pipeline_tag: "robotics",
    library_name: "lerobot",
    createdAt: "2025-09-09T14:55:33.000Z",
    modelId: "lerobot/pi05_base",
  },
];

// Conversions, in the shapes the Hub lists them: a GGUF repo by name and tag,
// an AWQ repo by name only, a quantized relation tag with a clean name.
const GGUF_ROW = {
  id: "unsloth/Qwen3-8B-GGUF",
  likes: 900,
  downloads: 2_000_000,
  tags: ["gguf", "qwen3", "base_model:quantized:Qwen/Qwen3-8B", "region:us"],
  pipeline_tag: "text-generation",
  library_name: "transformers",
  createdAt: "2025-04-29T00:00:00.000Z",
};
const AWQ_ROW = {
  id: "casperhansen/llama-3-70b-instruct-awq",
  likes: 50,
  downloads: 30_000,
  tags: ["transformers", "safetensors", "llama", "text-generation", "region:us"],
  pipeline_tag: "text-generation",
  library_name: "transformers",
  createdAt: "2024-04-19T00:00:00.000Z",
};
const QUANTIZED_RELATION_ROW = {
  id: "someone/Qwen3-8B-int4",
  likes: 5,
  downloads: 300,
  tags: ["base_model:quantized:Qwen/Qwen3-8B", "region:us"],
  pipeline_tag: "text-generation",
  createdAt: "2025-05-01T00:00:00.000Z",
};

// api/datasets?sort=likes&direction=-1&limit=2&author=lerobot, description cut.
const DATASET_ROWS = [
  {
    _id: "65fed7bfb1e509e1e40fa507",
    id: "lerobot/pusht",
    author: "lerobot",
    disabled: false,
    gated: false,
    lastModified: "2025-09-27T11:40:03.000Z",
    likes: 58,
    private: false,
    sha: "7628202a2180972f291ba1bc6723834921e72c19",
    description:
      'This dataset was created using LeRobot.\n\n\t\n\t\t\n\t\tDataset Structure\n\t\n\nmeta/info.json:\n{\n    "codebase_version": "v2.0",\n    "robot_type": "unknown",\n    "total_episodes": 206… See the full description on the dataset page: https://huggingface.co/datasets/lerobot/pusht.',
    downloads: 13414,
    tags: [
      "task_categories:robotics",
      "license:mit",
      "size_categories:10K<n<100K",
      "format:parquet",
      "modality:video",
      "library:datasets",
      "library:pandas",
      "arxiv:2303.04137",
      "region:us",
      "LeRobot",
    ],
    createdAt: "2024-03-23T13:23:11.000Z",
    key: "",
  },
];

// --- identity ----------------------------------------------------------------

test("provider identity", () => {
  expect(P.id).toBe("huggingface");
  expect(P.name).toBe("Hugging Face");
  expect(P.hosts).toEqual(["huggingface.co"]);
  expect(P.defaultLimit).toBe(30);
});

// --- validateQuery ---------------------------------------------------------

test("validateQuery accepts each kind with its own fields", () => {
  expect(P.validateQuery({ kind: "papers" })).toBeNull();
  expect(P.validateQuery({ kind: "papers", days: 3 })).toBeNull();
  expect(
    P.validateQuery({
      kind: "models",
      pipelineTag: "robotics",
      author: "lerobot",
      tags: ["lerobot", "safetensors"],
      sort: "likes",
      includeConversions: true,
    }),
  ).toBeNull();
  expect(P.validateQuery({ kind: "datasets", author: "lerobot", sort: "created" })).toBeNull();
});

test("validateQuery rejects a bad or missing kind", () => {
  expect(P.validateQuery({})).toMatch(/kind must be one of/);
  expect(P.validateQuery({ kind: "spaces" })).toMatch(/kind must be one of/);
});

test("validateQuery rejects malformed fields", () => {
  expect(P.validateQuery({ kind: "papers", days: 0 })).toMatch(/days must be a positive integer/);
  expect(P.validateQuery({ kind: "papers", days: 1.5 })).toMatch(/days must be a positive integer/);
  expect(P.validateQuery({ kind: "papers", days: "2" })).toMatch(/days must be a positive integer/);
  expect(P.validateQuery({ kind: "papers", days: 40 })).toMatch(/at most 31/);
  expect(P.validateQuery({ kind: "models", sort: "hot" })).toMatch(/sort must be one of/);
  expect(P.validateQuery({ kind: "models", tags: "lerobot" })).toMatch(/tags must be a list/);
  expect(P.validateQuery({ kind: "models", tags: ["", "x"] })).toMatch(/tags must be a list/);
  expect(P.validateQuery({ kind: "models", author: "" })).toMatch(/author must be a non-empty string/);
  expect(P.validateQuery({ kind: "models", pipelineTag: 3 })).toMatch(/pipelineTag must be/);
  expect(P.validateQuery({ kind: "models", includeConversions: "yes" })).toMatch(/must be a boolean/);
});

test("validateQuery rejects fields on the wrong kind", () => {
  expect(P.validateQuery({ kind: "models", days: 2 })).toMatch(/days applies to papers only/);
  expect(P.validateQuery({ kind: "papers", author: "lerobot" })).toMatch(/models and datasets only/);
  expect(P.validateQuery({ kind: "papers", tags: ["x"] })).toMatch(/models and datasets only/);
  expect(P.validateQuery({ kind: "papers", sort: "likes" })).toMatch(/models and datasets only/);
  expect(P.validateQuery({ kind: "datasets", includeConversions: false })).toMatch(/models only/);
});

// --- describeQuery ---------------------------------------------------------

test("describeQuery says the query in one line", () => {
  expect(P.describeQuery({ kind: "papers" })).toBe("HF papers · today");
  expect(P.describeQuery({ kind: "papers", days: 3 })).toBe("HF papers · last 3 days");
  expect(P.describeQuery({ kind: "models" })).toBe("HF models · trending");
  expect(P.describeQuery({ kind: "models", pipelineTag: "robotics", author: "lerobot" })).toBe(
    "HF models · robotics · by lerobot · trending",
  );
  expect(P.describeQuery({ kind: "datasets", tags: ["lerobot", "so101"], sort: "downloads" })).toBe(
    "HF datasets · tags lerobot, so101 · downloads",
  );
});

// --- urls ------------------------------------------------------------------

test("papersUrl asks daily_papers for one date", () => {
  expect(papersUrl("2026-09-11")).toBe("https://huggingface.co/api/daily_papers?date=2026-09-11");
});

test("reposUrl maps sort and filters onto the Hub's params", () => {
  expect(reposUrl({ kind: "models" }, 30)).toBe(
    "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=30",
  );
  expect(reposUrl({ kind: "models", sort: "likes" }, 5)).toContain("/api/models?sort=likes&direction=-1&limit=5");
  expect(reposUrl({ kind: "models", sort: "downloads" }, 5)).toContain("sort=downloads");
  expect(reposUrl({ kind: "models", sort: "created" }, 5)).toContain("sort=createdAt");
  expect(reposUrl({ kind: "datasets", sort: "trending" }, 5)).toContain("/api/datasets?sort=trendingScore");
  const url = new URL(
    reposUrl({ kind: "models", pipelineTag: "robotics", author: "lerobot", tags: ["lerobot", "safetensors"] }, 10),
  );
  expect(url.searchParams.get("pipeline_tag")).toBe("robotics");
  expect(url.searchParams.get("author")).toBe("lerobot");
  expect(url.searchParams.getAll("filter")).toEqual(["lerobot", "safetensors"]);
});

// --- discover: papers --------------------------------------------------------

test("papers: one request for today, rows become paper items with signals", async () => {
  const { calls, fetchFn } = scripted(() => jsonResponse([PAPER_ROW, { paper: {} }]));
  const d = desc({ kind: "papers" });
  const items = await P.discover(d, { kind: "papers" }, deps(fetchFn));
  expect(calls).toEqual(["https://huggingface.co/api/daily_papers?date=2026-09-13"]);
  expect(items.length).toBe(1);
  const it = items[0];
  expect(it.id).toBe(itemId("hf-test", "2609.10715"));
  expect(it.sourceKey).toBe("2609.10715");
  expect(it.title).toMatch(/^NCP-ArchPreview Technical Report/);
  expect(it.url).toBe("https://huggingface.co/papers/2609.10715");
  expect(it.publishedAt).toBe("2026-09-09T00:00:00.000Z");
  expect(it.summaryOnly).toBe(true);
  expect(it.summary!.length).toBe(400);
  expect(it.summary).not.toContain("\n");
  expect(it.textContent).toBe(PAPER_ROW.paper.summary);
  expect(it.signals).toEqual({ upvotes: 41, comments: 3, tags: ["paper"] });
});

test("papers: days>1 walks back one page a day and skips an empty weekend page", async () => {
  const { calls, fetchFn } = scripted((url) => {
    if (url.endsWith("2026-09-12")) return jsonResponse([]);
    const id = url.endsWith("2026-09-13") ? "2609.00001" : "2609.00002";
    return jsonResponse([{ ...PAPER_ROW, paper: { ...PAPER_ROW.paper, id } }]);
  });
  const items = await P.discover(desc({ kind: "papers" }), { kind: "papers", days: 3 }, deps(fetchFn));
  expect(calls).toEqual([
    "https://huggingface.co/api/daily_papers?date=2026-09-13",
    "https://huggingface.co/api/daily_papers?date=2026-09-12",
    "https://huggingface.co/api/daily_papers?date=2026-09-11",
  ]);
  expect(items.map((i) => i.sourceKey)).toEqual(["2609.00001", "2609.00002"]);
});

test("papers: the limit caps the total and stops the day loop", async () => {
  const rows = ["a", "b", "c"].map((s) => ({ ...PAPER_ROW, paper: { ...PAPER_ROW.paper, id: `2609.0000${s}` } }));
  const { calls, fetchFn } = scripted(() => jsonResponse(rows));
  const items = await P.discover(desc({ kind: "papers" }), { kind: "papers", days: 5 }, deps(fetchFn, { limit: 2 }));
  expect(calls.length).toBe(1);
  expect(items.length).toBe(2);
});

// --- discover: models --------------------------------------------------------

test("models: rows become weight items; conversions are dropped by default", async () => {
  const { calls, fetchFn } = scripted(() =>
    jsonResponse([MODEL_ROWS[0], GGUF_ROW, AWQ_ROW, QUANTIZED_RELATION_ROW, MODEL_ROWS[1]]),
  );
  const q = { kind: "models", pipelineTag: "robotics", tags: ["lerobot"] };
  const items = await P.discover(desc(q), q, deps(fetchFn, { limit: 3 }));
  expect(calls.length).toBe(1);
  const url = new URL(calls[0]);
  expect(url.pathname).toBe("/api/models");
  expect(url.searchParams.get("sort")).toBe("trendingScore");
  expect(url.searchParams.get("limit")).toBe("3");
  expect(url.searchParams.get("pipeline_tag")).toBe("robotics");
  expect(url.searchParams.getAll("filter")).toEqual(["lerobot"]);
  expect(items.map((i) => i.sourceKey)).toEqual(["lerobot/smolvla_base", "lerobot/pi05_base"]);
  const it = items[0];
  expect(it.title).toBe("lerobot/smolvla_base (robotics)");
  expect(it.url).toBe("https://huggingface.co/lerobot/smolvla_base");
  expect(it.publishedAt).toBe("2025-06-01T07:51:59.000Z");
  expect(it.summary).toBe(
    "pipeline: robotics · tags: lerobot, safetensors, vision-language-action, imitation-learning, robotics, en",
  );
  expect(it.summaryOnly).toBe(true);
  expect(it.textContent).toBeUndefined();
  expect(it.signals).toEqual({
    likes: 439,
    downloads: 164345,
    createdAt: "2025-06-01T07:51:59.000Z",
    tags: ["robotics", "lerobot", "weights"],
  });
});

test("models: includeConversions keeps the GGUF and AWQ repos", async () => {
  const { fetchFn } = scripted(() => jsonResponse([GGUF_ROW, AWQ_ROW, MODEL_ROWS[0]]));
  const q = { kind: "models", includeConversions: true };
  const items = await P.discover(desc(q), q, deps(fetchFn));
  expect(items.map((i) => i.sourceKey)).toEqual([
    "unsloth/Qwen3-8B-GGUF",
    "casperhansen/llama-3-70b-instruct-awq",
    "lerobot/smolvla_base",
  ]);
});

test("isConversion reads the tag, the quantized relation and the name", () => {
  expect(isConversion(GGUF_ROW)).toBe(true);
  expect(isConversion(AWQ_ROW)).toBe(true);
  expect(isConversion(QUANTIZED_RELATION_ROW)).toBe(true);
  expect(isConversion({ id: "mlx-community/Qwen3-8B-4bit", tags: ["mlx"] })).toBe(true);
  expect(isConversion({ id: "org/model_onnx", tags: [] })).toBe(true);
  expect(isConversion(MODEL_ROWS[0])).toBe(false);
  // A marker inside a word is not a marker: "awesome" is not AWQ, "mlxperiment" is not MLX.
  expect(isConversion({ id: "org/awesome-mlxperiment", tags: [] })).toBe(false);
});

// --- discover: datasets ------------------------------------------------------

test("datasets: task and library come from tags, the description is the summary", async () => {
  const { calls, fetchFn } = scripted(() => jsonResponse(DATASET_ROWS));
  const q = { kind: "datasets", author: "lerobot", sort: "likes" };
  const items = await P.discover(desc(q), q, deps(fetchFn));
  const url = new URL(calls[0]);
  expect(url.pathname).toBe("/api/datasets");
  expect(url.searchParams.get("sort")).toBe("likes");
  expect(url.searchParams.get("author")).toBe("lerobot");
  expect(url.searchParams.get("limit")).toBe("30");
  expect(items.length).toBe(1);
  const it = items[0];
  expect(it.title).toBe("lerobot/pusht (robotics)");
  expect(it.url).toBe("https://huggingface.co/datasets/lerobot/pusht");
  expect(it.publishedAt).toBe("2024-03-23T13:23:11.000Z");
  expect(it.summary).toMatch(/^This dataset was created using LeRobot\. Dataset Structure meta\/info\.json/);
  expect(it.summaryOnly).toBe(true);
  expect(it.signals).toEqual({
    likes: 58,
    downloads: 13414,
    createdAt: "2024-03-23T13:23:11.000Z",
    tags: ["robotics", "datasets", "dataset"],
  });
});

// --- failures and cancellation -----------------------------------------------

test("a failed request throws instead of yielding nothing", async () => {
  const { fetchFn } = scripted(() => textResponse("nope", 404));
  await expect(P.discover(desc({ kind: "papers" }), { kind: "papers" }, deps(fetchFn))).rejects.toThrow(/HTTP 404/);
});

test("a non-array body is a shape failure", async () => {
  const { fetchFn } = scripted(() => jsonResponse({ error: "Invalid date" }));
  await expect(P.discover(desc({ kind: "models" }), { kind: "models" }, deps(fetchFn))).rejects.toThrow(
    /unexpected shape/,
  );
});

test("an aborted signal stops before any request", async () => {
  const ac = new AbortController();
  ac.abort();
  const { calls, fetchFn } = scripted(() => jsonResponse([]));
  await expect(
    P.discover(desc({ kind: "papers" }), { kind: "papers", days: 2 }, deps(fetchFn, { signal: ac.signal })),
  ).rejects.toThrow();
  expect(calls.length).toBe(0);
});

// --- through the engine ------------------------------------------------------

afterEach(() => resetSourcePluginsForTests());

test("collectSource runs an index descriptor through the registered provider", async () => {
  registerSourcePlugin(huggingfacePlugin);
  const { calls, fetchFn } = scripted(() => jsonResponse(MODEL_ROWS));
  const d = desc({ kind: "models", author: "lerobot" }, 10);
  const items = await collectSource(d, { fetchFn, now: () => Date.UTC(2026, 8, 13) });
  expect(calls.length).toBe(1);
  expect(new URL(calls[0]).searchParams.get("limit")).toBe("10");
  expect(items.length).toBe(2);
  expect(items[0].source).toBe("hf-test");
  expect(items[0].sourceName).toBe("HF test");
  expect(items[0].id).toMatch(/^hf-test-/);
  expect(items[0].signals?.likes).toBe(439);
});

test("collectSource rejects a query the provider does not accept", async () => {
  registerSourcePlugin(huggingfacePlugin);
  const { calls, fetchFn } = scripted(() => jsonResponse([]));
  await expect(collectSource(desc({ kind: "spaces" }), { fetchFn })).rejects.toThrow(/index query rejected/);
  expect(calls.length).toBe(0);
});

// --- search ------------------------------------------------------------------

// api/papers/search rows in the shape seen 2026-10-18, trimmed: `highlighted*`
// and most authors dropped.
function searchRow(id: string, publishedAt: string, extra: Record<string, unknown> = {}) {
  return {
    paper: {
      id,
      title: `Paper ${id}`,
      summary: `Abstract of ${id}.`,
      publishedAt,
      authors: [{ name: "Ada Lovelace", hidden: false }, { name: "Alan Turing", hidden: false }],
      upvotes: 3,
      ai_summary: "A model-written line.",
      ai_keywords: ["symbolic regression"],
      ...extra,
    },
    publishedAt: "2026-01-01T00:00:00.000Z",
    title: `Paper ${id}`,
    numComments: 1,
    highlightedTitle: [{ type: "text", text: `Paper ${id}` }],
  };
}

test("paperDay keeps the Hub's day inside the id's month and clamps it to that month otherwise", () => {
  expect(paperDay("2610.11059", "2026-10-13T17:59:59.000Z")).toBe("2026-10-13");
  // A later stamp (a revision, the Hub's own date) falls back to the id's month.
  expect(paperDay("2102.10570", "2021-10-26T00:00:00.000Z")).toBe("2021-02-28");
  expect(paperDay("2602.08885", "2026-01-30T00:00:00.000Z")).toBe("2026-02-01");
  expect(paperDay("2402.00001", "")).toBe("2024-02-01");
  // An old-style id has no month in it.
  expect(paperDay("hep-th/9901001", "1999-01-05T00:00:00.000Z")).toBe("1999-01-05");
  expect(paperDay("hep-th/9901001", "")).toBeNull();
});

test("a search row becomes an arXiv-addressed item with the Hub's links and counts", () => {
  const item = searchItem(
    searchRow("2610.11059", "2026-10-13T17:59:59.000Z", {
      githubRepo: "https://github.com/a/b",
      githubStars: 42,
      projectPage: "https://a.github.io/b",
      organization: { name: "deepmind", fullname: "Google DeepMind" },
    }),
  )!;
  expect(item.url).toBe("https://arxiv.org/abs/2610.11059");
  expect(item.sourceKey).toBe("2610.11059");
  expect(item.source).toBe("huggingface");
  expect(item.publishedAt).toBe("2026-10-13T17:59:59.000Z");
  expect(item.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
  expect(item.textContent).toBe("Abstract of 2610.11059.");
  expect(item.signals).toMatchObject({
    upvotes: 3,
    comments: 1,
    stars: 42,
    repo: "https://github.com/a/b",
    projectPage: "https://a.github.io/b",
    aiSummary: "A model-written line.",
    tags: ["paper", "code", "Google DeepMind"],
  });
  // A stamp outside the id's month is replaced by the day paperDay keeps.
  expect(searchItem(searchRow("2102.10570", "2021-10-26T00:00:00.000Z"))!.publishedAt).toBe("2021-02-28");
  expect(searchItem({ paper: {} })).toBeNull();
});

test("inWindow reads the item's day against inclusive bounds", () => {
  const at = (publishedAt: string) => ({ publishedAt });
  expect(inWindow(at("2026-10-13T17:59:59.000Z"), "2026-10-13", "2026-10-13")).toBe(true);
  expect(inWindow(at("2026-10-12"), "2026-10-13")).toBe(false);
  expect(inWindow(at("2026-10-14"), undefined, "2026-10-13")).toBe(false);
  expect(inWindow(at(""), "2026-10-13")).toBe(false);
  expect(inWindow(at(""))).toBe(true);
});

test("search sends one request and filters the answer to the window in the Hub's order", async () => {
  const { calls, fetchFn } = scripted(() =>
    jsonResponse([
      searchRow("2401.00001", "2024-01-05T00:00:00.000Z"),
      searchRow("2609.00002", "2026-09-20T00:00:00.000Z"),
      searchRow("2610.00003", "2026-10-02T00:00:00.000Z"),
      searchRow("2609.00002", "2026-09-20T00:00:00.000Z"),
    ]),
  );
  const items = await P.search!("symbolic regression", { since: "2026-01-01", until: "2026-10-18" }, deps(fetchFn));
  expect(calls).toEqual([paperSearchUrl("symbolic regression")]);
  expect(new URL(calls[0]).searchParams.get("limit")).toBe(String(HF_SEARCH_MAX));
  expect(items.map((i) => i.sourceKey)).toEqual(["2609.00002", "2610.00003"]);
  const one = await P.search!("x", { sinceYear: 2026, limit: 1 }, deps(fetchFn));
  expect(one.map((i) => i.sourceKey)).toEqual(["2609.00002"]);
});

test("search turns a refused request into a status error and a non-array answer into a shape error", async () => {
  const refused = scripted(() => new Response("bad", { status: 400 }));
  await expect(P.search!("x", {}, deps(refused.fetchFn))).rejects.toThrow(/HTTP 400 from huggingface.co/);
  expect(refused.calls.length).toBe(1);
  const odd = scripted(() => jsonResponse({ error: "nope" }));
  await expect(P.search!("x", {}, deps(odd.fetchFn))).rejects.toThrow(/unexpected shape/);
});
