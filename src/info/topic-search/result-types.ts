// The result file of a topic search run (docs/info/88 「结果」):
// `topic-search-<id>-<date>.json` in AppData, synced. What the result card and
// the result page render, and what the next runs read back as the topic's
// 30-day history (dedupe, continuation, the metric questions).
//
// Every fact here — titles, URLs, authors, dates, counts, stars — is the
// program's. A model wrote only `overview.text`, each item's `summary`, `body`
// and `unknown`, and the `says` / `difference` of a discrepancy, and all of those passed the number
// check (numbers.ts) against the materials they cite.

import type { RegisteredMaterial } from "../dossier/registry";

export const TOPIC_SEARCH_RESULT_VERSION = 1;
export const RESULT_FILE_PREFIX = "topic-search-";

export type ResultRunKind = "first" | "daily";

/** The counts a post had when it went into a result. */
export interface PostCounts {
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  views: number | null;
}

export interface ResultPost {
  statusId: string;
  handle: string;
  name: string;
  /** Rebuilt from handle and id. */
  url: string;
  /** From the status id (snowflake), epoch ms. */
  postedAt: number;
  counts: PostCounts;
  /** The post's text as read (cut when the page cut it). */
  text: string;
  truncated: boolean;
}

export type PaperDepth = "abstract" | "head" | "full";

/** The facts line of an item, by kind; rendered by the page, written by the program. */
export type ResultFacts =
  | {
      kind: "paper";
      arxivId: string;
      authors: string[];
      publishedAt: string | null;
      /**
       * How much of the paper was read: the abstract, the abstract and the start
       * of the body (verify.ts PAPER_BODY_CHARS), or the whole paper (a deeper
       * read the write-up asked for). Absent in files written before 2026-10-16.
       */
      depth?: PaperDepth;
    }
  | {
      kind: "repo";
      fullName: string;
      /** False when the lookup was not made (run cap, quota): the page says "not looked up". */
      lookedUp: boolean;
      stars: number | null;
      forks: number | null;
      lastCommitAt: string | null;
      release: { tag: string; publishedAt: string | null } | null;
      license: string | null;
    }
  | { kind: "page"; host: string; author: string | null; publishedAt: string | null }
  | { kind: "post"; handle: string; name: string; postedAt: number; counts: PostCounts };

/** A post's claim that the original does not bear out. */
export interface Discrepancy {
  /** The post's status id. */
  post: string;
  /** The claim, as the model put it. */
  says: string;
  /** One sentence: what the original says instead. Null for a claim the original never mentions. */
  difference: string | null;
  /** "M3.§2"; null when the claim is nowhere in the original. */
  evidence: string | null;
  verdict: "mismatch" | "absent";
}

export type VerifyStatus =
  /** Originals were read and compared with the posts. */
  | "compared"
  /** Originals were read; there was no post to compare (a paper from the arXiv search). */
  | "read"
  /** The post is itself the original. */
  | "self"
  /** No original could be read: `reason` says why. */
  | "unread"
  /** A continuing item: nothing was read again. */
  | "skipped";

export interface ResultVerify {
  status: VerifyStatus;
  /** Why no original was read, or why the comparison did not happen, in the program's words. */
  reason: string | null;
  discrepancies: Discrepancy[];
  /** Claims checked: how many the original bore out, contradicted, and did not mention. */
  checked: { match: number; mismatch: number; absent: number };
}

export interface ResultContinuation {
  /** The result the item was last in. */
  previous: string;
  /** The status id whose engagement grew. */
  post: string;
  before: PostCounts;
  after: PostCounts;
}

export type ResultItemKind = "paper" | "repo" | "page" | "post";

