// Recall that reaches past one topic.
//
// The store is per topic on purpose and stays that way. What was per topic by
// accident is the *read*: live.ts mints one adapter per topic and
// buildObservationTools binds to exactly one of them, so the search the model
// was handed could not see outside the topic it was mounted on. The reader
// keeps one book as a standing frame while reading another, and the two topics
// held contradictory records of him — one saying he has a reinforcement-learning
// background, another that he has no reinforcement-learning vocabulary — with
// neither able to see the other. This module is the widened read; nothing here
// writes, moves or renames anything on disk.
//
// Measured on the owner's store, 2026-08-31: 3 topics, 143 observations,
// 166 KB of entry files, 127k characters of summary + body. One observation_search
// over the 106-observation topic he reads in costs 5.71 ms; the same search with
// his other two topics (21 and 16) mounted costs 6.89 ms, plus about 0.4 ms to
// read those 37 files off disk (the 106-file topic measures 1.01 ms). Under two
// milliseconds, in front of a model call.

import { bm25Search } from "../../fulltext/bm25";
import { FULLTEXT_VERSION, type SearchDoc } from "../../fulltext/types";
import type { Observation, ObservationHit } from "./types";

// One topic's observations, named. The name is not decoration: an unqualified
// summary from another book's topic is worse than no hit at all, because the
// model cannot tell it is not about the book in hand and will answer as if it
// were.
export interface TopicObservations {
  topicId: string;
  topicName: string;
  entries: readonly Observation[];
}

export interface ScopedHit extends ObservationHit {
  topicId: string;
  topicName: string;
}

// How many hits the reader's other topics may add to one search. Half the
// same-topic limit (RECALL_LIMIT = 6, adapter.ts), and *added* to it rather
// than carved out of it — see searchOtherTopics for why the two are ranked
// apart.
export const CROSS_RECALL_LIMIT = 3;

// bm25 over observations, each entry one one-page document (the M6 search
// implementation, as adapter.ts has always used it).
//
// Labels are positions in the given list, never observation ids. An id is eight
// hex characters taken off a fresh UUID with no uniqueness check (store.ts
// newId), so two entries in one list can carry the same one — vanishingly
// unlikely at today's 143 (about one chance in 400,000) and zero times so far,
// but a map keyed by id would answer that case by dropping a hit, and a list
// spanning topics is the first list wide enough for it to matter.
function rank(
  entries: readonly Observation[],
  query: string,
  limit: number,
): { entry: Observation; index: number; score: number; snippet: string }[] {
  const docs: SearchDoc[] = entries.map((e, i) => ({
    label: String(i),
    fulltext: {
      version: FULLTEXT_VERSION,
      status: "ok",
      pages: [`${e.summary}\n${e.body}`],
      outline: [],
    },
  }));
  return bm25Search(query, docs, limit).flatMap((h) => {
    const index = Number(h.label);
    const entry = entries[index];
    return entry ? [{ entry, index, score: h.score, snippet: h.snippet }] : [];
  });
}

export function rankObservations(
  entries: readonly Observation[],
  query: string,
  limit: number,
): ObservationHit[] {
  return rank(entries, query, limit).map(({ entry, score, snippet }) => ({ entry, score, snippet }));
}

// The other topics' hits, ranked among themselves and returned separately from
// the topic in hand's.
//
// Separate rather than one merged ranking, for two reasons that both come down
// to the same-topic search being the one that already works. A merged corpus
// changes idf, so folding 106 observations of a survey into a 16-observation
// topic would silently re-rank that topic's own results; and a merged top-6
// lets another book take slots from the book being read. Ranked apart, the
// topic in hand keeps exactly the six hits and exactly the order it had before
// this module existed, and the widening can only add. Scores from the two
// passes are therefore never comparable and are never compared.
export function searchOtherTopics(
  topics: readonly TopicObservations[],
  query: string,
  limit: number = CROSS_RECALL_LIMIT,
): ScopedHit[] {
  const flat: Observation[] = [];
  const owner: TopicObservations[] = [];
  for (const topic of topics) {
    for (const entry of topic.entries) {
      flat.push(entry);
      owner.push(topic);
    }
  }
  return rank(flat, query, limit).map(({ entry, index, score, snippet }) => ({
    entry,
    score,
    snippet,
    topicId: owner[index].topicId,
    topicName: owner[index].topicName,
  }));
}

// Every observation the mount can reach, by id, the topic in hand first.
// First-wins, so a colliding id resolves to the local entry: the reader is in
// this topic, every other line on the page is about it, and a reference that
// could mean either has to mean the one at hand.
export function unionById(
  home: readonly Observation[],
  others: readonly TopicObservations[],
): Map<string, Observation> {
  const map = new Map<string, Observation>();
  for (const e of home) if (!map.has(e.id)) map.set(e.id, e);
  for (const t of others) for (const e of t.entries) if (!map.has(e.id)) map.set(e.id, e);
  return map;
}

// Which topic an id lives in, for ids that are not this topic's. Local ids are
// deliberately absent: a renderer built on this labels a foreign entry with its
// topic and leaves a local one plain, which is the distinction the model needs
// and the only one it needs.
export function otherTopicNames(
  home: readonly Observation[],
  others: readonly TopicObservations[],
): Map<string, string> {
  const local = new Set(home.map((e) => e.id));
  const map = new Map<string, string>();
  for (const t of others) {
    for (const e of t.entries) {
      if (local.has(e.id) || map.has(e.id)) continue;
      map.set(e.id, t.topicName);
    }
  }
  return map;
}

// Every entry the mount can reach, the topic in hand first, for the link index
// (links.ts). Order matters there: buildAnchorIndex never sorts, so a bucket
// built from this reads local-first.
export function allEntries(
  home: readonly Observation[],
  others: readonly TopicObservations[],
): Observation[] {
  return [...home, ...others.flatMap((t) => [...t.entries])];
}
