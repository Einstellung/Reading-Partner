// A study's second round of queries (docs/info/92 「第二轮查询」). After the
// first judging, a line (a picked subtopic, or the whole topic when none is
// picked) with fewer than WIDEN_MIN_HITS candidates scored at or over
// LABEL_BOUNDARY that the model put on that line is a gap. One model call
// proposes searches for the gaps; the program keeps those with two searchable
// words, a word the on-topic papers use and words unlike every search already
// sent, and numbers them w1 … . The build (build-result.ts) searches them on
// arXiv and Hugging Face, judges only the candidates the first pool lacked, and
// fuses both rounds. The lines still short are said plainly on the result
// (`widen.lines`): searched twice with nothing on the mark, or not searched.
//
// Pure: prompts, checks, numbering and the files' shapes. The build makes the
// calls and keeps each step in the run directory (`judge-1.json`, `widen.json`,
// `arxiv-read-2.json`, `hf-read-2.json`, `judge-2.json`), so a resumed build
// skips what is on file.

import { arxivQueryTerms, normalizeArxivId } from "../sources/plugins/arxiv-client";
import { cut, material, parseJsonReply, UNTRUSTED_RULE } from "./model-io";
import { LABEL_BOUNDARY } from "./questions";
import { mergeVia, plainQuery, type ArxivFound, type Candidate, type Numbered, type RerankAnswer } from "./rank-pool";
import type { ResultWiden, WidenWhy } from "./result-types";
import type { TopicQuery, TopicSearch } from "./types";

export const JUDGE_1_FILE = "judge-1.json";
export const JUDGE_2_FILE = "judge-2.json";
export const WIDEN_FILE = "widen.json";
/** The second round's query reads, in the arXiv read's shape (arxiv-read.ts). */
export const ARXIV_READ_2_FILE = "arxiv-read-2.json";
export const HF_READ_2_FILE = "hf-read-2.json";

/** A line with fewer candidates than this at or over LABEL_BOUNDARY is a gap. */
export const WIDEN_MIN_HITS = 2;
/** Searches the second round may run: per gap, and in all. */
export const WIDEN_PER_LINE = 2;
export const WIDEN_QUERIES = 4;
/** On-topic papers the proposal sees, and the characters of each abstract. */
export const WIDEN_PAPERS = 8;
export const WIDEN_ABSTRACT_CHARS = 600;
/** A search whose words overlap a sent one's this much (Jaccard) or more repeats it. */
export const WIDEN_REPEAT = 0.5;
/** A second-round search's weight in the fusion. */
export const WIDEN_WEIGHT = 0.7;
/** Fewer new candidates than this are not judged; past WIDEN_JUDGE_MAX, the first by fusion. */
export const WIDEN_MIN_NEW = 3;
export const WIDEN_JUDGE_MAX = 30;
/** First-round candidates the second judging sees for its scale: the highest and the lowest this many. */
export const WIDEN_CALIBRATION = 3;

/** How the gap's line is named to the model: its subtopic id, or "topic". */
const WHOLE_TOPIC = "topic";

export interface WidenGap {
  subtopic: string | null;
  /** Candidates on the line at or over LABEL_BOUNDARY. */
  hits: number;
}

/** What `findGaps` reads of a scored candidate (rank-pool.ts Scored). */
export interface Judged {
  score: number;
  rerank: Pick<RerankAnswer, "score" | "subtopic"> | null;
}

/** The lines a study's search runs over: its picked subtopics, or the whole topic (null) when none is picked. */
export function linesOf(topic: TopicSearch): (string | null)[] {
  const picked = topic.subtopics.filter((s) => s.picked).map((s) => s.id);
  return picked.length ? picked : [null];
}

/** Candidates the model judged on the line whose final score is at or over LABEL_BOUNDARY; null: the whole topic. */
export function hitsOf(judged: readonly Judged[], subtopic: string | null): number {
  return judged.filter((s) => s.rerank !== null && s.score >= LABEL_BOUNDARY && (subtopic === null || s.rerank.subtopic === subtopic)).length;
}

