// Questions saved up for the reader (docs/info/88 「攒着问」). A run never
// interrupts; what it could not decide goes into the topic's queue and out at
// the end of a later result. Two kinds: the model's doubts (from the rerank and
// the write-up), and the program's, worked out from the results' numbers by
// template — a subtopic quiet for 7 days, more than half the finds naming no
// anchor, one `avoid` keeping out many candidates several days running.
//
// A result carries at most 3 questions, and from the fourth result on at most
// 1. A question asked once is never asked again, answered or not; one that
// repeats an answer the reader already gave is dropped (by the model's mark in
// the write-up, and before that by wording).
//
// The queue is `info-topic-search-questions.json`, synced and records-merged on
// the search id like info-topic-searches.json beside it: only the collecting
// desktop writes it, but the next run may be claimed by another desktop, and
// what was asked must follow the topic there, not stay on one machine.

import { headlineTokens } from "../rank/dedupe";
import type { ResultQuestion, ResultStats, TopicSearchResult } from "./result-types";
import type { TopicSearch } from "./types";

export const QUESTIONS_FILE = "info-topic-search-questions.json";
export const QUESTIONS_VERSION = 1;

/** Questions per result: the first three results, and every one after. */
export const QUESTIONS_EARLY = 3;
export const QUESTIONS_LATER = 1;
export const EARLY_RESULTS = 3;
/** Days a picked subtopic may bring nothing before the program asks about it. */
export const QUIET_DAYS = 7;
/** Candidates past the floor needed before the anchor miss rate means anything. */
export const ANCHOR_MIN_CANDIDATES = 10;
/** One avoid phrase keeping out this many a run, this many results running. */
export const AVOID_BLOCKS = 10;
export const AVOID_RUNS = 3;

export interface PendingQuestion {
  id: string;
  text: string;
  source: "model" | "metric";
  template: ResultQuestion["template"];
  /** What the question is about: candidate keys, a subtopic id, an avoid phrase. */
  about: string[];
  raisedAt: number;
  /** The result it went out with; null while it waits. */
  askedIn: string | null;
  askedAt: number | null;
}

export interface QuestionsFile {
  version: typeof QUESTIONS_VERSION;
  topics: Record<string, { questions: PendingQuestion[] }>;
}

