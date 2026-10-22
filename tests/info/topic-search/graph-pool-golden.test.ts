// What a build writes when no graph expansion is on file (docs/info/92 「进候选池」):
// a topic that is not a study, and a study whose runs left no graph-read.json,
// write byte for byte what they wrote before the graph joined the pool. The
// hashes in fixtures/graph-pool-golden.json were taken on the commit before it
// (927bbc62); `GRAPH_GOLDEN_WRITE=1 scripts/t.sh <this file>` writes them again.
// A non-study topic ignores a graph-read.json in its run directory. No network,
// no model: every answer is scripted.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InfoItem } from "../../../src/info/sources/item";
import { makeResultBuilder, type BuildResultDeps, type BuildTopicSearchResultArgs } from "../../../src/info/topic-search/build-result";
import { emptyGraphRead, GRAPH_READ_FILE, withStream, type GraphPaper } from "../../../src/info/topic-search/graph-read";
import type { TopicModelCall } from "../../../src/info/topic-search/model-io";
import type { ArxivFound } from "../../../src/info/topic-search/rank-pool";
import { unread } from "../../../src/info/topic-search/run";
import type { StudyFile } from "../../../src/info/topic-search/study";
import type { TopicSearch } from "../../../src/info/topic-search/types";

const GOLDEN = join(import.meta.dir, "fixtures/graph-pool-golden.json");
const SEARCH_ID = "ts-6b6b6b6b";

const STUDY: TopicSearch = {
  id: SEARCH_ID,
  name: "Symbolic regression",
  concernId: null,
  scope: "Finding equations from data.",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: ["equation", "regression", "symbolic"],
  queries: [
    { id: "q1", subtopic: null, x: "symbolic regression", arxiv: "symbolic regression", ranking: "Is this symbolic regression?", weight: 1 },
    { id: "q2", subtopic: null, x: "equation discovery", arxiv: "equation discovery", ranking: "Is this equation discovery?", weight: 1 },
  ],
  answers: [],
  status: "active",
  revision: 2,
  createdAt: 0,
  lastRunAt: null,
  once: true,
  sources: ["arxiv", "huggingface"],
  seeds: [{ key: "arxiv:2601.00002", title: "Agents that plan their next experiment", said: "the seed paper", at: 1 }],
};
const FOLLOWED: TopicSearch = { ...STUDY, once: false, seeds: [] };

const paper = (n: number, title: string): InfoItem => ({
  id: `arxiv-2601.0000${n}`,
  source: "arxiv",
  sourceName: "arXiv",
  sourceKey: `2601.0000${n}`,
  title,
  url: `https://arxiv.org/abs/2601.0000${n}`,
  publishedAt: "2026-01-10T00:00:00Z",
  textContent: `${title}: symbolic regression, ${title.toLowerCase()}.`,
  summaryOnly: true,
  authors: ["Ada Lovelace"],
});
const P1 = paper(2, "Agents that plan their next experiment");
const P2 = paper(3, "Equation discovery from sparse data");
const P3 = paper(4, "A benchmark for formula fitting");
const TITLES = new Map([P1, P2, P3].map((p) => [p.sourceKey!, p.title]));

const html = (title: string) =>
  `<html><head><title>${title}</title></head><body><article><h2>Abstract</h2><p>${title}.</p>` +
  `<h2>1 Introduction</h2><p>${"Equations are found from data. ".repeat(40)}</p><h2>2 Method</h2><p>${"A model proposes a form and fits it. ".repeat(40)}</p></article></body></html>`;

function model(call: TopicModelCall): Promise<string> {
  if (call.site === "rerank") {
    const items = [...call.user.matchAll(/(c\d+) · paper · .*? · arXiv (\S+)/g)].map((m, i) => ({ c: m[1], score: 80 - i * 5, main: "self", subtopic: null }));
    return Promise.resolve(JSON.stringify({ items }));
  }
  const own = call.user.split("Already in this result (no entries):")[0];
  const blocks = [...own.matchAll(/<material id="(E\d+)">\n[\s\S]*?<\/material>/g)];
  const items = blocks.map((b) => ({
    e: b[1],
    conclusion: "Work on finding equations from data.",
    summary: "Work on finding equations from data.",
    body: ["A model proposes a form and fits it."],
    method: [[{ text: "A model proposes a form and fits it.", cite: [/^(M\d+\.§\d+) /m.exec(b[0])?.[1] ?? "M0.§1"] }]],
    results: [],
  }));
  return Promise.resolve(JSON.stringify({ overview: { text: `Equation discovery leads; see ${blocks[0]?.[1] ?? "E1"}.`, cites: [blocks[0]?.[1] ?? "E1"] }, items }));
}