/** The lines left short. Empty: no second round. */
export function findGaps(topic: TopicSearch, judged: readonly Judged[]): WidenGap[] {
  return linesOf(topic)
    .map((subtopic) => ({ subtopic, hits: hitsOf(judged, subtopic) }))
    .filter((g) => g.hits < WIDEN_MIN_HITS);
}

export interface WidenPaper {
  key: string;
  title: string;
  abstract: string;
}

/**
 * The on-topic papers the proposal sees: the reader's own first (`first`:
 * seeds, then pinned, then yes, as graph-expand.ts pickExamples orders them),
 * then the first round's judged at or over LABEL_BOUNDARY, best first; at most
 * WIDEN_PAPERS. A paper of the reader's the pool does not hold has its title only.
 */
export function onTopicPapers(
  first: readonly { key: string; title: string }[],
  scored: readonly (Judged & { cand: Pick<Candidate, "key" | "paper"> })[],
): WidenPaper[] {
  const out: WidenPaper[] = [];
  const byKey = new Map(scored.map((s) => [s.cand.key, s.cand.paper]));
  const have = (key: string) => out.some((o) => o.key === key);
  for (const f of first) {
    if (have(f.key)) continue;
    const paper = byKey.get(f.key);
    out.push({ key: f.key, title: paper?.title ?? f.title, abstract: paper?.abstract ?? "" });
  }
  const rest = scored
    .filter((s) => s.rerank !== null && s.score >= LABEL_BOUNDARY && s.cand.paper)
    .sort((a, b) => b.score - a.score);
  for (const s of rest) if (!have(s.cand.key)) out.push({ key: s.cand.key, title: s.cand.paper!.title, abstract: s.cand.paper!.abstract });
  return out.slice(0, WIDEN_PAPERS);
}

/** The words a search sends: what the topic's queries were searched with, or a proposal's text. */
export function sentSearches(topic: TopicSearch): string[] {
  return topic.queries.map((q) => q.arxiv ?? plainQuery(q.x)).filter(Boolean);
}

const lineId = (subtopic: string | null) => subtopic ?? WHOLE_TOPIC;

/** The prompt that asks for the second round's searches. */
export function widenPrompt(
  topic: TopicSearch,
  gaps: readonly WidenGap[],
  papers: readonly WidenPaper[],
  sent: readonly string[],
): { system: string; user: string } {
  const system = [
    "A study's first round of searches left some of its lines with almost nothing on the mark. " +
      "arXiv and Hugging Face match a search's words against titles and abstracts literally, so papers that say the same thing in other words were missed.",
    `Write new searches for those lines only: at most ${WIDEN_PER_LINE} per line and ${WIDEN_QUERIES} in all.`,
    "Each search is 2 to 5 English words, the words a paper on that line would use in its title or abstract. " +
      "Take them from the papers shown where you can, not from the topic's own wording.",
    "Never send a search already sent again, nor its words in another order.",
    `Answer with JSON only: {"queries": [{"line": "<the line's id as given>", "text": "<the search>"}]}. An empty list when you have nothing better than what was sent.`,
    UNTRUSTED_RULE,
  ].join("\n");
  const names = new Map(topic.subtopics.map((s) => [s.id, s.name]));
  const user = [
    `Topic: ${topic.name}`,
    `Scope: ${topic.scope}`,
    "Lines left short:",
    ...gaps.map((g) => `- ${lineId(g.subtopic)}: ${g.subtopic === null ? "the whole topic" : (names.get(g.subtopic) ?? g.subtopic)} (${g.hits} on the mark)`),
    "Searches already sent:",
    ...sent.map((s) => `- ${s}`),
    "",
    "Papers on the mark:",
    ...papers.map((p, i) => material(`p${i + 1}`, [p.title, cut(p.abstract, WIDEN_ABSTRACT_CHARS)].filter(Boolean).join("\n"))),
  ].join("\n");
  return { system, user };
}

