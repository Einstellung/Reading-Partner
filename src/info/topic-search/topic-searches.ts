// Reading a topic-searches file, and every change a door tool makes to one
// record (docs/info/88 主题配置, 记忆回写). Pure, unit-tested; the filesystem is
// store.ts next door.

import { isObject } from "../../platform/std/json";
import {
  TOPIC_SEARCHES_VERSION,
  type TopicAnswer,
  type TopicQuery,
  type TopicSearch,
  type TopicSearchStatus,
  type TopicSubtopic,
} from "./types";

// One file's worth of searches: the records this build understands, and the
// entries it does not. Same reasoning as labs.ts: a record a newer build wrote
// still carries the id the records merge keys on, so a write from here carries
// it through; an entry with no id, or a second one under a taken id, is in
// neither list and the bytes are set aside before the next write.
export interface ParsedTopicSearches {
  searches: TopicSearch[];
  foreign: unknown[];
  repaired: boolean;
}

const STATUSES: readonly TopicSearchStatus[] = ["active", "stopped"];

export function parseTopicSearchesFile(raw: unknown): ParsedTopicSearches | null {
  if (!isObject(raw)) return null;
  const list = raw.searches;
  if (!Array.isArray(list)) return null;
  const searches: TopicSearch[] = [];
  const foreign: unknown[] = [];
  const seen = new Set<string>();
  let repaired = false;
  for (const entry of list) {
    const id = entryId(entry);
    if (id === "" || seen.has(id)) {
      repaired = true;
      continue;
    }
    seen.add(id);
    const search = validateTopicSearch(entry);
    if (search) searches.push(search);
    else foreign.push(entry);
  }
  return { searches, foreign, repaired };
}

