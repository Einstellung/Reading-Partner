// A study's drafting (docs/info/91 起草与种子, 来源开关): looking up the papers the
// reader named, the seed card's verdicts, the seeds and sources the drafting
// card carries, what Apply writes, and which sources a topic's runs read.
// Every library is a fake. Run: scripts/t.sh tests/info/topic-search/seeds.test.ts

import { expect, test } from "bun:test";
import { applyTopicSearchProposal, type ConcernPorts } from "../../../src/info/topic-search/apply";
import {
  draftingSourcesLine,
  seedVerdictNote,
  withSeedVerdict,
  type StudySeedsCardData,
  type TopicSearchProposalCardData,
} from "../../../src/info/topic-search/cards";
import { latestLabels, type TopicLabel } from "../../../src/info/topic-search/labels";
import { sourcesOf, splitsFirstLook, topicSources } from "../../../src/info/topic-search/pace";
import { buildProposeTopicSearchTool, draftSources } from "../../../src/info/topic-search/propose-tool";
import { planRetry } from "../../../src/info/topic-search/retry";
import { arxivIdIn, findSeedPaper, titleMatch, type SeedPaper, type SeedSearches } from "../../../src/info/topic-search/seed-lookup";
import { buildFindSeedPaperTool } from "../../../src/info/topic-search/seed-tool";
import { pickSeeds } from "../../../src/info/topic-search/seeds";
import { topicSearchGuidance } from "../../../src/info/topic-search/guidance";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { HostCoolingDownError } from "../../../src/platform/http/host-gate";
import type { AgentTool } from "../../../src/legion/durable/contract";

const OCT_21 = new Date("2026-10-21T09:00:00Z").getTime();

const paper = (arxivId: string | null, title: string, over: Partial<SeedPaper> = {}): SeedPaper => ({
  arxivId,
  doi: null,
  title,
  authors: ["A. Author", "B. Author"],
  date: "2025-02-01",
  ...over,
});

function libraries(over: Partial<SeedSearches> = {}) {
  const asked: string[] = [];
  const searches: SeedSearches = {
    byArxivId: async (id) => (asked.push(`id:${id}`), paper(id, "Paper by id")),
    arxiv: async (text) => (asked.push(`arxiv:${text}`), []),
    huggingface: async (text) => (asked.push(`hf:${text}`), []),
    s2: async (text) => (asked.push(`s2:${text}`), []),
    ...over,
  };
  return { searches, asked };
}

type ToolResult = Awaited<ReturnType<AgentTool["execute"]>>;
const textOf = (r: ToolResult) => (typeof r === "string" ? r : r.text);

test("an arXiv id in the name is looked up directly, once", async () => {
  expect(arxivIdIn("https://arxiv.org/abs/2502.01234v2")).toBe("2502.01234");
  expect(arxivIdIn("the arXiv:2502.01234 one")).toBe("2502.01234");
  expect(arxivIdIn("KeplerAgent")).toBeNull();
  const { searches, asked } = libraries();
  const found = await findSeedPaper("arXiv:2502.01234", searches);
  expect(asked).toEqual(["id:2502.01234"]);
  expect(found.candidates.map((c) => [c.key, c.handle, c.url])).toEqual([
    ["arxiv:2502.01234", "arXiv 2502.01234", "https://arxiv.org/abs/2502.01234"],
  ]);
});

test("a title match on arXiv or Hugging Face comes first and Semantic Scholar is not asked", async () => {
  expect(titleMatch("KeplerAgent: Discovering laws with an LLM", "KeplerAgent")).toBe(1);
  expect(titleMatch("Agent systems for labs", "agent")).toBe(0);
  const { searches } = libraries({
    arxiv: async () => [paper("2501.00001", "Symbolic regression at scale"), paper("2501.00002", "KeplerAgent: Discovering laws with an LLM")],
    huggingface: async () => [paper("2501.00002", "KeplerAgent: Discovering laws with an LLM"), paper("2501.00003", "Laws from data"), paper("2501.00004", "More")],
    s2: async () => {
      throw new Error("Semantic Scholar should not be asked");
    },
  });
  const found = await findSeedPaper("KeplerAgent", searches);
  expect(found.misses).toEqual([]);
  expect(found.candidates.map((c) => c.key)).toEqual(["arxiv:2501.00002", "arxiv:2501.00001", "arxiv:2501.00003"]);
  expect(found.candidates.every((c) => c.verdict === null)).toBe(true);
});

test("without a title match Semantic Scholar is asked once; a journal paper is keyed by its DOI", async () => {
  let s2Asked = 0;
  const { searches } = libraries({
    arxiv: async () => [paper("2501.00001", "Something else")],
    s2: async () => {
      s2Asked++;
      return [paper(null, "Highly accurate protein structure prediction with AlphaFold", { doi: "10.1038/S41586-021-03819-2" }), paper(null, "No id at all")];
    },
  });
  const found = await findSeedPaper("Highly accurate protein structure prediction with AlphaFold", searches);
  expect(s2Asked).toBe(1);
  expect(found.candidates.map((c) => [c.key, c.handle])).toEqual([
    ["doi:10.1038/s41586-021-03819-2", "DOI 10.1038/s41586-021-03819-2"],
    ["arxiv:2501.00001", "arXiv 2501.00001"],
  ]);
});