export interface TopicSearchResultItem {
  /** "E1", in the order of the file. */
  id: string;
  /** The event key: "arxiv:…", "github:owner/repo", "url:…", "x:…". */
  key: string;
  /** Every identity the item has (keys of all its members, status ids): the 30-day dedupe reads these. */
  keys: string[];
  kind: ResultItemKind;
  subtopic: string | null;
  /** The original's title; else the author and the post's first sentence, cut to 120 characters. Never rewritten. */
  title: string;
  titleFrom: "original" | "post";
  /**
   * The one-sentence conclusion, the model's: the brief's contents line and the
   * entry's italic lede (88 「简报书」). Null in the fallback write-up, and for a
   * continuing item the model had nothing new to say about.
   */
  summary: string | null;
  /** Two or three paragraphs, facts before judgements. Empty where `summary` is null. Absent in files written before 2026-10-15. */
  body?: string[];
  /** One sentence on what is not yet known or could not be checked; null when the model had none. */
  unknown?: string | null;
  facts: ResultFacts;
  /** The original (null when the post is the original) and the posts that led to it. */
  links: { original: string | null; posts: ResultPost[] };
  /** Materials registered for this item, "M3". */
  materials: string[];
  verify: ResultVerify;
  continuing: ResultContinuation | null;
  /** Final score, 0-100. */
  score: number;
}

export interface ResultQuestion {
  id: string;
  text: string;
  source: "model" | "metric";
  /** For a metric question: which template and its values, so a page can word it in the reader's language. */
  template: { code: "subtopic-quiet" | "anchor-miss" | "avoid-blocks"; params: Record<string, string | number> } | null;
}

export interface ResultStats {
  candidates: { x: number; arxiv: number };
  passedFloor: number;
  pooled: number;
  reranked: boolean;
  /** Share of the candidates past the floor that name no anchor, 0-1. */
  anchorMiss: number;
  /** Per `avoid` phrase: pooled candidates naming it that the rerank scored under its cliff. */
  avoidBlocked: Record<string, number>;
  /** Items per subtopic id ("" for the whole topic). */
  subtopicItems: Record<string, number>;
  modelCalls: number;
  /** Papers the write-up asked to read in full: read, unreadable, refused for the run's cap. Absent before 2026-10-16. */
  deepReads?: { read: string[]; failed: string[]; refused: string[] };
}

export interface TopicSearchResult {
  version: typeof TOPIC_SEARCH_RESULT_VERSION;
  /** The file name without ".json". */
  id: string;
  searchId: string;
  name: string;
  kind: ResultRunKind;
  /** Local date of the run, YYYY-MM-DD. */
  date: string;
  createdAt: number;
  window: { since: number; until: number };
  /** Nothing new: no box item. */
  empty: boolean;
  /** Who wrote the sentences: the model, the program's fallback, or nobody (an empty result). */
  writeup: "model" | "fallback" | "none";
  /** The panorama (first) or the short panorama (daily); null when empty or under the fallback. */
  overview: { text: string; cites: string[] } | null;
  /** Items grouped by subtopic, in display order. */
  groups: { subtopic: string | null; items: string[] }[];
  /** Daily: picked subtopics with nothing new today, one line each. */
  quiet: string[];
  items: TopicSearchResultItem[];
  materials: RegisteredMaterial[];
  /** Questions for you, at the end of the page. */
  questions: ResultQuestion[];
  stats: ResultStats;
  /** Where this run's cached material bodies are (a retry's bodies go here too). */
  runDir: string;
  /** First look only: what each retry added to this file (retry.ts). Absent until one did. */
  retries?: ResultRetry[];
}

/** What one retry of a first look added to its file: its items, its write-up and questions, its own counts. */
export interface ResultRetry {
  runId: string;
  at: number;
  /** Item ids it added, in the file's numbering. */
  items: string[];
  overview: TopicSearchResult["overview"];
  writeup: TopicSearchResult["writeup"];
  /** Question ids it asked. */
  questions: string[];
  stats: ResultStats;
}

