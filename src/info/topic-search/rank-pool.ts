// The rank phase of a topic search run (docs/info/88 「打分」 1-6): what the X
// reader and the arXiv and Hugging Face searches brought, as candidates (one
// paper found by both is one candidate, by arXiv id, carrying the Hub's facts); the local relevance
// floor; weighted RRF over the (query, source) streams; the rerank call and its
// stand-in; the final score; candidates merged into events. A study's graph
// expansion (docs/info/92 「进候选池」, graph-read.ts) adds a stream per read —
// recommendations, and each walked paper's citations and references — whose
// papers merge with what the queries found by arXiv id.
//
// Every candidate is numbered by the program (c1, c2 …, its links c1.a, c1.b
// …) and the model answers by number only; an answer naming a number that does
// not exist is dropped.

import type { InfoItem } from "../sources/item";
import { normalizeArxivId } from "../sources/plugins/arxiv-client";
import type { ArxivLadder } from "./arxiv-ladder";
import { xEngagement } from "../rank/engagement";
import { arxivEventKey, eventKeyOfUrl, mergeIntoEvents, xEventKey, type EventCluster, type EventMember } from "../rank/events";
import { weightedRrf, type Stream } from "../rank/fusion";
import { localRelevance, prepareQuery, RELEVANCE_FLOOR } from "../rank/relevance";
import { finalScore } from "../rank/score";
const DAY_MS = 86_400_000;
import type { XSearchPost } from "../x/search-page";
import { postLinksOut } from "../x/text-links";
import { cut, letter, material, parseJsonReply, UNTRUSTED_RULE } from "./model-io";
import { RETRIED_OUTCOMES, type GraphRead, type GraphStream } from "./graph-read";
import { HUB_RULE, hubLines } from "./hub-line";
import type { HubFacts, ResultVia } from "./result-types";
import type { TopicQuery, TopicSearch } from "./types";
import type { XReadResult } from "./x-reader";

/** Candidates sent to the rerank: a day's run, and a first run's. */
export const RERANK_POOL = { daily: 40, first: 60 } as const;
/** Candidates each stream gives the fusion: an X line reads hundreds, an arXiv search a page. */
export const STREAM_TAKE = { x: 40, arxiv: 12, huggingface: 12 } as const;
/**
 * Places in the rerank pool kept, by fusion order, for posts and for the
 * candidates each picked subtopic's queries found, so that the result's
 * reservations (select.ts) have something reranked to take; and for papers
 * only a study's graph expansion found, which the queries' streams outweigh.
 */
export const POOL_RESERVE = { posts: 10, perSubtopic: 4, graph: 12 } as const;
/**
 * A graph stream's weight in the fusion, by kind (docs/info/92 「进候选池」):
 * recommendations, papers citing one of the reader's, papers one of them cites.
 * Recommendations OpenAlex stood in for (related works, no negatives) weigh
 * GRAPH_REC_OPENALEX_WEIGHT.
 */
export const GRAPH_WEIGHT = { rec: 0.8, cites: 0.6, refs: 0.5 } as const;
export const GRAPH_REC_OPENALEX_WEIGHT = 0.5;
/** Candidates each graph stream gives the fusion, by kind. */
export const GRAPH_TAKE = { rec: 20, cites: 8, refs: 8 } as const;
/** Characters of a candidate's text the rerank sees. */
export const RERANK_TEXT_CHARS = 420;
/** Links of one post the rerank is shown. */
const MAX_LINKS = 8;

export interface PaperInfo {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string | null;
  url: string;
  /** What Hugging Face's paper search said of it, when the Hub found it. */
  hub?: HubFacts;
}

export type { HubFacts };

/** "graph": only a study's graph expansion found it; one a query found too is the query's source's. */
export type CandidateSource = "x" | "arxiv" | "huggingface" | "graph";

const PAPER_SOURCES = ["arxiv", "huggingface"] as const;