test("a library cooling down is reported, not waited out; nothing found says so and draws no card", async () => {
  const { searches } = libraries({
    arxiv: async () => {
      throw new HostCoolingDownError("export.arxiv.org", OCT_21 + 20 * 60_000, OCT_21);
    },
  });
  const found = await findSeedPaper("KeplerAgent", searches);
  expect(found.candidates).toEqual([]);
  expect(found.misses.map((m) => [m.source, m.cooling])).toEqual([["arXiv", true]]);

  const cards: StudySeedsCardData[] = [];
  const tool = buildFindSeedPaperTool({ threadId: "t1", readerLines: () => [], searches, now: () => OCT_21, raiseCard: (c) => cards.push(c) });
  const text = textOf(await tool.execute({ name: "KeplerAgent", said: "KeplerAgent 那篇" }));
  expect(cards).toEqual([]);
  expect(text).toContain("No paper found");
  expect(text).toContain("cooling down");
});

test("find_seed_paper draws the card with the program's fields and the reader's words", async () => {
  const { searches } = libraries({ arxiv: async () => [paper("2501.00002", "KeplerAgent: Discovering laws with an LLM")] });
  const cards: StudySeedsCardData[] = [];
  const tool = buildFindSeedPaperTool({
    threadId: "t1",
    readerLines: () => [{ ts: OCT_21, text: "我知道 KeplerAgent 那篇是对的" }],
    searches,
    now: () => OCT_21,
    raiseCard: (c) => cards.push(c),
  });
  const text = textOf(await tool.execute({ name: "KeplerAgent", said: "KeplerAgent 那篇" }));
  expect(cards).toHaveLength(1);
  expect(cards[0].said).toBe("KeplerAgent 那篇");
  expect(cards[0].evidence).toBe(`t1:${OCT_21}`);
  expect(cards[0].candidates[0].title).toBe("KeplerAgent: Discovering laws with an LLM");
  expect(text).toContain("key arxiv:2501.00002");
});

function seedCard(said: string, keys: [string, string][], verdicts: (null | "yes" | "no")[] = []): StudySeedsCardData {
  return {
    kind: "study-seeds",
    threadId: "t1",
    said,
    evidence: `t1:${OCT_21}`,
    at: OCT_21,
    candidates: keys.map(([key, title], i) => ({
      key,
      handle: `arXiv ${key.slice(6)}`,
      title,
      authors: ["A. Author"],
      date: "2025",
      url: "",
      verdict: verdicts[i] ?? null,
    })),
  };
}

test("a verdict pressed on the card is kept and said as a line", () => {
  const card = seedCard("Kepler", [["arxiv:2501.00002", "KeplerAgent"]]);
  expect(withSeedVerdict(card, "0:yes").candidates[0].verdict).toBe("yes");
  expect(withSeedVerdict(card, "3:yes")).toBe(card);
  expect(withSeedVerdict(card, "0:maybe")).toBe(card);
  expect(seedVerdictNote(card, "0:no")).toContain("KeplerAgent");
});

test("seeds are the card's yeses and the model's confirmed-in-words, never a 'not it'", () => {
  const cards = [
    seedCard("Kepler", [["arxiv:2501.00002", "KeplerAgent"], ["arxiv:2501.00001", "Symbolic regression at scale"]], ["yes", "no"]),
    seedCard("LLM-SR", [["arxiv:2404.18400", "LLM-SR: Scientific equation discovery"]]),
  ];
  const picked = pickSeeds(cards, ["2404.18400", "arxiv:2501.00001", "arxiv:9999.99999"], OCT_21);
  expect(picked.seeds.map((s) => [s.key, s.said])).toEqual([
    ["arxiv:2501.00002", "Kepler"],
    ["arxiv:2404.18400", "LLM-SR"],
  ]);
  expect(picked.refused).toEqual(["arxiv:2501.00001"]);
  expect(picked.unknown).toEqual(["arxiv:9999.99999"]);
});

test("an academic topic left without sources reads the paper sources; all sources is no field", () => {
  expect(draftSources(undefined, true)).toEqual(["arxiv", "huggingface"]);
  expect(draftSources(undefined, false)).toBeUndefined();
  expect(draftSources(["X", "arxiv", "Hugging Face"], true)).toBeUndefined();
  expect(draftSources(["arxiv"], false)).toEqual(["arxiv"]);
  expect(draftingSourcesLine({ sources: ["arxiv", "huggingface"], academic: true })).toContain("X");
  expect(draftingSourcesLine({})).not.toContain("academic");
});