/** A graph expansion on file that would add a paper no query found, were the topic a study. */
export function graphFixture(): string {
  const g = (n: number, title: string): GraphPaper => ({
    arxivId: `2601.0010${n}`,
    title,
    abstract: `${title}, read off the reader's papers.`,
    authors: ["Grace Hopper"],
    publishedAt: "2026-01-12",
    citationCount: 3,
  });
  let read = emptyGraphRead([{ key: "arxiv:2601.00002", title: P1.title, why: "seed", s2: "s2-seed", openAlex: null, citationCount: 12, walked: true }], []);
  read = withStream(read, { id: "rec", kind: "rec", from: ["arxiv:2601.00002"], library: "s2", outcome: "ok", total: 40, papers: [g(1, "Learning laws of motion from video")], at: "2026-10-21T08:00:00Z" });
  return JSON.stringify(read);
}

function world(topic: TopicSearch, seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  const now = Date.parse("2026-10-21T08:00:00Z");
  const deps: BuildResultDeps = {
    model,
    sleep: async () => {},
    fetchText: async (url) => {
      const id = /arxiv\.org\/html\/(\d{4}\.\d{5})/.exec(url)?.[1];
      return id && TITLES.has(id) ? { status: 200, text: html(TITLES.get(id)!) } : { status: 404, text: "" };
    },
    openLink: async () => ({ ok: false, code: "not_found", reason: "not in this test" }),
    repoLookups: () => ({ lookup: async () => ({ kind: "missing" }) as never, quotaLeft: () => 50 }),
    files: {
      read: async (p) => files.get(p) ?? null,
      write: async (p, c) => void files.set(p, c),
      list: async (prefix) => [...files.keys()].filter((k) => !k.includes("/") && k.startsWith(prefix)),
    },
    profile: async () => [],
    known: async () => [],
    language: async () => "",
    labels: async () => [],
    study: async (): Promise<StudyFile> => ({ version: 1, searchId: SEARCH_ID, lines: [], rollbacks: [] }),
    seedPaper: async () => null,
    now: () => now,
    today: () => "2026-10-21",
  };
  const build = makeResultBuilder(deps);
  const firstArxiv: ArxivFound[] = [{ query: "q1", items: [P1, P3], error: null }];
  const args = (over: Partial<BuildTopicSearchResultArgs>): BuildTopicSearchResultArgs => ({
    topic,
    kind: "first",
    x: unread("unavailable", "not one of the topic's sources"),
    arxiv: [],
    huggingface: [],
    since: now - 365 * 86_400_000,
    runDir: "runs/r-first",
    xPages: { take: async () => true },
    signal: new AbortController().signal,
    ...over,
  });
  return {
    files,
    first: () => build(args({ arxiv: firstArxiv, runId: "r-first" })),
    update: () =>
      build(
        args({
          arxiv: [{ query: "q2", items: [P2], error: null }],
          runDir: "runs/r-up",
          runId: "r-up",
          update: { runId: "r-up", lines: null, queries: ["q2"] },
          carry: async (id) => (id === "r-first" ? { x: null, arxiv: firstArxiv, huggingface: [] } : null),
        }),
      ),
  };
}

const hashes = (files: ReadonlyMap<string, string>, leave: readonly string[] = []) =>
  Object.fromEntries(
    [...files.entries()]
      .filter(([p]) => !leave.includes(p))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([p, c]) => [p, createHash("sha256").update(c).digest("hex")]),
  );

async function outputs() {
  const followed = world(FOLLOWED);
  await followed.first();
  const study = world(STUDY);
  await study.first();
  const firstOnly = hashes(study.files);
  await study.update();
  return { followed: hashes(followed.files), studyFirst: firstOnly, studyUpdated: hashes(study.files) };
}

describe("no graph expansion on file", () => {
  test("a followed topic and a study write what they wrote before the graph joined the pool", async () => {
    const got = await outputs();
    if (process.env.GRAPH_GOLDEN_WRITE === "1") writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as typeof got;
    expect(got).toEqual(golden);
  });

  test("a topic that is not a study ignores a graph expansion in its run directory", async () => {
    const plain = world(FOLLOWED);
    await plain.first();
    const path = `runs/r-first/${GRAPH_READ_FILE}`;
    const withGraph = world(FOLLOWED, { [path]: graphFixture() });
    await withGraph.first();
    expect(hashes(withGraph.files, [path])).toEqual(hashes(plain.files));
  });
});