export interface Candidate {
  /** "x:<status id>" or "arxiv:<id>". */
  key: string;
  kind: "post" | "paper";
  source: CandidateSource;
  /** Ids of the queries that found it, first finder first. */
  queries: string[];
  /** The (query, source) streams that found it (streamKey), first finder first. */
  foundIn: string[];
  /** What relevance and the anchors are measured on: a post's text and its quoted post's; a paper's title and abstract. */
  text: string;
  author: string;
  at: number;
  post: XSearchPost | null;
  paper: PaperInfo | null;
  /** The post's links whose target is known, in its order. */
  links: { url: string; card: boolean }[];
  /** Best local relevance over the queries that found it. */
  relevance: number;
  engagement: number | null;
  order: number;
  /** A study's: the graph streams that found it, by kind (docs/info/92). Absent when none did. */
  via?: ResultVia[];
}

/** One arXiv (or Hugging Face) search's answer: the query it ran and what came back, or why it failed. */
export interface ArxivFound {
  query: string;
  items: InfoItem[];
  error: string | null;
  /** How the query's ladder went (arxiv-ladder.ts), for the source health. */
  ladder?: ArxivLadder;
}

/** "q1|x", "q1|arxiv", "q1|huggingface": a (query, source) stream; "rec|graph", "cites:arxiv:…|graph": a graph stream. */
export function streamKey(query: string, source: CandidateSource): string {
  return `${query}|${source}`;
}

const isGraphStream = (key: string): boolean => key.endsWith("|graph");

/**
 * A study's graph expansion as its pool takes it: the streams of every run's
 * read, oldest first, one per stream id, and the titles of the reader's papers
 * they walked from, by key. A later read of a stream replaces an earlier one,
 * unless it came back without an answer (a rate limit, a cooldown, a failure).
 * Null when no read was on file: the pool is the queries' alone.
 */
export interface GraphPool {
  streams: GraphStream[];
  titles: Map<string, string>;
}

export function graphPool(reads: readonly (GraphRead | null)[]): GraphPool | null {
  const got = reads.filter((r): r is GraphRead => r !== null);
  if (!got.length) return null;
  const streams = new Map<string, GraphStream>();
  for (const s of got.flatMap((r) => r.streams)) {
    if (streams.has(s.id) && RETRIED_OUTCOMES.includes(s.outcome)) continue;
    streams.set(s.id, s);
  }
  return { streams: [...streams.values()], titles: new Map(got.flatMap((r) => r.positives.map((p) => [p.key, p.title] as const))) };
}

/** Ways in merged by kind, each kind's papers once, in the order first seen. */
export function mergeVia(lists: readonly (readonly ResultVia[] | undefined)[]): ResultVia[] {
  const out: ResultVia[] = [];
  for (const v of lists.flatMap((l) => l ?? [])) {
    const same = out.find((o) => o.kind === v.kind);
    if (!same) out.push({ kind: v.kind, from: [...v.from] });
    else for (const key of v.from) if (!same.from.includes(key)) same.from.push(key);
  }
  return out;
}

/**
 * An X query as words: operators (`-filter:retweets`, `lang:en`, `since:`),
 * excluded words, quotes and OR taken out.
 */