export interface QuestionsIo {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export function parseQuestionsFile(text: string | null): QuestionsFile {
  if (!text) return { version: QUESTIONS_VERSION, topics: {} };
  const v = JSON.parse(text) as Partial<QuestionsFile>;
  if (v.version !== QUESTIONS_VERSION || !v.topics || typeof v.topics !== "object") {
    throw new Error(`${QUESTIONS_FILE} is not a version ${QUESTIONS_VERSION} file`);
  }
  return v as QuestionsFile;
}

/** "q-" + FNV-1a of the wording, so the same question raised twice is one entry. */
export function questionId(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `q-${h.toString(16).padStart(8, "0")}`;
}

export type NewQuestion = Omit<PendingQuestion, "id" | "raisedAt" | "askedIn" | "askedAt">;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The program's questions from this run's numbers and the topic's past results (newest last). */
export function metricQuestions(topic: TopicSearch, today: string, stats: ResultStats, past: readonly TopicSearchResult[]): NewQuestion[] {
  const out: NewQuestion[] = [];
  const first = past.reduce<string | null>((min, r) => (min === null || r.date < min ? r.date : min), null);
  const windowStart = addDays(today, -(QUIET_DAYS - 1));
  if (first !== null && first <= addDays(today, -QUIET_DAYS)) {
    const recent = past.filter((r) => r.date >= windowStart);
    for (const s of topic.subtopics.filter((x) => x.picked)) {
      const quiet = (stats.subtopicItems[s.id] ?? 0) === 0 && recent.every((r) => (r.stats.subtopicItems[s.id] ?? 0) === 0);
      if (!quiet) continue;
      out.push({
        text: `Nothing has come up under "${s.name}" for ${QUIET_DAYS} days. Keep it, word it differently, or drop it?`,
        source: "metric",
        template: { code: "subtopic-quiet", params: { subtopic: s.name, days: QUIET_DAYS } },
        about: [`subtopic:${s.id}`],
      });
    }
  }
  if (stats.passedFloor >= ANCHOR_MIN_CANDIDATES && stats.anchorMiss > 0.5 && topic.anchors.length) {
    out.push({
      text: `More than half of what the searches found never mentions ${topic.anchors.map((a) => `"${a}"`).join(", ")}. Are those the right words to tell this topic apart?`,
      source: "metric",
      template: { code: "anchor-miss", params: { anchors: topic.anchors.join(", "), share: Math.round(stats.anchorMiss * 100) } },
      about: ["anchors"],
    });
  }
  const lastRuns = past.slice(-(AVOID_RUNS - 1));
  if (lastRuns.length === AVOID_RUNS - 1) {
    for (const phrase of topic.avoid) {
      const runs = [...lastRuns.map((r) => r.stats.avoidBlocked[phrase] ?? 0), stats.avoidBlocked[phrase] ?? 0];
      if (runs.every((n) => n >= AVOID_BLOCKS)) {
        out.push({
          text: `"${phrase}" has kept out ${Math.min(...runs)} or more finds in each of the last ${AVOID_RUNS} runs. Is that still what you want left out?`,
          source: "metric",
          template: { code: "avoid-blocks", params: { avoid: phrase, runs: AVOID_RUNS, least: Math.min(...runs) } },
          about: [`avoid:${phrase}`],
        });
      }
    }
  }
  return out;
}

function similar(a: string, b: string): boolean {
  const ta = headlineTokens(a);
  const tb = headlineTokens(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union > 0 && shared >= 3 && shared / union >= 0.5;
}

/**
 * The queue with this run's new questions added: one that is already queued
 * (asked or not, by id or by wording, or about the same thing for a metric
 * question) or that repeats an answer is not added.
 */
export function enqueue(queue: readonly PendingQuestion[], fresh: readonly NewQuestion[], topic: TopicSearch, now: number): PendingQuestion[] {
  const out = [...queue];
  for (const q of fresh) {
    const id = questionId(q.text);
    const dup = out.some(
      (p) =>
        p.id === id ||
        similar(p.text, q.text) ||
        (q.source === "metric" && p.source === "metric" && p.askedIn === null && p.about.join() === q.about.join()),
    );
    if (dup || topic.answers.some((a) => similar(a.asked, q.text))) continue;
    out.push({ ...q, id, raisedAt: now, askedIn: null, askedAt: null });
  }
  return out;
}

/** How many questions this result may carry, given how many results came before it. */
export function questionCap(earlierResults: number): number {
  return earlierResults < EARLY_RESULTS ? QUESTIONS_EARLY : QUESTIONS_LATER;
}

/** Waiting questions, oldest first, the program's before the model's at the same age. */
export function waiting(queue: readonly PendingQuestion[]): PendingQuestion[] {
  return queue
    .filter((q) => q.askedIn === null)
    .sort((a, b) => a.raisedAt - b.raisedAt || (a.source === b.source ? 0 : a.source === "metric" ? -1 : 1));
}

/**
 * Pick what goes out with a result: up to `cap` waiting questions not marked as
 * repeats, marked asked. Repeats leave the queue as asked-by-nobody (never
 * asked, never offered again).
 */
export function pickQuestions(
  queue: readonly PendingQuestion[],
  repeats: ReadonlySet<string>,
  cap: number,
  resultId: string,
  now: number,
): { asked: PendingQuestion[]; queue: PendingQuestion[] } {
  const chosen = new Set(waiting(queue).filter((q) => !repeats.has(q.id)).slice(0, cap).map((q) => q.id));
  const next = queue
    .filter((q) => !(q.askedIn === null && repeats.has(q.id)))
    .map((q) => (chosen.has(q.id) ? { ...q, askedIn: resultId, askedAt: now } : q));
  return { asked: next.filter((q) => chosen.has(q.id)), queue: next };
}

export async function loadQueue(io: QuestionsIo, searchId: string): Promise<{ file: QuestionsFile; queue: PendingQuestion[] }> {
  const file = parseQuestionsFile(await io.read(QUESTIONS_FILE));
  return { file, queue: file.topics[searchId]?.questions ?? [] };
}

export async function saveQueue(io: QuestionsIo, searchId: string, queue: PendingQuestion[]): Promise<void> {
  // Read again right before writing: only this topic's record is ours to change.
  const file = parseQuestionsFile(await io.read(QUESTIONS_FILE));
  file.topics[searchId] = { questions: queue };
  await io.write(QUESTIONS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}
