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
import type { RunSource } from "./pace";
import type { ReadTrace } from "./read-failure";

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
  /**
   * Every original tried, in order, with each step's typed record: read,
   * partial (read, a step failed) or unread, and per failure its code and
   * whether a retry can help (read-failure.ts; `failuresOf` reads either
   * shape). Absent in files written before 2026-10-18, which hold only `reason`.
   */
  reads?: ReadTrace[];
}

export interface ResultContinuation {
  /** The result the item was last in. */
  previous: string;
  /** The status id whose engagement grew. */
  post: string;
  before: PostCounts;
  after: PostCounts;
}

/**
 * What Hugging Face's paper search said of a paper (huggingface.ts searchItem):
 * reference for the rerank and the write-up, not a score term. The repo and
 * project page are URLs as the Hub gave them; `aiSummary` is the Hub's
 * machine-written summary, unchecked.
 */
export interface HubFacts {
  repo?: string;
  stars?: number;
  upvotes?: number;
  projectPage?: string;
  aiSummary?: string;
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
  /** The Hub's facts of the item's paper, when Hugging Face found it. Absent otherwise, and in files written before 2026-10-19. */
  hub?: HubFacts;
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
  /**
   * For a metric question: which template and its values, so a page can word it in the reader's language.
   * "label-item" is a study's question about one item (questions.ts labelQuestion).
   */
  template: { code: "subtopic-quiet" | "anchor-miss" | "avoid-blocks" | "label-item"; params: Record<string, string | number> } | null;
}

export interface ResultStats {
  /** huggingface: papers only Hugging Face found (one arXiv found too counts as arXiv's); absent before it was a source. */
  candidates: { x: number; arxiv: number; huggingface?: number };
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
  /** First look only: what each retry added to this file (retry.ts), and its slow part (pace.ts). Absent until one did. */
  retries?: ResultRetry[];
  /**
   * First look only: the first look's own overview, write-up and counts, kept
   * once a retry or the slow part made the file's speak for the merged whole
   * (`firstPart` reads them back). Absent until one did.
   */
  firstLook?: ResultFirstLook;
  /**
   * Not in the file: items of the same file told in another issue, which the
   * overview may name (`retryPart` sets it, so the annex can still footnote them).
   */
  citable?: { id: string; title: string }[];
  /**
   * First look only (pace.ts): the slow sources its first part was built
   * without, still being read by the same run. Cleared when their part is
   * merged; left set when that run failed before it was. Absent otherwise.
   */
  awaiting?: RunSource[];
  /**
   * The run that wrote the file (the first part, on a split first look) had
   * candidates no model judged: the rerank failed, so nothing was listed and its
   * reads wait in its run directory for the topic's next run (88 「判不了」).
   * A retry's or the slow part's is on its `retries` record. Absent otherwise.
   */
  unjudged?: ResultUnjudged;
  /** Runs whose waiting reads this file's run took in and judged (`pendingJudging`). Absent when none. */
  judged?: string[];
  /**
   * A study's file only (docs/info/91 数据): its versions, the first look's
   * being version 1. Absent on every other result.
   */
  study?: { versions: StudyVersion[] };
  /** Not in the file: the study version this is a view of (`versionPart` sets it). */
  studyVersion?: StudyVersion;
}

/** Where an item sits in a version of a study's brief. */
export type StudyPlace = "pinned" | "main" | "note";

/** One version of a study's brief: a view of the study's one result file (docs/info/91 数据). */
export interface StudyVersion {
  /** 1, 2, 3 … */
  n: number;
  at: number;
  /** The run that made it: the first look's for version 1, an update's after. */
  runId: string;
  /** The version it was revised from; null for the first. */
  base: number | null;
  /**
   * Its items in book order (pinned, main, notes). `item` is the file's item
   * id ("E7"): a rewritten item is a new id under the same key, so each
   * version names the text it shows. `tag` is what changed in this version.
   */
  entries: { item: string; place: StudyPlace; tag: "new" | "rewritten" | "demoted" | "pinned" | null }[];
  /** Items of the base version not in this one, by key; `line` is the study line ("L2") that took them out. */
  removed: { key: string; title: string; line: string | null }[];
  /** What changed from the base, by item key, each with the line that made it (null: the model gave none). */
  changes: { kind: "add" | "remove" | "demote" | "rewrite" | "pin"; item: string; line: string | null }[];
  /** The confirmed study lines ("L1" …) this version was made from. */
  lines: string[];
  /** Search query ids an update could not run (a cooldown), left for the next one. */
  skipped?: string[];
  overview: TopicSearchResult["overview"];
}

/** A run's reads that no model judged, kept for the next run of the topic. */
export interface ResultUnjudged {
  runId: string;
  at: number;
  /** Why the judging failed, in the model call's words. */
  why: string;
  /** Candidates that were waiting for the rerank. */
  candidates: number;
}

