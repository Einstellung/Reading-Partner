// Lumen's opening for one issue, written when the issue is assembled (docs/info/88
// 「简报的对话」「攒着问」) and kept on the issue's row of info-shelf.json. Pure.
//
// What the opening says splits the usual way: the program says the facts (the
// date, how many items) when it is spoken, in the reader's language; the model
// writes only the judgement — which items are worth reading — and refers to an
// item by its number, [1], [2] …. Those numbers are turned into page citations
// of the item's heading when the issue is opened, because pages exist only once
// the reader has paginated the book.
//
// The questions are the ones the night's results carry (each result already
// within its topic's cap, topic-search/questions.ts), at most three an issue,
// taken a topic at a time. The ones that do not fit go back to their queue as
// not asked. Quick answers: the model's for its own questions; a metric
// question's come from its template, worded when spoken.

import type { QuestionsFile } from "../topic-search/questions";
import type { ResultQuestion, TopicSearchResult } from "../topic-search/result-types";
import type { IssuePlan, PlannedItem } from "./plan";
import { itemLabel } from "./plan";
import { itemHeading } from "./render";

/** Questions one issue asks (docs/info/88 「攒着问」). */
export const ISSUE_QUESTIONS_MAX = 3;
/** Quick answers a question offers besides "in my own words". */
export const QUICK_MAX = 3;
const QUICK_CHARS = 60;

export interface OpeningQuestion {
  /** The queue's id (topic-search/questions.ts questionId). */
  id: string;
  searchId: string;
  topic: string;
  resultId: string;
  text: string;
  template: ResultQuestion["template"];
  /** The model's quick answers; empty for a metric question, whose come from its template. */
  quick: string[];
}

export interface IssueOpeningRecord {
  /** Lumen's judgement, items as [1], [2] …; null when the model wrote nothing usable. */
  text: string | null;
  /** What [n] stands for: the heading its page is found by when the issue is opened. */
  items: { n: number; heading: string }[];
  questions: OpeningQuestion[];
}

/** The items the model may point at: the entries, then the Notes, numbered from 1. */
export function openingItems(plan: IssuePlan): (PlannedItem & { n: number })[] {
  return [...plan.entries, ...plan.notes].map((p, i) => ({ ...p, n: i + 1 }));
}

/**
 * The issue's questions: a topic at a time, each result's first before any
 * second, at most ISSUE_QUESTIONS_MAX; `left` are the ones that did not fit.
 */
export function pickIssueQuestions(
  results: readonly TopicSearchResult[],
  topicName: (searchId: string, fallback: string) => string,
  max = ISSUE_QUESTIONS_MAX,
): { asked: OpeningQuestion[]; left: { searchId: string; id: string }[] } {
  const asked: OpeningQuestion[] = [];
  const left: { searchId: string; id: string }[] = [];
  const depth = Math.max(0, ...results.map((r) => r.questions.length));
  for (let i = 0; i < depth; i++) {
    for (const r of results) {
      const q = r.questions[i];
      if (!q) continue;
      if (asked.length >= max || asked.some((a) => a.id === q.id)) {
        left.push({ searchId: r.searchId, id: q.id });
        continue;
      }
      asked.push({
        id: q.id,
        searchId: r.searchId,
        topic: topicName(r.searchId, r.name),
        resultId: r.id,
        text: q.text,
        template: q.template,
        quick: [],
      });
    }
  }
  return { asked, left: left.filter((l) => !asked.some((a) => a.id === l.id && a.searchId === l.searchId)) };
}

/** The questions file with the ones an issue had no room for waiting again. */
export function returnUnasked(file: QuestionsFile, left: readonly { searchId: string; id: string }[]): QuestionsFile {
  if (left.length === 0) return file;
  const topics = { ...file.topics };
  for (const [searchId, entry] of Object.entries(topics)) {
    const back = new Set(left.filter((l) => l.searchId === searchId).map((l) => l.id));
    if (back.size === 0) continue;
    topics[searchId] = {
      questions: entry.questions.map((q) => (back.has(q.id) ? { ...q, askedIn: null, askedAt: null } : q)),
    };
  }
  return { ...file, topics };
}

/** The model's prompt for the opening. */
export function openingPrompt(plan: IssuePlan, questions: readonly OpeningQuestion[], language: string): { system: string; user: string } {
  const system = [
    "You are Lumen, the reader's companion, who briefs them every morning. The reader has just opened today's brief.",
    "Write what you say first, in two or three sentences: which items are worth their time today and why, in plain words.",
    "Point at an item by its number in square brackets, like [2]; point at two or three at most.",
    "Do not say the date or how many items there are, and do not greet: the app says that before you.",
    "Do not ask the questions; they are shown to the reader separately.",
    "For each question listed, give two or three short replies the reader could tap, in the reader's own voice, each under eight words, covering the likely answers.",
    "",
    'Reply with JSON only: {"opening": "...", "quick": {"Q1": ["...", "..."]}}',
    language,
  ]
    .filter(Boolean)
    .join("\n");
  const items = openingItems(plan).map(
    (p) => `[${p.n}] ${itemLabel(p)}: ${p.item.title}${p.item.summary ? ` — ${p.item.summary}` : ""} (score ${p.item.score}${p.n > plan.entries.length ? ", in the Notes" : ""})`,
  );
  const asks = questions.map((q, i) => `Q${i + 1} (${q.topic}): ${q.text}${q.template ? " [fixed replies; give none]" : ""}`);
  const user = ["Items:", ...items, ...(asks.length ? ["", "Questions:", ...asks] : [])].join("\n");
  return { system, user };
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The record from the model's reply (null for none, or one that would not
 * parse): numbers past the items dropped, quick answers trimmed and capped.
 */
export function openingRecord(plan: IssuePlan, questions: readonly OpeningQuestion[], reply: string | null): IssueOpeningRecord {
  const items = openingItems(plan).map((p) => ({ n: p.n, heading: itemHeading(p.item) }));
  const parsed = reply ? firstJsonObject(reply) : null;
  const raw = typeof parsed?.opening === "string" ? parsed.opening : "";
  const text = raw
    .replace(/\[(\d+)\]/g, (whole, n: string) => (items.some((i) => i.n === Number(n)) ? whole : ""))
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const quick = parsed?.quick && typeof parsed.quick === "object" ? (parsed.quick as Record<string, unknown>) : {};
  return {
    text: text || null,
    items,
    questions: questions.map((q, i) => {
      const given = quick[`Q${i + 1}`];
      const replies = q.template || !Array.isArray(given)
        ? []
        : given
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim())
            .filter((s) => s && [...s].length <= QUICK_CHARS)
            .slice(0, QUICK_MAX);
      return { ...q, quick: replies };
    }),
  };
}