export function plainQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("-") && !/^[a-z_]+:/i.test(w) && w !== "OR")
    .join(" ")
    .replace(/["()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The query a reader line names: its key is the search id and the query id. */
export function queryOfLine(topic: TopicSearch, lineKey: string): TopicQuery | null {
  return (
    topic.queries.find(
      (q) => lineKey === q.id || lineKey.endsWith(`:${q.id}`) || lineKey.endsWith(`/${q.id}`) || lineKey.endsWith(`|${q.id}`),
    ) ?? null
  );
}

export interface Gathered {
  /** Every candidate, floor or not, after merging. */
  all: Candidate[];
  /** Past the relevance floor. */
  kept: Candidate[];
  /** Per stream: candidate keys read, and those past the floor. */
  streams: Map<string, { read: string[]; kept: string[] }>;
}

/** The Hub's facts off an item its paper search gave; undefined when it carries none. */
function hubOf(item: InfoItem): HubFacts | undefined {
  const s = item.signals;
  if (!s) return undefined;
  const hub: HubFacts = {};
  if (s.repo) hub.repo = s.repo;
  if (s.stars !== undefined) hub.stars = s.stars;
  if (s.upvotes !== undefined) hub.upvotes = s.upvotes;
  if (s.projectPage) hub.projectPage = s.projectPage;
  if (s.aiSummary) hub.aiSummary = s.aiSummary;
  return Object.keys(hub).length ? hub : undefined;
}

function paperOf(item: InfoItem, source: CandidateSource): PaperInfo | null {
  const id = normalizeArxivId(item.sourceKey ?? item.url);
  if (!id) return null;
  const hub = source === "huggingface" ? hubOf(item) : undefined;
  return {
    id,
    title: item.title,
    abstract: item.textContent ?? item.summary ?? "",
    authors: item.authors ?? [],
    publishedAt: item.publishedAt || null,
    url: `https://arxiv.org/abs/${id}`,
    ...(hub ? { hub } : {}),
  };
}

/**
 * Normalize, merge by identity, measure relevance and anchors (88 「打分」 1-2).
 * A paper both arXiv and Hugging Face found is one candidate: arXiv's entry
 * (its v1 date) with the Hub's facts added. A study's graph streams (`graph`,
 * graphPool) add their papers last: one a query found too keeps that entry and
 * gains the stream. Whatever a graph stream found passes the relevance floor;
 * a paper only the graph found is measured against every query, for the order
 * and the record.
 */
export function gatherCandidates(
  topic: TopicSearch,
  x: XReadResult,
  arxiv: readonly ArxivFound[],
  since: number,
  huggingface: readonly ArxivFound[] = [],
  graph: readonly GraphStream[] = [],
): Gathered {
  const byKey = new Map<string, Candidate>();
  const streams = new Map<string, { read: string[]; kept: string[] }>();
  const queries = new Map(topic.queries.map((q) => [q.id, q]));
  const touch = (stream: string, key: string) => {
    const s = streams.get(stream) ?? { read: [], kept: [] };
    if (!s.read.includes(key)) s.read.push(key);
    streams.set(stream, s);
  };

  for (const { line, post } of x.posts) {
    const query = queryOfLine(topic, line);
    if (!query) continue;
    // 88 「打分」 1: a page time more than a day off the id's is a misread post.
    if (post.shownAt !== null && Math.abs(post.shownAt - post.postedAt) > DAY_MS) continue;
    const key = xEventKey(post.id);
    const stream = streamKey(query.id, "x");
    touch(stream, key);
    const got = byKey.get(key);
    if (got) {
      if (!got.queries.includes(query.id)) got.queries.push(query.id);
      if (!got.foundIn.includes(stream)) got.foundIn.push(stream);
      continue;
    }
    const text = [post.text, post.quoted ? post.quoted.text : ""].filter(Boolean).join("\n\n");
    byKey.set(key, {
      key,
      kind: "post",
      source: "x",
      queries: [query.id],
      foundIn: [stream],
      text,
      author: post.handle,
      at: post.postedAt,
      post,
      paper: null,
      // The text's own links too: a link the page gave without t.co, or that the text only names (pitfall 657).
      links: postLinksOut(post),
      relevance: 0,
      engagement: xEngagement(post.counts),
      order: byKey.size,
    });
  }

  for (const source of PAPER_SOURCES) {
    for (const found of source === "arxiv" ? arxiv : huggingface) {
      if (!queries.has(found.query)) continue;
      const stream = streamKey(found.query, source);
      if (!streams.has(stream)) streams.set(stream, { read: [], kept: [] });
      for (const item of found.items) {
        const paper = paperOf(item, source);
        const key = paper ? arxivEventKey(paper.id) : null;
        if (!paper || !key) continue;
        touch(stream, key);
        const got = byKey.get(key);
        if (got) {
          if (!got.queries.includes(found.query)) got.queries.push(found.query);
          if (!got.foundIn.includes(stream)) got.foundIn.push(stream);
          if (paper.hub && got.paper && !got.paper.hub) got.paper.hub = paper.hub;
          continue;
        }
        const at = paper.publishedAt ? Date.parse(paper.publishedAt) : NaN;
        byKey.set(key, {
          key,
          kind: "paper",
          source,
          queries: [found.query],
          foundIn: [stream],
          text: `${paper.title}\n\n${paper.abstract}`,
          author: paper.authors[0] ?? "",
          at: Number.isFinite(at) ? at : since,
          post: null,
          paper,
          links: [],
          relevance: 0,
          engagement: null,
          order: byKey.size,
        });
      }
    }
  }

  for (const g of graph) {
    const stream = streamKey(g.id, "graph");
    if (!streams.has(stream)) streams.set(stream, { read: [], kept: [] });
    const via: ResultVia[] = [{ kind: g.kind, from: g.from }];
    for (const p of g.papers) {
      const id = normalizeArxivId(p.arxivId);
      const key = id ? arxivEventKey(id) : null;
      if (!id || !key) continue;
      touch(stream, key);
      const got = byKey.get(key);
      if (got) {
        if (!got.foundIn.includes(stream)) got.foundIn.push(stream);
        got.via = mergeVia([got.via, via]);
        continue;
      }
      const at = p.publishedAt ? Date.parse(p.publishedAt) : NaN;
      byKey.set(key, {
        key,
        kind: "paper",
        source: "graph",
        queries: [],
        foundIn: [stream],
        text: `${p.title}\n\n${p.abstract}`,
        author: p.authors[0] ?? "",
        at: Number.isFinite(at) ? at : since,
        post: null,
        paper: { id, title: p.title, abstract: p.abstract, authors: p.authors, publishedAt: p.publishedAt || null, url: `https://arxiv.org/abs/${id}` },
        links: [],
        relevance: 0,
        engagement: null,
        order: byKey.size,
        via: mergeVia([via]),
      });
    }
  }

  const all = [...byKey.values()];
  const kept: Candidate[] = [];
  for (const c of all) {
    const measured = c.source === "graph" ? topic.queries : c.queries.map((id) => queries.get(id));
    c.relevance = Math.max(0, ...measured.map((q) => relevanceTo(q, c)));
    // No window filter here: the X lines and the arXiv search already read only
    // their window, and a seen post read again is what continuation looks for.
    const lexical = c.relevance >= RELEVANCE_FLOOR;
    if (!lexical && !c.foundIn.some(isGraphStream)) continue;
    kept.push(c);
    // A query's stream keeps only what passed the floor.
    for (const stream of c.foundIn) if (lexical || isGraphStream(stream)) streams.get(stream)?.kept.push(c.key);
  }
  return { all, kept, streams };
}

/**
 * The words a candidate's local relevance is measured on, for the build and
 * for the X reader's permalink floor alike: the query as searched on that
 * source. Never the ranking question: it is written in the reader's language
 * and the posts often are not (pitfall 660).
 */
export function relevanceBasis(query: Pick<TopicQuery, "x" | "arxiv">, source: CandidateSource): string {
  return source === "x" ? plainQuery(query.x) : (query.arxiv ?? plainQuery(query.x));
}

function relevanceTo(query: TopicQuery | undefined, c: Candidate): number {
  if (!query) return 0;
  return localRelevance(prepareQuery(relevanceBasis(query, c.source)), c.text);
}

/**
 * Weighted RRF over the (query, source) streams and a study's graph streams
 * (in their library's order, GRAPH_WEIGHT, GRAPH_TAKE), the per-author cap, the
 * pool's top (88 「打分」 3), with places kept for posts, for each picked
 * subtopic and for what only the graph found (POOL_RESERVE). A paper several
 * streams found adds up across them: several of the reader's papers citing it
 * is co-citation. The pool stays in fusion order.
 */
export function fusePool(
  topic: TopicSearch,
  kept: readonly Candidate[],
  size: number,
  graph: readonly GraphStream[] = [],
): { cand: Candidate; rrf: number }[] {
  const byKey = new Map(kept.map((c) => [c.key, c]));
  const streams: Stream[] = [];
  for (const q of topic.queries) {
    for (const source of ["x", ...PAPER_SOURCES] as const) {
      const members = kept
        // A paper under the floor is in the pool for its graph streams only.
        .filter((c) => c.foundIn.includes(streamKey(q.id, source)) && c.relevance >= RELEVANCE_FLOOR)
        .map((c) => ({ c, r: relevanceTo(q, c) }))
        // A live line is newest first; its stream is ranked by how well each post answers the query.
        .sort((a, b) => b.r - a.r || a.c.order - b.c.order);
      if (members.length) {
        streams.push({ weight: q.weight, take: STREAM_TAKE[source], items: members.map(({ c }) => ({ key: c.key, author: c.author })) });
      }
    }
  }
  for (const g of graph) {
    const key = streamKey(g.id, "graph");
    const items = g.papers
      .map((p) => byKey.get(arxivEventKey(p.arxivId) ?? ""))
      .filter((c): c is Candidate => c !== undefined && c.foundIn.includes(key))
      .map((c) => ({ key: c.key, author: c.author }));
    const weight = g.kind === "rec" && g.library === "openalex" ? GRAPH_REC_OPENALEX_WEIGHT : GRAPH_WEIGHT[g.kind];
    if (items.length) streams.push({ weight, take: GRAPH_TAKE[g.kind], items });
  }
  const fused = weightedRrf(streams);
  const subtopicOf = new Map(topic.queries.map((q) => [q.id, q.subtopic]));
  const must: string[] = [];
  const reserve = (n: number, fits: (c: Candidate) => boolean) => {
    let found = 0;
    for (const f of fused) {
      if (found >= n) break;
      if (!fits(byKey.get(f.key)!)) continue;
      found++;
      if (!must.includes(f.key)) must.push(f.key);
    }
  };
  reserve(POOL_RESERVE.posts, (c) => c.kind === "post");
  for (const s of topic.subtopics) {
    if (s.picked) reserve(POOL_RESERVE.perSubtopic, (c) => c.queries.some((id) => subtopicOf.get(id) === s.id));
  }
  reserve(POOL_RESERVE.graph, (c) => c.source === "graph");
  const inPool = new Set(must.slice(0, size));
  for (const f of fused) {
    if (inPool.size >= size) break;
    inPool.add(f.key);
  }
  return fused.filter((f) => inPool.has(f.key)).map((f) => ({ cand: byKey.get(f.key)!, rrf: f.score }));
}

export interface Numbered {
  c: string;
  cand: Candidate;
  rrf: number;
  links: { id: string; url: string; card: boolean }[];
}

export function numberPool(pool: readonly { cand: Candidate; rrf: number }[]): Numbered[] {
  return pool.map(({ cand, rrf }, i) => {
    const c = `c${i + 1}`;
    return { c, cand, rrf, links: cand.links.slice(0, MAX_LINKS).map((l, j) => ({ id: `${c}.${letter(j)}`, ...l })) };
  });
}

export interface RerankAnswer {
  score: number;
  /** "self", or the link number the content really is ("c3.a"). */
  main: string;
  subtopic: string | null;
  doubt: string | null;
  /**
   * A study update's rerank only (docs/info/91 更新): the confirmed line ("L2")
   * that put this candidate in or kept it out; null when none did.
   */
  because?: string | null;
}

/**
 * What a study update's rerank sees besides the topic (docs/info/91 更新): the
 * lines the reader confirmed, numbered L1 …, and items the reader labelled on
 * or off the mark, as examples.
 */
export interface StudyRerank {
  lines: readonly { id: string; kind: string; text: string }[];
  examples: readonly { label: "yes" | "borderline" | "no"; title: string; reason: string }[];
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The topic as the rerank and the write-up see it. */
export function topicBlock(topic: TopicSearch, profile: readonly string[]): string {
  const lines = [`Topic: ${topic.name}`, `Scope: ${topic.scope}`];
  const picked = topic.subtopics.filter((s) => s.picked);
  if (picked.length) lines.push("Subtopics:", ...picked.map((s) => `- ${s.id}: ${s.name}`));
  if (topic.want.length) lines.push(`Wants: ${topic.want.join("; ")}`);
  if (topic.avoid.length) lines.push(`Does not want: ${topic.avoid.join("; ")}`);
  if (topic.judgments.length) lines.push(`Judgements the reader accepted: ${topic.judgments.join("; ")}`);
  if (profile.length) lines.push("About the reader:", ...profile.map((p) => `- ${p}`));
  return lines.join("\n");
}

/** Questions shown to a prompt as already raised, newest last. */
export const RAISED_SHOWN = 20;

/**
 * What the reader has already answered and what was already asked, for a
 * prompt that may raise questions. Empty when there is neither. `raised` is the
 * topic's earlier questions, oldest first; the newest RAISED_SHOWN are shown.
 */
export function settledBlock(topic: TopicSearch, raised: readonly string[]): string {
  const answered = topic.answers.map((a) => `- Asked "${a.asked}", answered "${a.answer}"`);
  const asked = raised.slice(-RAISED_SHOWN).map((q) => `- ${q}`);
  return [
    ...(answered.length ? ["The reader's earlier answers:", ...answered] : []),
    ...(asked.length ? ["Questions already raised (never ask them again, in any wording):", ...asked] : []),
  ].join("\n");
}

/** The rerank's rule when a candidate came in through the reader's papers (docs/info/92 「进候选池」). */
export const VIA_RULE =
  'A "Found through" line says how the reader\'s own papers led to a candidate: recommended from them, citing one, cited by one. ' +
  "That says nothing about whether it is on the topic: judge it by its title and abstract alone, as any other.";

/** The reader's papers a "Found through" line names, at most, per kind. */
const VIA_NAMED = 3;

/**
 * How the graph led to a candidate, for the rerank: "Found through:
 * recommended from the reader's papers; cites "…"; cited by "…"". `titles`:
 * the reader's papers by key (graphPool). Null when no graph stream found it.
 */
export function viaLine(via: readonly ResultVia[] | undefined, titles: ReadonlyMap<string, string>): string | null {
  const name = (key: string) => `"${cut(titles.get(key) ?? key.replace(/^arxiv:/, "arXiv "), 80)}"`;
  const names = (keys: readonly string[]) =>
    keys.slice(0, VIA_NAMED).map(name).join(", ") + (keys.length > VIA_NAMED ? ` and ${keys.length - VIA_NAMED} more` : "");
  const parts = (via ?? []).flatMap((v) =>
    v.kind === "rec" ? ["recommended from the reader's papers"] : v.kind === "cites" ? [`cites ${names(v.from)}`] : v.kind === "refs" ? [`cited by ${names(v.from)}`] : [],
  );
  return parts.length ? `Found through: ${parts.join("; ")}` : null;
}

/** The rule both question-raising prompts give the model (docs/info/88 「攒着问」). */
export const SETTLED_RULE =
  "Never ask what the scope, wants, does-not-wants, accepted judgements, the reader's earlier answers or an already raised question settle: " +
  "a question about a kind of thing a judgement or a does-not-want already places is a repeat. Ask only what none of them decides.";

/**
 * The rerank's prompt. `titles`: a study's graph expansion's papers by key
 * (graphPool), to name in a candidate's "Found through" line.
 */
export function rerankPrompt(
  topic: TopicSearch,
  numbered: readonly Numbered[],
  profile: readonly string[],
  language: string,
  raised: readonly string[] = [],
  study: StudyRerank | null = null,
  titles: ReadonlyMap<string, string> = new Map(),
): { system: string; user: string } {
  const lines = study?.lines ?? [];
  const graphed = numbered.some((n) => n.cand.via?.length);
  const system = [
    "You rank what a topic search found for a reader: posts from X and papers from arXiv and Hugging Face.",
    `For every candidate answer one object {c, score, main, subtopic, doubt${lines.length ? ", because" : ""}}:`,
    "- c: the candidate's number as given (c1, c2 …).",
    "- score: 0-100, how well it serves the topic as the reader defined it (scope, subtopics, wants, does-not-wants, the query questions). Promotion, event hype, giveaways and engagement bait score under 20.",
    '- main: what the candidate really is. "self" when the post itself (or the paper) is the content; the number of one of its links (c3.a) when the post points at the real thing — a paper, a repository, an article. Most posts are lead-ins.',
    "- subtopic: the id of the subtopic it belongs to, or null.",
    "- doubt: only when you cannot tell whether the reader wants this kind of thing, one short question to ask them (\"Do you want funding news about AI chip design?\"); otherwise null.",
    ...(lines.length
      ? [
          '- because: the id of the line the reader confirmed (L1 …) that decided this score, raising it or lowering it, when one did; otherwise null. Judge every candidate by those lines first: they are the reader\'s latest word on the topic.',
        ]
      : []),
    SETTLED_RULE,
    "Use only the numbers given. Answer with JSON only: {\"items\": [ … ]}.",
    HUB_RULE,
    ...(graphed ? [VIA_RULE] : []),
    UNTRUSTED_RULE,
    language,
  ]
    .filter(Boolean)
    .join("\n");
  const queries = topic.queries.map((q) => `- ${q.id}${q.subtopic ? ` (${q.subtopic})` : ""}: ${q.ranking}`);
  const blocks = numbered.map((n) => {
    const c = n.cand;
    if (c.paper) {
      const authors = c.paper.authors.slice(0, 3).join(", ") + (c.paper.authors.length > 3 ? " et al." : "");
      const via = viaLine(c.via, titles);
      return material(
        n.c,
        [
          `${n.c} · paper · ${authors} · ${day(c.at)} · arXiv ${c.paper.id}${c.source === "graph" ? "" : ` · queries ${c.queries.join(", ")}`}`,
          c.paper.title,
          cut(c.paper.abstract, RERANK_TEXT_CHARS),
          ...hubLines(c.paper.hub),
          ...(via ? [via] : []),
        ].join("\n"),
      );
    }
    const post = c.post!;
    const head = `${n.c} · post · @${post.handle} · ${day(c.at)} · queries ${c.queries.join(", ")}${post.article ? " · X Article" : ""}${post.truncated ? " · text cut short" : ""}`;
    const body = [head, cut(post.text, RERANK_TEXT_CHARS)];
    if (post.quoted) body.push(`Quoting @${post.quoted.handle ?? "?"}: ${cut(post.quoted.text, 200)}`);
    if (n.links.length) body.push("Links:", ...n.links.map((l) => `${l.id} ${l.url}${l.card ? " (card)" : ""}`));
    return material(n.c, body.join("\n"));
  });
  const settled = settledBlock(topic, raised);
  const confirmed = lines.map((l) => `- ${l.id} (${l.kind}): ${l.text}`);
  const examples = (study?.examples ?? []).map((e) => `- ${e.label === "yes" ? "On the mark" : e.label === "borderline" ? "Borderline" : "Off the mark"}: ${e.title}${e.reason ? ` (the reader: ${e.reason})` : ""}`);
  const user = [
    topicBlock(topic, profile),
    ...(settled ? [settled] : []),
    ...(confirmed.length ? ["Lines the reader confirmed:", ...confirmed] : []),
    ...(examples.length ? ["Items the reader labelled (examples, not candidates):", ...examples] : []),
    "Query questions:",
    ...queries,
    "",
    "Candidates:",
    ...blocks,
  ].join("\n");
  return { system, user };
}

/**
 * The rerank's answers by number; answers naming no candidate, or malformed,
 * are dropped. `lines`: the line ids a study update's rerank was given; a
 * `because` naming any other is dropped. Absent: answers carry no `because`.
 */
export function parseRerank(text: string, numbered: readonly Numbered[], topic: TopicSearch, lines?: ReadonlySet<string>): Map<string, RerankAnswer> {
  const raw = parseJsonReply(text);
  const list = Array.isArray(raw) ? raw : (raw as { items?: unknown }).items;
  if (!Array.isArray(list)) throw new Error("the rerank reply has no items");
  const byC = new Map(numbered.map((n) => [n.c, n]));
  const subtopics = new Set(topic.subtopics.map((s) => s.id));
  const out = new Map<string, RerankAnswer>();
  for (const v of list) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const c = typeof o.c === "string" ? o.c.trim() : "";
    const n = byC.get(c);
    if (!n || out.has(c) || typeof o.score !== "number" || !Number.isFinite(o.score)) continue;
    const main = typeof o.main === "string" && n.links.some((l) => l.id === o.main) ? o.main : "self";
    const subtopic = typeof o.subtopic === "string" && subtopics.has(o.subtopic) ? o.subtopic : null;
    const doubt = typeof o.doubt === "string" && o.doubt.trim() ? o.doubt.trim().slice(0, 240) : null;
    const because = lines ? (typeof o.because === "string" && lines.has(o.because.trim()) ? o.because.trim() : null) : undefined;
    out.set(c, { score: Math.max(0, Math.min(100, o.score)), main, subtopic, doubt, ...(because !== undefined ? { because } : {}) });
  }
  return out;
}

export interface Scored extends EventMember {
  cand: Candidate;
  rerank: RerankAnswer | null;
  rrf: number;
  subtopic: string | null;
  /** The URL `main` names; null when the candidate is its own content. */
  mainUrl: string | null;
}

/**
 * Final scores (88 「打分」 5) and each member's event key. `keyOfUrl` keys a
 * member's main link: eventKeyOfUrl, or the run's with DOIs mapped to their
 * arXiv papers (doi-arxiv.ts).
 */
export function scorePool(
  topic: TopicSearch,
  numbered: readonly Numbered[],
  answers: ReadonlyMap<string, RerankAnswer>,
  keyOfUrl: (url: string) => string | null = eventKeyOfUrl,
): Scored[] {
  const queries = new Map(topic.queries.map((q) => [q.id, q]));
  return numbered.map((n) => {
    const answer = answers.get(n.c) ?? null;
    const c = n.cand;
    const mainUrl = answer && answer.main !== "self" ? (n.links.find((l) => l.id === answer.main)?.url ?? null) : null;
    const key = (mainUrl ? keyOfUrl(mainUrl) : null) ?? c.key;
    const score = finalScore({
      // A post whose main is a paper is scored as the paper: whoever recommends
      // a paper is often a small account, and engagement near 0 would sink it.
      // It shares the paper's event key, so the two stay one event.
      kind: key.startsWith("arxiv:") ? "paper" : c.kind,
      rerank: answer ? answer.score : null,
      // Only the graph found it: no query's words stand in for an answer the model left out (docs/info/92).
      relevance: c.source === "graph" ? 0 : c.relevance,
      rrf: n.rrf,
      engagement: c.engagement,
    });
    const subtopic = answer ? answer.subtopic : (queries.get(c.queries[0])?.subtopic ?? null);
    return {
      id: n.c,
      kind: c.kind,
      key,
      score,
      text: c.paper ? c.paper.title : c.text.slice(0, 400),
      cand: c,
      rerank: answer,
      rrf: n.rrf,
      subtopic,
      mainUrl: key === c.key ? null : mainUrl,
    };
  });
}

/** Members to events to clusters, best first (88 「打分」 6). */
export function rankEvents(scored: readonly Scored[]): EventCluster<Scored>[] {
  return mergeIntoEvents(scored);
}
