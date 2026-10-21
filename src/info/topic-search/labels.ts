// A topic's labels (docs/info/91 标签): what the reader said of single items —
// on the mark, off it, borderline, pinned — each with their own words and the
// context it was said in. One file per search, `topic-search-labels-<id>.json`,
// synced and records-merged on the label id (palace/kinds.ts). Append-only: a
// later label of the same item outranks an earlier one by `at`, and the
// earlier one stays. They are the topic's gold set for the offline replay and
// the raw material of docs/north-star/decision-data.md; they never leave the
// reader's devices from here.
//
// Read through readGuardedFile for the reason info-topic-searches.json is
// (store.ts): nothing can rebuild what the reader said, so a read that failed
// must not become the list that gets written.

import {
  appGuardedFileIo,
  quarantineBeforeWrite,
  readGuardedFile,
  type GuardedFileIo,
} from "../../platform/app/guarded-file";
import { isObject } from "../../platform/std/json";
import type { StudyPlace } from "./result-types";
import { entryId, splitRecords } from "./topic-searches";

export const TOPIC_LABELS_VERSION = 1;
const PREFIX = "topic-search-labels-";

export type TopicLabelKind = "yes" | "no" | "borderline" | "pinned";
/** Where the label came from: a seed confirmed while drafting, a confirmed study line, an answered question. */
export type TopicLabelSource = "seed" | "line" | "question";

export interface TopicLabel {
  // "tl-" + 8 hex.
  id: string;
  searchId: string;
  // The item's identity: "arxiv:<id>", or the event key of info/rank/link-identity.ts.
  item: string;
  // The program's, never the model's.
  title: string;
  label: TopicLabelKind;
  // The reader's words.
  reason: string;
  source: TopicLabelSource;
  // The anchor of the message the reader said it in.
  evidence: string;
  at: number;
  // Where the item stood in the brief when labelled; "absent" for one not in it
  // (a seed, an item named in conversation). Null when there was no brief yet.
  brief: { version: number; place: StudyPlace | "absent"; rank: number | null; score: number | null } | null;
  // The search's revision when labelled: what the criteria were.
  criteria: number;
}

export interface ParsedTopicLabels {
  searchId: string;
  labels: TopicLabel[];
  foreign: unknown[];
  repaired: boolean;
}

export type TopicLabelsIo = GuardedFileIo<ParsedTopicLabels>;

export const topicLabelsIo: TopicLabelsIo = appGuardedFileIo();

export function topicLabelsFileName(searchId: string): string {
  return `${PREFIX}${searchId}.json`;
}

const KINDS: readonly TopicLabelKind[] = ["yes", "no", "borderline", "pinned"];
const SOURCES: readonly TopicLabelSource[] = ["seed", "line", "question"];
const PLACES: readonly string[] = ["pinned", "main", "note", "absent"];

const numOrNull = (v: unknown) => v === null || typeof v === "number";

function validBrief(v: unknown): boolean {
  if (v === null) return true;
  if (!isObject(v)) return false;
  return typeof v.version === "number" && PLACES.includes(v.place as string) && numOrNull(v.rank) && numOrNull(v.score);
}

export function validateTopicLabel(entry: unknown): TopicLabel | null {
  if (!isObject(entry)) return null;
  for (const key of ["id", "searchId", "item", "title", "reason", "evidence"] as const) {
    if (typeof entry[key] !== "string") return null;
  }
  if (!KINDS.includes(entry.label as TopicLabelKind) || !SOURCES.includes(entry.source as TopicLabelSource)) return null;
  if (typeof entry.at !== "number" || typeof entry.criteria !== "number") return null;
  if (!validBrief(entry.brief)) return null;
  return entry as unknown as TopicLabel;
}

export function parseTopicLabelsFile(raw: unknown): ParsedTopicLabels | null {
  if (!isObject(raw) || typeof raw.searchId !== "string" || !Array.isArray(raw.labels)) return null;
  const { records, foreign, repaired } = splitRecords(raw.labels, validateTopicLabel);
  return { searchId: raw.searchId, labels: records, foreign, repaired };
}

export function topicLabelsFileBody(searchId: string, labels: readonly TopicLabel[], foreign: readonly unknown[] = []): string {
  return JSON.stringify({ version: TOPIC_LABELS_VERSION, searchId, labels: [...labels, ...foreign] }, null, 2);
}

const HEX = "0123456789abcdef";

/** A fresh "tl-" + 8 hex id. `random` is a parameter so a test can pin it. */
export function newTopicLabelId(random: () => number = Math.random): string {
  let out = "tl-";
  for (let i = 0; i < 8; i++) out += HEX[Math.floor(random() * 16) % 16];
  return out;
}

/** Each item's label in force: the latest by `at`, the later in the file on a tie. */
export function latestLabels(labels: readonly TopicLabel[]): Map<string, TopicLabel> {
  const out = new Map<string, TopicLabel>();
  for (const l of labels) {
    const had = out.get(l.item);
    if (!had || l.at >= had.at) out.set(l.item, l);
  }
  return out;
}

/** A search's labels, oldest first as written; none when there is no file yet. */
export async function loadTopicLabels(searchId: string, io: TopicLabelsIo = topicLabelsIo): Promise<TopicLabel[]> {
  return (await readGuardedFile(io, topicLabelsFileName(searchId), parseTopicLabelsFile))?.labels ?? [];
}

/**
 * Append labels to a search's file. A label whose id is already there is not
 * written again: labels are never edited, a new one outranks the old. Returns
 * what is on disk afterwards.
 */
export async function addTopicLabels(
  searchId: string,
  add: readonly TopicLabel[],
  io: TopicLabelsIo = topicLabelsIo,
): Promise<TopicLabel[]> {
  const file = topicLabelsFileName(searchId);
  const read = (await readGuardedFile(io, file, parseTopicLabelsFile)) ?? { searchId, labels: [], foreign: [], repaired: false };
  const taken = new Set([...read.labels.map((l) => l.id), ...read.foreign.map(entryId)]);
  const fresh: TopicLabel[] = [];
  for (const l of add) {
    if (taken.has(l.id)) continue;
    taken.add(l.id);
    fresh.push(l);
  }
  if (fresh.length === 0) return read.labels;
  if (read.repaired && !(await quarantineBeforeWrite(io, file))) return read.labels;
  const labels = [...read.labels, ...fresh];
  await io.write(file, topicLabelsFileBody(searchId, labels, read.foreign));
  return labels;
}