/** The highest number among ids like "E7" or "M12"; 0 when there is none. */
export function highestNumber(ids: readonly string[]): number {
  return ids.reduce((most, id) => Math.max(most, Number(/^[A-Z](\d+)$/.exec(id)?.[1] ?? 0)), 0);
}

/** Groups in the order their subtopic first appears, items in file order. */
function regroup(groups: readonly TopicSearchResult["groups"][number][]): TopicSearchResult["groups"] {
  const out: TopicSearchResult["groups"] = [];
  for (const g of groups) {
    const same = out.find((o) => o.subtopic === g.subtopic);
    if (same) same.items.push(...g.items);
    else out.push({ subtopic: g.subtopic, items: [...g.items] });
  }
  return out;
}

/**
 * The first look's file with a retry's part added (docs/info/88 「重跑第一次」):
 * what was there stays as it was, the part's items, materials and questions
 * follow (already numbered after the file's), and the retry is recorded. The
 * first look's overview stands; a file that had none takes the retry's. Pure.
 */
export function mergeRetry(target: TopicSearchResult, part: TopicSearchResult, runId: string): TopicSearchResult {
  const record: ResultRetry = {
    runId,
    at: part.createdAt,
    items: part.items.map((i) => i.id),
    overview: part.overview,
    writeup: part.writeup,
    questions: part.questions.map((q) => q.id),
    stats: part.stats,
  };
  const items = [...target.items, ...part.items];
  return {
    ...target,
    empty: items.length === 0,
    writeup: target.writeup === "none" ? part.writeup : target.writeup,
    overview: target.overview ?? part.overview,
    groups: regroup([...target.groups, ...part.groups]),
    items,
    materials: [...target.materials, ...part.materials],
    questions: [...target.questions, ...part.questions],
    retries: [...(target.retries ?? []).filter((r) => r.runId !== runId), record],
  };
}

/** What a retry added to a first look's file, as a result of its own (its brief issue); null when it added nothing. */
export function retryPart(result: TopicSearchResult, runId: string): TopicSearchResult | null {
  const record = result.retries?.find((r) => r.runId === runId);
  if (!record || record.items.length === 0) return null;
  const items = result.items.filter((i) => record.items.includes(i.id));
  const used = new Set(items.flatMap((i) => i.materials));
  return {
    ...result,
    createdAt: record.at,
    empty: items.length === 0,
    writeup: record.writeup,
    overview: record.overview,
    groups: result.groups
      .map((g) => ({ subtopic: g.subtopic, items: g.items.filter((id) => record.items.includes(id)) }))
      .filter((g) => g.items.length > 0),
    items,
    materials: result.materials.filter((m) => used.has(m.id)),
    questions: result.questions.filter((q) => record.questions.includes(q.id)),
    stats: record.stats,
    retries: undefined,
  };
}

/** `topic-search-<id>-<date>.json`, `-2`, `-3` … for a second run the same day. */
export function resultFileName(searchId: string, date: string, n = 1): string {
  return `${RESULT_FILE_PREFIX}${searchId}-${date}${n > 1 ? `-${n}` : ""}.json`;
}

const RESULT_NAME = /^topic-search-(ts-[0-9a-f]+)-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/;

/** The search id, date and sequence a result file name carries; null for any other name. */
export function parseResultFileName(name: string): { searchId: string; date: string; n: number } | null {
  const m = RESULT_NAME.exec(name);
  return m ? { searchId: m[1], date: m[2], n: m[3] ? Number(m[3]) : 1 } : null;
}

/** A result file read back; null when it is not one this build understands. */
export function parseResultFile(text: string): TopicSearchResult | null {
  try {
    const v = JSON.parse(text) as Partial<TopicSearchResult>;
    if (v.version !== TOPIC_SEARCH_RESULT_VERSION || !Array.isArray(v.items) || typeof v.searchId !== "string") return null;
    return v as TopicSearchResult;
  } catch {
    return null;
  }
}