export interface WidenProposal {
  /** The line as the model named it. */
  line: string;
  text: string;
}

/** The model's proposals, malformed ones dropped; throws when the reply holds no list. */
export function parseProposals(text: string): WidenProposal[] {
  const raw = parseJsonReply(text);
  const list = Array.isArray(raw) ? raw : (raw as { queries?: unknown }).queries;
  if (!Array.isArray(list)) throw new Error("the reply has no queries");
  const out: WidenProposal[] = [];
  for (const v of list) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const search = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const line = typeof o.line === "string" ? o.line.trim() : o.line === null ? WHOLE_TOPIC : "";
    if (search) out.push({ line, text: search });
  }
  return out;
}

export type WidenRejection = "not_a_gap" | "too_few_words" | "not_in_papers" | "repeat" | "over_limit";

/** A proposal after the checks: numbered (`id`) when it passed, else why not. */
export type WidenChecked = {
  line: string;
  subtopic: string | null;
  text: string;
  id: string | null;
  rejected: WidenRejection | null;
};

/** Every word of a text, a hyphenated word whole and in its parts, lower case. */
export function vocabularyOf(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return new Set(words.flatMap((w) => (w.includes("-") ? [w, ...w.split("-")] : [w])).filter((w) => w.length > 2));
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const both = [...sa].filter((w) => sb.has(w)).length;
  const either = new Set([...sa, ...sb]).size;
  return either ? both / either : 0;
}

/**
 * The checks (docs/info/92 第二轮查询 4-5), in the model's order: the line is
 * a gap; at least two searchable words (arxiv-client.ts arxivQueryTerms); one
 * of them in the on-topic papers' text; word-set Jaccard under WIDEN_REPEAT
 * against every search sent, those passed before it included; then the limits.
 * What fails is dropped, never rewritten. What passes is numbered w1 … .
 */
export function checkProposals(
  proposals: readonly WidenProposal[],
  gaps: readonly WidenGap[],
  sent: readonly string[],
  papers: readonly WidenPaper[],
): WidenChecked[] {
  const lines = new Map(gaps.map((g) => [lineId(g.subtopic), g.subtopic]));
  const vocabulary = vocabularyOf(papers.map((p) => `${p.title}\n${p.abstract}`).join("\n"));
  const sentWords = sent.map(arxivQueryTerms);
  const perLine = new Map<string | null, number>();
  let n = 0;
  return proposals.map((p) => {
    const subtopic = lines.has(p.line) ? lines.get(p.line)! : null;
    const rejected = (why: WidenRejection): WidenChecked => ({ line: p.line, subtopic, text: p.text, id: null, rejected: why });
    if (!lines.has(p.line)) return rejected("not_a_gap");
    const words = arxivQueryTerms(p.text);
    if (words.length < 2) return rejected("too_few_words");
    if (!words.some((w) => vocabulary.has(w))) return rejected("not_in_papers");
    if (sentWords.some((s) => jaccard(words, s) >= WIDEN_REPEAT)) return rejected("repeat");
    if (n >= WIDEN_QUERIES || (perLine.get(subtopic) ?? 0) >= WIDEN_PER_LINE) return rejected("over_limit");
    n++;
    perLine.set(subtopic, (perLine.get(subtopic) ?? 0) + 1);
    sentWords.push(words);
    return { line: p.line, subtopic, text: p.text, id: `w${n}`, rejected: null };
  });
}

/**
 * The passed searches as queries of this run only: weight WIDEN_WEIGHT, the
 * ranking question of the line's first query (the topic's first for a line
 * none has), no X words. Never written back to the topic.
 */