export function entryId(entry: unknown): string {
  if (!isObject(entry)) return "";
  return typeof entry.id === "string" ? entry.id : "";
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

// A stored entry read as a TopicSearch, or null when a field this build
// depends on is missing or of the wrong type. Unknown fields ride along: a
// search written before 2026-10-15 still carries the reading topic it was
// filed under (`topicId`), which nothing reads any more.
export function validateTopicSearch(entry: unknown): TopicSearch | null {
  if (!isObject(entry)) return null;
  if (typeof entry.id !== "string" || entry.id === "") return null;
  if (typeof entry.name !== "string") return null;
  if (entry.concernId !== null && typeof entry.concernId !== "string") return null;
  if (typeof entry.scope !== "string") return null;
  if (!STATUSES.includes(entry.status as TopicSearchStatus)) return null;
  if (typeof entry.revision !== "number" || typeof entry.createdAt !== "number") return null;
  if (entry.lastRunAt !== null && typeof entry.lastRunAt !== "number") return null;
  for (const key of ["want", "avoid", "judgments", "anchors"] as const) {
    if (!isStrings(entry[key])) return null;
  }
  if (!Array.isArray(entry.subtopics) || !Array.isArray(entry.queries) || !Array.isArray(entry.answers)) {
    return null;
  }
  return entry as unknown as TopicSearch;
}

export function activeTopicSearches(searches: readonly TopicSearch[]): TopicSearch[] {
  return searches.filter((s) => s.status === "active");
}

/** The body to write for a list of searches. */
export function topicSearchesFileBody(
  searches: readonly TopicSearch[],
  foreign: readonly unknown[] = [],
): string {
  return JSON.stringify({ version: TOPIC_SEARCHES_VERSION, searches: [...searches, ...foreign] }, null, 2);
}

const HEX = "0123456789abcdef";

/** A fresh "ts-" + 8 hex id. `random` is a parameter so a test can pin it. */
export function newTopicSearchId(random: () => number = Math.random): string {
  let out = "ts-";
  for (let i = 0; i < 8; i++) out += HEX[Math.floor(random() * 16) % 16];
  return out;
}

const fold = (s: string) => s.trim().toLowerCase();

/** Which search the model meant, by id or by the name it was shown. */
export function resolveTopicSearch(raw: string, searches: readonly TopicSearch[]): TopicSearch | null {
  const wanted = raw.trim();
  if (!wanted) return null;
  return searches.find((s) => s.id === wanted) ?? searches.find((s) => fold(s.name) === fold(wanted)) ?? null;
}

/** An active search already answering to this name. */
export function activeNameTaken(name: string, searches: readonly TopicSearch[]): TopicSearch | null {
  return activeTopicSearches(searches).find((s) => fold(s.name) === fold(name)) ?? null;
}

// --- Drafting: what the model hands in, numbered by the program --------------

export interface DraftSubtopic {
  name: string;
  picked: boolean;
}

export interface DraftQuery {
  // The subtopic by the name the draft gave it; empty for the whole topic.
  subtopic: string;
  x: string;
  arxiv: string;
  ranking: string;
}

// Initial values from docs/info/88: one to two queries per picked subtopic and
// one to four over the whole topic; weight 1.0 for the topic, 0.6 to 0.8 for a
// subtopic.
const PER_SUBTOPIC = 2;
const WHOLE_TOPIC = 4;
const TOPIC_WEIGHT = 1;
const SUBTOPIC_WEIGHT = 0.7;

/** Subtopics numbered st1, st2… in the order drafted; a repeated name is kept once. */
export function numberSubtopics(draft: readonly DraftSubtopic[]): TopicSubtopic[] {
  const out: TopicSubtopic[] = [];
  for (const s of draft) {
    const name = s.name.trim();
    if (!name || out.some((o) => fold(o.name) === fold(name))) continue;
    out.push({ id: `st${out.length + 1}`, name, picked: s.picked });
  }
  return out;
}

/**
 * The drafted queries as the config stores them: numbered q1, q2…, each tied
 * to a subtopic id, weighted by the program. A query for a subtopic the reader
 * did not pick, or one the draft never named, is dropped, and so is anything
 * past the per-subtopic and whole-topic counts.
 */
export function numberQueries(draft: readonly DraftQuery[], subtopics: readonly TopicSubtopic[]): TopicQuery[] {
  const out: TopicQuery[] = [];
  const count = new Map<string | null, number>();
  for (const q of draft) {
    const x = q.x.trim();
    if (!x) continue;
    const named = q.subtopic.trim();
    let subtopic: string | null = null;
    if (named) {
      const hit = subtopics.find((s) => s.id === named || fold(s.name) === fold(named));
      if (!hit || !hit.picked) continue;
      subtopic = hit.id;
    }
    const n = count.get(subtopic) ?? 0;
    if (n >= (subtopic === null ? WHOLE_TOPIC : PER_SUBTOPIC)) continue;
    count.set(subtopic, n + 1);
    const arxiv = q.arxiv.trim();
    out.push({
      id: `q${out.length + 1}`,
      subtopic,
      x,
      arxiv: arxiv || null,
      ranking: q.ranking.trim(),
      weight: subtopic === null ? TOPIC_WEIGHT : SUBTOPIC_WEIGHT,
    });
  }
  return out;
}

// --- update_topic_search -----------------------------------------------------

export interface ListEdit {
  add?: readonly string[];
  remove?: readonly string[];
}

export interface TopicSearchUpdate {
  scope?: string;
  want?: ListEdit;
  avoid?: ListEdit;
  judgments?: ListEdit;
  anchors?: ListEdit;
  // Subtopics by id or name. `add` drafts new ones, picked.
  pick?: readonly string[];
  unpick?: readonly string[];
  addSubtopics?: readonly string[];
  // Replaces every query when given: queries follow the subtopics, and only
  // the model that changed those knows what to search for now.
  queries?: readonly DraftQuery[];
  // What the reader said in answer to a question, word for word.
  answers?: readonly { asked: string; answer: string }[];
}

function editList(list: readonly string[], edit: ListEdit | undefined): string[] {
  if (!edit) return [...list];
  const drop = new Set((edit.remove ?? []).map(fold));
  const out = list.filter((s) => !drop.has(fold(s)));
  for (const raw of edit.add ?? []) {
    const s = raw.trim();
    if (s && !out.some((o) => fold(o) === fold(s))) out.push(s);
  }
  return out;
}

function findSubtopic(subtopics: readonly TopicSubtopic[], raw: string): TopicSubtopic | undefined {
  const w = raw.trim();
  return subtopics.find((s) => s.id === w) ?? subtopics.find((s) => fold(s.name) === fold(w));
}

/** Whether an update changes anything at all. */
export function isEmptyUpdate(u: TopicSearchUpdate): boolean {
  const list = (e?: ListEdit) => !e || ((e.add?.length ?? 0) === 0 && (e.remove?.length ?? 0) === 0);
  return (
    (u.scope === undefined || u.scope.trim() === "") &&
    list(u.want) &&
    list(u.avoid) &&
    list(u.judgments) &&
    list(u.anchors) &&
    !u.pick?.length &&
    !u.unpick?.length &&
    !u.addSubtopics?.length &&
    u.queries === undefined &&
    !u.answers?.length
  );
}

/**
 * One update applied to one search, with the revision bumped. Subtopics never
 * lose their ids: unpicking keeps the record so picking it again is the same
 * subtopic, and its queries go with it unless the update brings new ones.
 */
export function applyTopicSearchUpdate(search: TopicSearch, u: TopicSearchUpdate, now: number): TopicSearch {
  const subtopics = search.subtopics.map((s) => ({ ...s }));
  for (const raw of u.addSubtopics ?? []) {
    const name = raw.trim();
    if (!name) continue;
    const had = findSubtopic(subtopics, name);
    if (had) had.picked = true;
    else subtopics.push({ id: nextSubtopicId(subtopics), name, picked: true });
  }
  for (const raw of u.pick ?? []) {
    const hit = findSubtopic(subtopics, raw);
    if (hit) hit.picked = true;
  }
  for (const raw of u.unpick ?? []) {
    const hit = findSubtopic(subtopics, raw);
    if (hit) hit.picked = false;
  }
  const picked = new Set(subtopics.filter((s) => s.picked).map((s) => s.id));
  const queries = u.queries
    ? numberQueries(u.queries, subtopics)
    : search.queries.filter((q) => q.subtopic === null || picked.has(q.subtopic));
  const answers: TopicAnswer[] = [
    ...search.answers,
    ...(u.answers ?? [])
      .map((a) => ({ asked: a.asked.trim(), answer: a.answer.trim(), at: now }))
      .filter((a) => a.answer !== ""),
  ];
  const scope = u.scope?.trim();
  return {
    ...search,
    scope: scope ? scope : search.scope,
    subtopics,
    want: editList(search.want, u.want),
    avoid: editList(search.avoid, u.avoid),
    judgments: editList(search.judgments, u.judgments),
    anchors: editList(search.anchors, u.anchors),
    queries,
    answers,
    revision: search.revision + 1,
  };
}

function nextSubtopicId(subtopics: readonly TopicSubtopic[]): string {
  let n = subtopics.length + 1;
  while (subtopics.some((s) => s.id === `st${n}`)) n++;
  return `st${n}`;
}

/** Stopped: no more runs. The record and everything in it stay. */
export function stopTopicSearch(search: TopicSearch): TopicSearch {
  return { ...search, status: "stopped", revision: search.revision + 1 };
}