/** What one retry of a first look, or its slow part, added to its file: its items, its write-up and questions, its own counts. */
export interface ResultRetry {
  runId: string;
  /**
   * "slow": the first look's own slow part (pace.ts), under the first run's id.
   * "update": a study's update run (docs/info/91 更新), with the version it made
   * in `version`. Absent on a retry.
   */
  part?: "slow" | "update";
  /** The study version an update made. Only with part "update". */
  version?: number;
  at: number;
  /** Item ids it added, in the file's numbering. */
  items: string[];
  overview: TopicSearchResult["overview"];
  writeup: TopicSearchResult["writeup"];
  /** Question ids it asked. */
  questions: string[];
  stats: ResultStats;
  /** Its candidates no model judged (`TopicSearchResult.unjudged`). */
  unjudged?: ResultUnjudged;
  /** Runs whose waiting reads it judged. */
  judged?: string[];
}

/** The first look's own part of a file retries were merged into. */
export interface ResultFirstLook {
  overview: TopicSearchResult["overview"];
  writeup: TopicSearchResult["writeup"];
  stats: ResultStats;
}

function addCounts(into: Record<string, number>, from: Record<string, number>): Record<string, number> {
  for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
  return into;
}

/**
 * The counts of runs that wrote one file, added up: candidates, the floor, the
 * pool, items per subtopic, avoid blocks and model calls summed; the anchor
 * miss share weighted by what passed the floor; reranked when any part was.
 */
export function sumStats(parts: readonly ResultStats[]): ResultStats {
  const passed = parts.reduce((n, p) => n + p.passedFloor, 0);
  const deep = parts.filter((p) => p.deepReads).map((p) => p.deepReads!);
  return {
    candidates: {
      x: parts.reduce((n, p) => n + p.candidates.x, 0),
      arxiv: parts.reduce((n, p) => n + p.candidates.arxiv, 0),
      huggingface: parts.reduce((n, p) => n + (p.candidates.huggingface ?? 0), 0),
    },
    passedFloor: passed,
    pooled: parts.reduce((n, p) => n + p.pooled, 0),
    reranked: parts.some((p) => p.reranked),
    anchorMiss: passed ? parts.reduce((n, p) => n + p.anchorMiss * p.passedFloor, 0) / passed : 0,
    avoidBlocked: parts.reduce((acc, p) => addCounts(acc, p.avoidBlocked), {} as Record<string, number>),
    subtopicItems: parts.reduce((acc, p) => addCounts(acc, p.subtopicItems), {} as Record<string, number>),
    modelCalls: parts.reduce((n, p) => n + p.modelCalls, 0),
    ...(deep.length
      ? { deepReads: { read: deep.flatMap((d) => d.read), failed: deep.flatMap((d) => d.failed), refused: deep.flatMap((d) => d.refused) } }
      : {}),
  };
}

/** The highest number among ids like "E7" or "M12"; 0 when there is none. */
export function highestNumber(ids: readonly string[]): number {
  return ids.reduce((most, id) => Math.max(most, Number(/^[A-Z](\d+)$/.exec(id)?.[1] ?? 0)), 0);
}

/** Groups in the order their subtopic first appears, the whole topic's last, items in file order. */
function regroup(groups: readonly TopicSearchResult["groups"][number][]): TopicSearchResult["groups"] {
  const out: TopicSearchResult["groups"] = [];
  for (const g of groups) {
    const same = out.find((o) => o.subtopic === g.subtopic);
    if (same) same.items.push(...g.items);
    else out.push({ subtopic: g.subtopic, items: [...g.items] });
  }
  return [...out.filter((g) => g.subtopic !== null), ...out.filter((g) => g.subtopic === null)];
}

/**
 * The first look's file with a retry's part added (docs/info/88 「重跑第一次」):
 * the items, materials and questions there stay as they were, the part's
 * follow (already numbered after the file's), and the retry is recorded. The
 * file's overview, groups and counts then speak for the merged whole: the
 * part's overview was written over every item in the file (build-result.ts
 * hands the write-up the file's items beside its own), so it replaces the
 * file's; a part whose write-up fell back leaves none. The counts are the
 * first look's and every part's added up. What the first look had of its own
 * is kept in `firstLook`. The first look's slow part (`slow`) merges the same
 * way and settles what the file was awaiting. Pure.
 */
export function mergeRetry(target: TopicSearchResult, part: TopicSearchResult, runId: string, slow = false): TopicSearchResult {
  const record: ResultRetry = {
    runId,
    ...(slow ? { part: "slow" as const } : {}),
    at: part.createdAt,
    items: part.items.map((i) => i.id),
    overview: part.overview,
    writeup: part.writeup,
    questions: part.questions.map((q) => q.id),
    stats: part.stats,
    ...(part.unjudged ? { unjudged: part.unjudged } : {}),
    ...(part.judged?.length ? { judged: part.judged } : {}),
  };
  const items = [...target.items, ...part.items];
  const retries = [...(target.retries ?? []).filter((r) => r.runId !== runId), record];
  // A file merged before `firstLook` existed still has the first look's own overview on top,
  // unless the first look had none and an earlier retry's was taken in its place.
  const firstLook: ResultFirstLook = target.firstLook ?? {
    overview: target.retries?.some((r) => r.overview && r.overview.text === target.overview?.text) ? null : target.overview,
    writeup: target.writeup,
    stats: target.stats,
  };
  const { awaiting, ...rest } = target;
  return {
    ...rest,
    ...(awaiting && !slow ? { awaiting } : {}),
    empty: items.length === 0,
    writeup: target.writeup === "none" ? part.writeup : target.writeup,
    // A part that added nothing wrote nothing: the file's overview still holds.
    overview: part.items.length ? part.overview : target.overview,
    groups: regroup([...target.groups, ...part.groups]),
    items,
    materials: [...target.materials, ...part.materials],
    questions: [...target.questions, ...part.questions],
    stats: sumStats([firstLook.stats, ...retries.map((r) => r.stats)]),
    retries,
    firstLook,
  };
}