export function widenQueries(topic: TopicSearch, checked: readonly WidenChecked[]): TopicQuery[] {
  return checked
    .filter((c) => c.id !== null)
    .map((c) => ({
      id: c.id!,
      subtopic: c.subtopic,
      x: "",
      arxiv: c.text,
      ranking: (topic.queries.find((q) => q.subtopic === c.subtopic) ?? topic.queries[0])?.ranking ?? topic.scope,
      weight: WIDEN_WEIGHT,
    }));
}

/** The topic as the second round's pool sees it: its queries and this run's second-round ones. */
export function widenedTopic(topic: TopicSearch, queries: readonly TopicQuery[]): TopicSearch {
  return queries.length ? { ...topic, queries: [...topic.queries, ...queries] } : topic;
}

/** "w1|arxiv", "w2|huggingface": a second-round query's stream (rank-pool.ts streamKey). */
export const isWidenStream = (stream: string): boolean => /^w\d+\|/.test(stream);

/** Mark the candidates a second-round query found with that way in (`via` kind "query2", `from`: the query ids). */
export function markQuery2(candidates: readonly Candidate[]): void {
  for (const c of candidates) {
    const from = [...new Set(c.foundIn.filter(isWidenStream).map((s) => s.slice(0, s.indexOf("|"))))];
    if (from.length) c.via = mergeVia([c.via, [{ kind: "query2", from }]]);
  }
}

/** Candidates of the fused pool a second-round query found that the first pool lacked, in fusion order, at most WIDEN_JUDGE_MAX. */
export function newCandidates<T extends { cand: Pick<Candidate, "key" | "foundIn"> }>(fused: readonly T[], firstPool: ReadonlySet<string>): T[] {
  return fused.filter((f) => !firstPool.has(f.cand.key) && f.cand.foundIn.some(isWidenStream)).slice(0, WIDEN_JUDGE_MAX);
}

/** The first round's judged candidates the second judging is shown for its scale: the highest and the lowest WIDEN_CALIBRATION. */
export function calibrationBlock(judged: readonly { score: number; title: string }[]): string {
  const sorted = [...judged].sort((a, b) => b.score - a.score);
  const shown = [...sorted.slice(0, WIDEN_CALIBRATION), ...sorted.slice(Math.max(WIDEN_CALIBRATION, sorted.length - WIDEN_CALIBRATION))];
  if (!shown.length) return "";
  return [
    "Judged earlier in this run, for your scale (not candidates: answer nothing for them):",
    material("judged", shown.map((j) => `${Math.round(j.score)}: ${cut(j.title, 160)}`).join("\n")),
  ].join("\n");
}

const UNANSWERED = ["cooling_down", "rate_limited", "failed"] as const;

/** How each second-round query went: searched with papers, searched with none, or not searched (no source answered). */
export function queryResults(queries: readonly TopicQuery[], found: readonly ArxivFound[]): ResultWiden["queries"] {
  return queries.map((q) => {
    const answered = found.filter((f) => f.query === q.id && f.error === null);
    const ids = new Set(answered.flatMap((f) => f.items.map((i) => normalizeArxivId(i.sourceKey ?? i.url)).filter((id): id is string => !!id)));
    return {
      id: q.id,
      subtopic: q.subtopic,
      text: q.arxiv ?? "",
      outcome: answered.length === 0 ? "not_searched" : ids.size ? "ok" : "empty",
      found: ids.size,
    };
  });
}

/** Why no source answered a line's queries: the first of cooling down, rate limited, failed among their reads. */
function unansweredWhy(ids: readonly string[], found: readonly ArxivFound[]): WidenWhy {
  const outcomes = new Set(found.filter((f) => ids.includes(f.query)).map((f) => f.ladder?.outcome ?? "failed"));
  return UNANSWERED.find((o) => outcomes.has(o)) ?? "failed";
}

