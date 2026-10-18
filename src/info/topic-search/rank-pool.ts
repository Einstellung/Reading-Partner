// The rank phase of a topic search run (docs/info/88 「打分」 1-6): what the X
// reader and the arXiv search brought, as candidates; the local relevance
// floor; weighted RRF over the (query, source) streams; the rerank call and its
// stand-in; the final score; candidates merged into events.
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
import { finalScore, mentionsAnchor } from "../rank/score";
const DAY_MS = 86_400_000;
import type { XSearchPost } from "../x/search-page";
import { postLinksOut } from "../x/text-links";
import { cut, letter, material, parseJsonReply, UNTRUSTED_RULE } from "./model-io";
import type { TopicQuery, TopicSearch } from "./types";
import type { XReadResult } from "./x-reader";

/** Candidates sent to the rerank: a day's run, and a first run's. */
export const RERANK_POOL = { daily: 40, first: 60 } as const;
/** Candidates each stream gives the fusion: an X line reads hundreds, an arXiv search a page. */
export const STREAM_TAKE = { x: 40, arxiv: 12 } as const;
/**
 * Places in the rerank pool kept, by fusion order, for posts and for the
 * candidates each picked subtopic's queries found, so that the result's
 * reservations (select.ts) have something reranked to take.
 */
export const POOL_RESERVE = { posts: 10, perSubtopic: 4 } as const;
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
}

export type CandidateSource = "x" | "arxiv";

export interface Candidate {
  /** "x:<status id>" or "arxiv:<id>". */
  key: string;
  kind: "post" | "paper";
  source: CandidateSource;
  /** Ids of the queries that found it, first finder first. */
  queries: string[];
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
  mentionsAnchor: boolean;
  order: number;
}

/** One arXiv search's answer: the query it ran and what came back, or why it failed. */
export interface ArxivFound {
  query: string;
  items: InfoItem[];
  error: string | null;
  /** How the query's ladder went (arxiv-ladder.ts), for the source health. */
  ladder?: ArxivLadder;
}

/** "q1|x", "q1|arxiv": a (query, source) stream. */
export function streamKey(query: string, source: CandidateSource): string {
  return `${query}|${source}`;
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

function paperOf(item: InfoItem): PaperInfo | null {
  const id = normalizeArxivId(item.sourceKey ?? item.url);
  if (!id) return null;
  return {
    id,
    title: item.title,
    abstract: item.textContent ?? item.summary ?? "",
    authors: item.authors ?? [],
    publishedAt: item.publishedAt || null,
    url: `https://arxiv.org/abs/${id}`,
  };
}

/** Normalize, merge by identity, measure relevance and anchors (88 「打分」 1-2). */
export function gatherCandidates(topic: TopicSearch, x: XReadResult, arxiv: readonly ArxivFound[], since: number): Gathered {
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
    touch(streamKey(query.id, "x"), key);
    const got = byKey.get(key);
    if (got) {
      if (!got.queries.includes(query.id)) got.queries.push(query.id);
      continue;
    }
    const text = [post.text, post.quoted ? post.quoted.text : ""].filter(Boolean).join("\n\n");
    byKey.set(key, {
      key,
      kind: "post",
      source: "x",
      queries: [query.id],
      text,
      author: post.handle,
      at: post.postedAt,
      post,
      paper: null,
      // The text's own links too: a link the page gave without t.co, or that the text only names (pitfall 657).
      links: postLinksOut(post),
      relevance: 0,
      engagement: xEngagement(post.counts),
      mentionsAnchor: true,
      order: byKey.size,
    });
  }

  for (const found of arxiv) {
    if (!queries.has(found.query)) continue;
    const stream = streamKey(found.query, "arxiv");
    if (!streams.has(stream)) streams.set(stream, { read: [], kept: [] });
    for (const item of found.items) {
      const paper = paperOf(item);
      const key = paper ? arxivEventKey(paper.id) : null;
      if (!paper || !key) continue;
      touch(stream, key);
      const got = byKey.get(key);
      if (got) {
        if (!got.queries.includes(found.query)) got.queries.push(found.query);
        continue;
      }
      const at = paper.publishedAt ? Date.parse(paper.publishedAt) : NaN;
      byKey.set(key, {
        key,
        kind: "paper",
        source: "arxiv",
        queries: [found.query],
        text: `${paper.title}\n\n${paper.abstract}`,
        author: paper.authors[0] ?? "",
        at: Number.isFinite(at) ? at : since,
        post: null,
        paper,
        links: [],
        relevance: 0,
        engagement: null,
        mentionsAnchor: true,
        order: byKey.size,
      });
    }
  }

  const all = [...byKey.values()];
  const kept: Candidate[] = [];
  for (const c of all) {
    c.relevance = Math.max(0, ...c.queries.map((id) => relevanceTo(queries.get(id), c)));
    c.mentionsAnchor = mentionsAnchor([c.text], topic.anchors);
    // No window filter here: the X lines and the arXiv search already read only
    // their window, and a seen post read again is what continuation looks for.
    if (c.relevance < RELEVANCE_FLOOR) continue;
    kept.push(c);
    for (const id of c.queries) streams.get(streamKey(id, c.source))?.kept.push(c.key);
  }
  return { all, kept, streams };
}