function search(over: Partial<TopicSearch> = {}): TopicSearch {
  return {
    id: "ts-00000000",
    name: "LLM equation discovery",
    concernId: null,
    scope: "s",
    subtopics: [],
    want: [],
    avoid: [],
    judgments: [],
    anchors: [],
    queries: [{ id: "q1", subtopic: null, x: "equation discovery", arxiv: "equation discovery", ranking: "", weight: 1 }],
    answers: [],
    status: "active",
    revision: 1,
    createdAt: 1,
    lastRunAt: null,
    ...over,
  };
}

test("a config without sources reads them all and splits its first look; one without X does neither", () => {
  expect(topicSources(search())).toEqual(["x", "arxiv", "huggingface"]);
  expect(splitsFirstLook("first", search())).toBe(true);
  const papers = search({ sources: ["arxiv", "huggingface"] });
  expect(splitsFirstLook("first", papers)).toBe(false);
  expect(sourcesOf(null, papers)).toEqual(["arxiv", "huggingface"]);
  expect(sourcesOf("slow", papers)).toEqual([]);
  expect(planRetry(papers, {})).toEqual({ x: [], arxiv: ["q1"], huggingface: ["q1"] });
  expect(planRetry(search({ sources: ["x"] }), {})).toEqual({ x: ["q1"], arxiv: [], huggingface: [] });
});

const noConcern: ConcernPorts = {
  getStatement: async () => null,
  createStatement: async (input) => ({ id: "s-1", ...input }) as never,
  supersede: async () => null,
  addEvidence: async () => null,
  setLapsed: async () => null,
};

const PROPOSE_ARGS = {
  name: "LLM equation discovery",
  scope: "LLMs that find equations and design the next experiment.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: ["equation discovery"],
  queries: [{ subtopic: "", x: "equation discovery", arxiv: "equation discovery", ranking: "" }],
  answers: [],
  concern: "Looking into LLM equation discovery",
  opening: "equation discovery",
};

test("a study's seeds and sources ride the card into the config, and each seed is labelled pinned", async () => {
  const drawn: TopicSearchProposalCardData[] = [];
  const seeds = [seedCard("Kepler", [["arxiv:2501.00002", "KeplerAgent"]], ["yes"])];
  const propose = buildProposeTopicSearchTool({
    threadId: "t1",
    readerLines: () => [{ ts: OCT_21, text: "只看这一次 equation discovery" }],
    searches: async () => [],
    statements: async () => [],
    claims: async () => [],
    seedCards: () => seeds,
    now: () => OCT_21,
    raiseCard: (c) => drawn.push(c),
  });
  const text = textOf(await propose.execute({ ...PROPOSE_ARGS, once: true, academic: true }));
  expect(text).toContain("reads arXiv and Hugging Face");
  const card = drawn[0];
  expect(card.sources).toEqual(["arxiv", "huggingface"]);
  expect(card.seeds?.map((s) => s.key)).toEqual(["arxiv:2501.00002"]);

  // Not a study: no seeds, and the reply says why.
  const plain = textOf(await propose.execute({ ...PROPOSE_ARGS, seeds: ["arxiv:2501.00002"] }));
  expect(drawn[1].seeds).toBeUndefined();
  expect(plain).toContain("only for a study");

  let all: TopicSearch[] = [];
  const labels: TopicLabel[] = [];
  const order: string[] = [];
  const result = await applyTopicSearchProposal(card, {
    concern: noConcern,
    load: async () => all,
    put: async (s) => void (all = [s]),
    addLabels: async (_id, add) => {
      order.push("labels");
      labels.push(...add);
    },
    dispatchFirstRun: async () => void order.push("run"),
    now: () => OCT_21,
    random: () => 0,
  });
  expect(result.ok).toBe(true);
  expect(order).toEqual(["labels", "run"]);
  expect(all[0].sources).toEqual(["arxiv", "huggingface"]);
  expect(all[0].seeds).toEqual([{ key: "arxiv:2501.00002", title: "KeplerAgent", said: "Kepler", at: OCT_21 }]);
  expect(labels.map((l) => `${l.item} ${l.label} ${l.source} ${l.reason} ${l.criteria}`)).toEqual([
    "arxiv:2501.00002 yes seed Kepler 1",
    "arxiv:2501.00002 pinned seed Kepler 1",
  ]);
  expect(latestLabels(labels).get("arxiv:2501.00002")?.label).toBe("pinned");
  expect(labels[0].brief).toBeNull();
});

test("the guidance asks for seeds, keeps X off academic topics and no longer says a study stops", () => {
  const text = topicSearchGuidance({ searches: [search({ once: true, sources: ["arxiv", "huggingface"] })], statements: [] });
  expect(text).toContain("find_seed_paper");
  expect(text).toContain("academic: true");
  expect(text).toContain("a study, reads arXiv and Hugging Face");
  expect(text).not.toContain("stops by itself");
});