/** What the second round came to, for the lines it set out to fill. */
export interface WidenRound {
  /** The checked proposals; null when the proposal was not made or failed (`stopped` says why). */
  checked: readonly WidenChecked[] | null;
  /** Why no search was sent for any line: no paper source, the proposal call failed or the calls ran out. */
  stopped?: Extract<WidenWhy, "no_source" | "proposal_failed">;
  results: ResultWiden["queries"];
  /** The second round's reads, arXiv and Hugging Face. */
  found: readonly ArxivFound[];
  /** The second judging was due and gave no answer: what the round found was left out. */
  unjudged: boolean;
}

/**
 * The gaps still short after both rounds, said plainly: `empty` when the line
 * was searched in both rounds and nothing is on the mark; `not_searched`, with
 * why, when the second round sent it no search or no source answered, or its
 * finds could not be judged. A line the second round brought to one hit is
 * not listed: the book shows that hit.
 */
export function widenLines(gaps: readonly WidenGap[], after: readonly Judged[], round: WidenRound): ResultWiden["lines"] {
  const out: ResultWiden["lines"] = [];
  for (const g of gaps) {
    const hits = hitsOf(after, g.subtopic);
    if (hits >= WIDEN_MIN_HITS) continue;
    const ids = (round.checked ?? []).filter((c) => c.id !== null && c.subtopic === g.subtopic).map((c) => c.id!);
    const searched = round.results.some((r) => ids.includes(r.id) && r.outcome !== "not_searched");
    const why: WidenWhy | null = round.stopped
      ? round.stopped
      : !ids.length
        ? "no_query"
        : !searched
          ? unansweredWhy(ids, round.found)
          : round.unjudged
            ? "unjudged"
            : null;
    if (why) out.push({ subtopic: g.subtopic, status: "not_searched", why });
    else if (hits === 0) out.push({ subtopic: g.subtopic, status: "empty" });
  }
  return out;
}

// Types, not interfaces: they go to disk as JSON.
/** A judging on file: the pool's keys in their numbering and the model's answers by number. */
export type JudgeFile = { version: 1; keys: string[]; answers: Record<string, RerankAnswer> };

export function judgeFileBody(numbered: readonly Numbered[], answers: ReadonlyMap<string, RerankAnswer>): string {
  const file: JudgeFile = { version: 1, keys: numbered.map((n) => n.cand.key), answers: Object.fromEntries(answers) };
  return `${JSON.stringify(file)}\n`;
}

/** The answers on file for this very pool (same keys, same numbering); null for none, another pool, or a file that does not read. */
export function judgeOnFile(text: string | null, numbered: readonly Numbered[]): Map<string, RerankAnswer> | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as Partial<JudgeFile>;
    if (v.version !== 1 || !Array.isArray(v.keys) || !v.answers || typeof v.answers !== "object") return null;
    if (v.keys.length !== numbered.length || v.keys.some((k, i) => numbered[i].cand.key !== k)) return null;
    const out = new Map<string, RerankAnswer>();
    for (const [c, a] of Object.entries(v.answers)) {
      if (!numbered.some((n) => n.c === c) || typeof a?.score !== "number" || typeof a.main !== "string") return null;
      out.set(c, a);
    }
    return out;
  } catch {
    return null;
  }
}

/** `widen.json`: the gaps, what the model proposed and the checks made of it, and once the round is over, its result. */
export type WidenFile = {
  version: 1;
  gaps: WidenGap[];
  /** Null when no proposal was made (`stopped`). */
  checked: WidenChecked[] | null;
  stopped?: WidenRound["stopped"];
  /** The proposal call's error, when it failed. */
  error?: string;
  result?: ResultWiden;
};

/** A `widen.json` for these gaps; null for none, other gaps, or a file that does not read. */
export function widenOnFile(text: string | null, gaps: readonly WidenGap[] | null): WidenFile | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as WidenFile;
    if (v?.version !== 1 || !Array.isArray(v.gaps) || (v.checked !== null && !Array.isArray(v.checked))) return null;
    if (gaps && JSON.stringify(v.gaps) !== JSON.stringify(gaps)) return null;
    return v;
  } catch {
    return null;
  }
}
