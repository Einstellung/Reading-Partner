// Hugging Face's facts of a paper as reference for the models (docs/info/88
// 「打分」「结果」): the Hub line in the rerank and the write-up prompts, the
// number check taking the Hub's counts but not its machine-written summary,
// the Hub's repository read as the paper's second original, and the facts kept
// on the result item. The final score does not use them. Everything scripted;
// no network.

import { expect, test } from "bun:test";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import type { InfoItem } from "../../../src/info/sources/item";
import type { RepoLookup } from "../../../src/info/sources/plugins/github-lookup";
import { makeResultBuilder, targetsOf, type Draft } from "../../../src/info/topic-search/build-result";
import { checkWritten, composePrompt, type ComposeInput } from "../../../src/info/topic-search/compose";
import { HUB_RULE, hubLine, hubLines, hubSummaryLine, repoName } from "../../../src/info/topic-search/hub-line";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import { numberPool, rerankPrompt, scorePool, type Candidate, type HubFacts, type PaperInfo } from "../../../src/info/topic-search/rank-pool";
import { parseResultFile, type TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import { unread } from "../../../src/info/topic-search/run";
import type { TopicSearch } from "../../../src/info/topic-search/types";
import { readmeAnswer } from "./readme-answer";

const TOPIC: TopicSearch = {
  id: "ts-0a1b2c3d",
  name: "Symbolic regression",
  concernId: null,
  scope: "Symbolic regression for physics.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [{ id: "q1", subtopic: null, x: "symbolic regression", arxiv: "symbolic regression", ranking: "", weight: 1 }],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
};

const HUB: HubFacts = {
  repo: "https://github.com/Fern-Lab/sr-former.git",
  stars: 1340,
  upvotes: 57,
  projectPage: "https://fern-lab.github.io/sr-former",
  aiSummary: "SR-Former recovers 93 percent of the Feynman equations.",
};

function paperCand(id: string, hub?: HubFacts): Candidate {
  const paper: PaperInfo = {
    id,
    title: "Symbolic regression with transformers",
    abstract: "We train a transformer for symbolic regression.",
    authors: ["Ada Lovelace"],
    publishedAt: "2026-10-05",
    url: `https://arxiv.org/abs/${id}`,
    ...(hub ? { hub } : {}),
  };
  return {
    key: `arxiv:${id}`,
    kind: "paper",
    source: hub ? "huggingface" : "arxiv",
    queries: ["q1"],
    foundIn: ["q1|huggingface"],
    text: `${paper.title}\n\n${paper.abstract}`,
    author: "Ada Lovelace",
    at: Date.parse("2026-10-05"),
    post: null,
    paper,
    links: [],
    relevance: 0.5,
    engagement: null,
    mentionsAnchor: true,
    order: 0,
  };
}

test("the Hub line names the counts and the repository, the summary is labelled machine-written and cut", () => {
  expect(repoName(HUB.repo!)).toBe("Fern-Lab/sr-former");
  expect(hubLine(HUB)).toBe("Hugging Face: 57 upvotes; GitHub repository Fern-Lab/sr-former (1340 stars); has a project page");
  expect(hubLine({ upvotes: 2 })).toBe("Hugging Face: 2 upvotes");
  expect(hubLine({ aiSummary: "only a summary" })).toBeNull();
  expect(hubLine(undefined)).toBeNull();
  expect(hubSummaryLine(HUB)).toBe("Hugging Face's machine-written summary (unchecked): SR-Former recovers 93 percent of the Feynman equations.");
  expect(hubSummaryLine({ aiSummary: "word ".repeat(100) }, 40)!.endsWith("…")).toBe(true);
  expect(hubLines({})).toEqual([]);
});

test("the rerank sees the Hub line inside the paper's material, and is told it is reference only", () => {
  const numbered = numberPool([
    { cand: paperCand("2610.00001", HUB), rrf: 80 },
    { cand: paperCand("2610.00002"), rrf: 70 },
  ]);
  const { system, user } = rerankPrompt(TOPIC, numbered, [], "");
  expect(system).toContain(HUB_RULE);
  const c1 = /<material id="c1">[\s\S]*?<\/material>/.exec(user)![0];
  const c2 = /<material id="c2">[\s\S]*?<\/material>/.exec(user)![0];
  expect(c1).toContain("Hugging Face: 57 upvotes; GitHub repository Fern-Lab/sr-former (1340 stars); has a project page");
  expect(c1).toContain("Hugging Face's machine-written summary (unchecked): SR-Former recovers");
  // The URLs stay with the program.
  expect(c1).not.toContain("https://github.com");
  expect(c1).not.toContain("fern-lab.github.io");
  expect(c2).not.toContain("Hugging Face");
});

test("the Hub's counts are no score term: the same paper scores the same with them and without", () => {
  const answers = new Map([["c1", { score: 70, main: "self", subtopic: null, doubt: null }]]);
  const score = (hub?: HubFacts) => scorePool(TOPIC, numberPool([{ cand: paperCand("2610.00001", hub), rrf: 50 }]), answers)[0].score;
  expect(score(HUB)).toBe(score());
});

function paperItem(over: Partial<TopicSearchResultItem> = {}): TopicSearchResultItem {
  return {
    id: "E1",
    key: "arxiv:2610.00001",
    keys: ["arxiv:2610.00001"],
    kind: "paper",
    subtopic: null,
    title: "Symbolic regression with transformers",
    titleFrom: "original",
    summary: null,
    facts: { kind: "paper", arxivId: "2610.00001", authors: ["Ada Lovelace"], publishedAt: "2026-10-05", depth: "abstract" },
    links: { original: "https://arxiv.org/abs/2610.00001", posts: [] },
    materials: [],
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score: 70,
    ...over,
  };
}

function input(items: TopicSearchResultItem[]): ComposeInput {
  return {
    topic: TOPIC,
    kind: "daily",
    items,
    registry: new MaterialRegistry("r", { write: async () => {} }),
    profile: [],
    questions: [],
    language: "",
  };
}

test("the write-up sees the Hub lines; its sentences may cite the Hub's counts but not a number from its summary", () => {
  const withHub = input([paperItem({ hub: HUB })]);
  const { system, user } = composePrompt(withHub);
  expect(system).toContain(HUB_RULE);
  expect(user).toContain("Hugging Face: 57 upvotes; GitHub repository Fern-Lab/sr-former (1340 stars); has a project page");
  expect(user).toContain("Hugging Face's machine-written summary (unchecked)");
  expect(composePrompt(input([paperItem()])).user).not.toContain("Hugging Face");

  const reply = (body: string) =>
    JSON.stringify({ overview: { text: "One paper; see E1.", cites: ["E1"] }, items: [{ e: "E1", conclusion: "A transformer does symbolic regression.", body: [body], unknown: null }] });
  const cited = checkWritten(reply("It drew 57 upvotes on Hugging Face, and its repository has 1,340 stars."), withHub);
  expect(cited.problems).toEqual([]);
  const fromSummary = checkWritten(reply("It recovers 93 percent of the Feynman equations."), withHub);
  expect(fromSummary.problems).toEqual(["E1's sentences have numbers its materials do not hold: 93."]);
  // Without the Hub's facts the counts are not the item's to cite.
  expect(checkWritten(reply("It drew 57 upvotes."), input([paperItem()])).problems).toEqual(["E1's sentences have numbers its materials do not hold: 57."]);
});

function draftOf(cands: Candidate[], leadKey: string): Draft {
  const members = cands.map((cand, i) => ({ id: `c${i + 1}`, kind: cand.kind, key: cand.key, score: 60, text: cand.text, cand, rerank: null, rrf: 50, subtopic: null, mainUrl: null }));
  const events = members.map((m) => ({ key: m.key, members: [m] }));
  return { cluster: { events, lead: events.find((e) => e.key === leadKey)!, score: 60 }, members } as unknown as Draft;
}

test("the Hub's repository is the paper's second original; papers still come first and two originals at most", () => {
  expect(targetsOf(draftOf([paperCand("2610.00001", HUB)], "arxiv:2610.00001"))).toEqual([
    { kind: "paper", id: "2610.00001", known: paperCand("2610.00001", HUB).paper },
    { kind: "repo", owner: "fern-lab", repo: "sr-former", url: "https://github.com/fern-lab/sr-former" },
  ]);
  // A second paper in the item takes the second place ahead of the repository.
  const two = targetsOf(draftOf([paperCand("2610.00001", HUB), paperCand("2610.00003")], "arxiv:2610.00001"));
  expect(two.map((t) => t.kind)).toEqual(["paper", "paper"]);
  // A repository URL that is not GitHub's is not read.
  expect(targetsOf(draftOf([paperCand("2610.00001", { repo: "https://gitlab.com/a/b" })], "arxiv:2610.00001")).map((t) => t.kind)).toEqual(["paper"]);
});

function hfItem(id: string, title: string, abstract: string, signals: InfoItem["signals"]): InfoItem {
  return {
    id: `huggingface-${id}`,
    source: "huggingface",
    sourceName: "Hugging Face",
    sourceKey: id,
    title,
    url: `https://arxiv.org/abs/${id}`,
    publishedAt: "2026-10-05",
    textContent: abstract,
    summaryOnly: true,
    ...(signals ? { signals } : {}),
  };
}

test("a run's result item keeps the Hub's facts, and the repository is read beside the paper", async () => {
  const files = new Map<string, string>();
  const log: TopicModelCall[] = [];
  const fetched: string[] = [];
  const lookups: string[] = [];
  const now = Date.parse("2026-10-19T12:00:00Z");
  const build = makeResultBuilder({
    model: async (call) => {
      log.push(call);
      if (call.site === "rerank") {
        const items = [...call.user.matchAll(/(c\d+) · paper/g)].map((m) => ({ c: m[1], score: 80, main: "self", subtopic: null }));
        return JSON.stringify({ items });
      }
      if (call.site === "dedupe") return JSON.stringify({ verdicts: [] });
      const ids = [...call.user.matchAll(/<material id="(E\d+)">/g)].map((m) => m[1]);
      return JSON.stringify({
        overview: { text: `Symbolic regression papers; see ${ids[0]}.`, cites: [ids[0]] },
        items: ids.map((e) => ({ e, conclusion: "A transformer does symbolic regression.", body: ["It is a paper."], unknown: null })),
      });
    },
    fetchText: async (url) => {
      fetched.push(url);
      if (url === "https://api.github.com/repos/fern-lab/sr-former/readme") return readmeAnswer("# SR-Former\n\nSymbolic regression with transformers.");
      return { status: 404, text: "" };
    },
    openLink: async () => ({ ok: false, code: "not_found", reason: "not here" }),
    repoLookups: () => ({
      lookup: async (name): Promise<RepoLookup> => {
        lookups.push(name);
        return {
          kind: "found",
          facts: { fullName: name, url: `https://github.com/${name}`, description: null, stars: 1338, forks: 40, createdAt: "2026-09-01T00:00:00Z", defaultBranch: "main", lastCommitAt: "2026-10-10T08:00:00Z", release: null, license: "MIT" },
        };
      },
      quotaLeft: () => 50,
    }),
    files: {
      read: async (p) => files.get(p) ?? null,
      write: async (p, c) => void files.set(p, c),
      list: async (prefix) => [...files.keys()].filter((k) => !k.includes("/") && k.startsWith(prefix)),
    },
    profile: async () => [],
    language: async () => "",
    now: () => now,
    today: () => "2026-10-19",
  });
  const out = await build({
    topic: TOPIC,
    kind: "first",
    x: unread("unavailable", "test"),
    arxiv: [],
    huggingface: [
      {
        query: "q1",
        items: [
          hfItem("2610.00001", "Symbolic regression with transformers", "A transformer reads data points and writes the formula: symbolic regression.", { upvotes: 57, stars: 1340, repo: HUB.repo, projectPage: HUB.projectPage, aiSummary: HUB.aiSummary }),
          hfItem(
            "2610.00002",
            "Graph networks find conservation laws in particle data",
            "Message passing over particle tracks finds conserved quantities; a symbolic regression step writes each as a formula.",
            undefined,
          ),
        ],
        error: null,
        ladder: { outcome: "direct", steps: [] },
      },
    ],
    since: now - 365 * 86_400_000,
    runDir: "runs/hub",
    xPages: { take: async () => true },
    signal: new AbortController().signal,
  });
  const result = parseResultFile(files.get(out.resultFile!)!)!;
  const withHub = result.items.find((i) => i.key === "arxiv:2610.00001")!;
  const without = result.items.find((i) => i.key === "arxiv:2610.00002")!;
  expect(withHub.hub).toEqual({ repo: HUB.repo, stars: 1340, upvotes: 57, projectPage: HUB.projectPage, aiSummary: HUB.aiSummary });
  expect(without.hub).toBeUndefined();
  // The paper leads; the repository is read as its second original.
  expect(withHub.facts.kind).toBe("paper");
  expect(withHub.links.original).toBe("https://arxiv.org/abs/2610.00001");
  expect(lookups).toEqual(["fern-lab/sr-former"]);
  expect(result.materials.filter((m) => withHub.materials.includes(m.id)).map((m) => m.reader)).toEqual(["arxiv", "github"]);
  expect(log.find((c) => c.site === "rerank")!.user).toContain("Hugging Face: 57 upvotes");
  expect(log.find((c) => c.site === "write")!.user).toContain("Hugging Face: 57 upvotes; GitHub repository Fern-Lab/sr-former (1340 stars)");
});