function relevanceTo(query: TopicQuery | undefined, c: Candidate): number {
  if (!query) return 0;
  const words = c.source === "x" ? plainQuery(query.x) : (query.arxiv ?? plainQuery(query.x));
  return localRelevance(prepareQuery(words), c.text);
}

/**
 * Weighted RRF over the (query, source) streams, the per-author cap, the
 * pool's top (88 「打分」 3), with places kept for posts and for each picked
 * subtopic (POOL_RESERVE). The pool stays in fusion order.
 */
export function fusePool(topic: TopicSearch, kept: readonly Candidate[], size: number): { cand: Candidate; rrf: number }[] {
  const byKey = new Map(kept.map((c) => [c.key, c]));
  const streams: Stream[] = [];
  for (const q of topic.queries) {
    for (const source of ["x", "arxiv"] as const) {
      const members = kept
        .filter((c) => c.source === source && c.queries.includes(q.id))
        .map((c) => ({ c, r: relevanceTo(q, c) }))
        // A live line is newest first; its stream is ranked by how well each post answers the query.
        .sort((a, b) => b.r - a.r || a.c.order - b.c.order);
      if (members.length) {
        streams.push({ weight: q.weight, take: STREAM_TAKE[source], items: members.map(({ c }) => ({ key: c.key, author: c.author })) });
      }
    }
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

export function rerankPrompt(
  topic: TopicSearch,
  numbered: readonly Numbered[],
  profile: readonly string[],
  language: string,
): { system: string; user: string } {
  const system = [
    "You rank what a topic search found for a reader: posts from X and papers from arXiv.",
    "For every candidate answer one object {c, score, main, subtopic, doubt}:",
    "- c: the candidate's number as given (c1, c2 …).",
    "- score: 0-100, how well it serves the topic as the reader defined it (scope, subtopics, wants, does-not-wants, the query questions). Promotion, event hype, giveaways and engagement bait score under 20.",
    '- main: what the candidate really is. "self" when the post itself (or the paper) is the content; the number of one of its links (c3.a) when the post points at the real thing — a paper, a repository, an article. Most posts are lead-ins.',
    "- subtopic: the id of the subtopic it belongs to, or null.",
    "- doubt: only when you cannot tell whether the reader wants this kind of thing, one short question to ask them (\"Do you want funding news about AI chip design?\"); otherwise null.",
    "Use only the numbers given. Answer with JSON only: {\"items\": [ … ]}.",
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
      return material(
        n.c,
        `${n.c} · paper · ${authors} · ${day(c.at)} · arXiv ${c.paper.id} · queries ${c.queries.join(", ")}\n${c.paper.title}\n${cut(c.paper.abstract, RERANK_TEXT_CHARS)}`,
      );
    }
    const post = c.post!;
    const head = `${n.c} · post · @${post.handle} · ${day(c.at)} · queries ${c.queries.join(", ")}${post.article ? " · X Article" : ""}${post.truncated ? " · text cut short" : ""}`;
    const body = [head, cut(post.text, RERANK_TEXT_CHARS)];
    if (post.quoted) body.push(`Quoting @${post.quoted.handle ?? "?"}: ${cut(post.quoted.text, 200)}`);
    if (n.links.length) body.push("Links:", ...n.links.map((l) => `${l.id} ${l.url}${l.card ? " (card)" : ""}`));
    return material(n.c, body.join("\n"));
  });
  const user = [topicBlock(topic, profile), "Query questions:", ...queries, "", "Candidates:", ...blocks].join("\n");
  return { system, user };
}

/** The rerank's answers by number; answers naming no candidate, or malformed, are dropped. */
export function parseRerank(text: string, numbered: readonly Numbered[], topic: TopicSearch): Map<string, RerankAnswer> {
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
    out.set(c, { score: Math.max(0, Math.min(100, o.score)), main, subtopic, doubt });
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

/** Final scores (88 「打分」 5) and each member's event key. */
export function scorePool(topic: TopicSearch, numbered: readonly Numbered[], answers: ReadonlyMap<string, RerankAnswer>): Scored[] {
  const queries = new Map(topic.queries.map((q) => [q.id, q]));
  return numbered.map((n) => {
    const answer = answers.get(n.c) ?? null;
    const c = n.cand;
    const mainUrl = answer && answer.main !== "self" ? (n.links.find((l) => l.id === answer.main)?.url ?? null) : null;
    const key = (mainUrl ? eventKeyOfUrl(mainUrl) : null) ?? c.key;
    const score = finalScore({
      kind: c.kind,
      rerank: answer ? answer.score : null,
      relevance: c.relevance,
      rrf: n.rrf,
      engagement: c.engagement,
      mentionsAnchor: c.mentionsAnchor,
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