/**
 * What a retry added to a first look's file, as a result of its own (its brief
 * issue); null when it added nothing and left nothing waiting to be judged.
 */
export function retryPart(result: TopicSearchResult, runId: string): TopicSearchResult | null {
  const record = result.retries?.find((r) => r.runId === runId);
  if (!record || (record.items.length === 0 && !record.unjudged)) return null;
  const items = result.items.filter((i) => record.items.includes(i.id));
  const used = new Set(items.flatMap((i) => i.materials));
  return {
    ...result,
    citable: result.items.filter((i) => !record.items.includes(i.id)).map((i) => ({ id: i.id, title: i.title })),
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
    awaiting: undefined,
    firstLook: undefined,
    unjudged: record.unjudged,
    judged: record.judged,
  };
}

/**
 * The runs whose reads still wait to be judged, among a topic's results: each
 * one some file says went unjudged and none says was judged since. Pure.
 */
export function pendingJudging(results: readonly TopicSearchResult[]): ResultUnjudged[] {
  const judged = new Set(results.flatMap((r) => [...(r.judged ?? []), ...(r.retries ?? []).flatMap((x) => x.judged ?? [])]));
  const out = new Map<string, ResultUnjudged>();
  for (const r of results) {
    for (const u of [r.unjudged, ...(r.retries ?? []).map((x) => x.unjudged)]) {
      if (u && !judged.has(u.runId) && !out.has(u.runId)) out.set(u.runId, u);
    }
  }
  return [...out.values()];
}

/**
 * The first look's own items, overview, write-up and counts, without what
 * retries or its slow part added later: what the issue `first:<id>` carries,
 * even when it is assembled after those were merged (a crash, the collector's
 * tick). Pure.
 */
export function firstPart(result: TopicSearchResult): TopicSearchResult {
  const added = new Set((result.retries ?? []).flatMap((r) => r.items));
  const addedQuestions = new Set((result.retries ?? []).flatMap((r) => r.questions));
  if (added.size === 0 && addedQuestions.size === 0 && !result.firstLook) return result;
  const items = result.items.filter((i) => !added.has(i.id));
  const used = new Set(items.flatMap((i) => i.materials));
  return {
    ...result,
    ...(result.firstLook ? { overview: result.firstLook.overview, writeup: result.firstLook.writeup, stats: result.firstLook.stats } : {}),
    empty: items.length === 0,
    groups: result.groups
      .map((g) => ({ subtopic: g.subtopic, items: g.items.filter((id) => !added.has(id)) }))
      .filter((g) => g.items.length > 0),
    items,
    materials: result.materials.filter((m) => used.has(m.id)),
    questions: result.questions.filter((q) => !addedQuestions.has(q.id)),
  };
}

/**
 * Version `n` of a study's brief, as a result of its own (docs/info/91 数据):
 * the version's items in its book order, the materials they cite, its
 * overview, and the questions the run that made it asked (the first look's
 * own for version 1, the update's after). `studyVersion` carries the entries'
 * places and tags. Null when the file has no such version. Pure.
 */
export function versionPart(result: TopicSearchResult, n: number): TopicSearchResult | null {
  const version = result.study?.versions.find((v) => v.n === n);
  if (!version) return null;
  const byId = new Map(result.items.map((i) => [i.id, i]));
  const items = version.entries.map((e) => byId.get(e.item)).filter((i): i is TopicSearchResultItem => i !== undefined);
  const used = new Set(items.flatMap((i) => i.materials));
  // An update's own record; version 1 is the first look's (its slow part, under the same run id, is not an update).
  const record = (result.retries ?? []).find((r) => r.part === "update" && r.version === n);
  const own = record ? null : firstPart(result);
  const questions = record
    ? result.questions.filter((q) => record.questions.includes(q.id))
    : (own as TopicSearchResult).questions;
  return {
    ...result,
    createdAt: version.at,
    empty: items.length === 0,
    writeup: record ? record.writeup : (own as TopicSearchResult).writeup,
    overview: version.overview,
    groups: regroup(items.map((i) => ({ subtopic: i.subtopic, items: [i.id] }))),
    items,
    materials: result.materials.filter((m) => used.has(m.id)),
    questions,
    stats: record ? record.stats : (own as TopicSearchResult).stats,
    retries: undefined,
    awaiting: undefined,
    firstLook: undefined,
    citable: undefined,
    study: undefined,
    studyVersion: version,
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
