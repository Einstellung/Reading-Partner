// What the drafting card's Apply writes, and what stopping undoes
// (docs/info/88 起草, 主题配置, 不关注了). The writes go through ports so the
// order and the failure cases are tested without a disk.
//
// Apply: the concern first, because the config names it; then the config; then
// the first run is handed off. No reading topic is made: a search's results are
// the nightly brief (info/issue), which sits on no reading shelf. A concern that could not be written leaves the
// config with no concern rather than no config: the search is what the reader
// asked for, and the concern can be pointed at later.

import type { CreateStatementInput, Statement } from "../../memory";
import type { TopicSearchProposalCardData } from "./cards";
import { newTopicSearchId, stopTopicSearch } from "./topic-searches";
import type { TopicSearch } from "./types";

export interface ConcernPorts {
  getStatement(id: string): Promise<Statement | null>;
  createStatement(input: CreateStatementInput): Promise<Statement>;
  supersede(oldId: string, input: CreateStatementInput): Promise<Statement | null>;
  addEvidence(id: string, evidence: readonly string[]): Promise<Statement | null>;
  setLapsed(id: string, lapsed: boolean): Promise<Statement | null>;
}

// A superseded concern points at what replaced it; follow that a few steps so
// a concern pointed at by an old id still lands on the live one.
async function liveConcern(id: string, ports: ConcernPorts): Promise<Statement | null> {
  let at = await ports.getStatement(id);
  for (let hops = 0; at?.supersededBy && hops < 8; hops++) at = await ports.getStatement(at.supersededBy);
  return at && at.kind === "concern" && !at.supersededBy ? at : null;
}

/**
 * The concern a search hangs on, by id. A concern the reader wrote is linked
 * as it is (followed again if it had lapsed, with this message added to its
 * evidence); one a dream wrote is superseded by the reader's own words; with
 * none, a new reader concern is written. Null when nothing could be written —
 * no evidence to date a new one by, or a store that threw.
 */
export async function linkConcern(
  concern: TopicSearchProposalCardData["concern"],
  ports: ConcernPorts,
): Promise<string | null> {
  const evidence = concern.evidence ? [concern.evidence] : [];
  const input: CreateStatementInput = { kind: "concern", text: concern.text, author: "reader", evidence };
  try {
    const existing = concern.existingId ? await liveConcern(concern.existingId, ports) : null;
    if (existing && existing.author === "reader") {
      if (evidence.length) await ports.addEvidence(existing.id, evidence);
      if (existing.lapsed) await ports.setLapsed(existing.id, false);
      return existing.id;
    }
    // A reader statement is dated by its evidence; without the message there is
    // nothing to write one with, and the dream's line is linked as it stands.
    if (!evidence.length) return existing ? existing.id : null;
    if (existing) return (await ports.supersede(existing.id, input))?.id ?? existing.id;
    return (await ports.createStatement(input)).id;
  } catch (e) {
    console.warn("the topic search's concern could not be written", e);
    return null;
  }
}

export interface ApplyPorts {
  concern: ConcernPorts;
  load(): Promise<TopicSearch[]>;
  put(search: TopicSearch): Promise<unknown>;
  dispatchFirstRun(search: TopicSearch): Promise<void>;
  now(): number;
  random?(): number;
}

export type ApplyResult = { ok: true; search: TopicSearch } | { ok: false };

export async function applyTopicSearchProposal(
  card: TopicSearchProposalCardData,
  ports: ApplyPorts,
): Promise<ApplyResult> {
  if (card.phase === "applied") return { ok: false };
  const all = await ports.load();
  const before = card.searchId ? (all.find((s) => s.id === card.searchId) ?? null) : null;
  // Re-following a stopped search hangs it back on its own concern unless the
  // draft pointed at another.
  const concernId = await linkConcern(
    { ...card.concern, existingId: card.concern.existingId ?? before?.concernId ?? null },
    ports.concern,
  );
  const now = ports.now();
  const search: TopicSearch = {
    id: before?.id ?? newTopicSearchId(ports.random),
    name: card.name,
    concernId,
    scope: card.scope,
    subtopics: card.subtopics,
    want: card.want,
    avoid: card.avoid,
    judgments: card.judgments,
    anchors: card.anchors,
    queries: card.queries,
    answers: [...(before?.answers ?? []), ...card.answers.map((a) => ({ ...a, at: now }))],
    status: "active",
    ...(card.once ? { once: true } : {}),
    revision: (before?.revision ?? 0) + 1,
    createdAt: before?.createdAt ?? now,
    lastRunAt: before?.lastRunAt ?? null,
  };
  try {
    await ports.put(search);
  } catch {
    return { ok: false };
  }
  try {
    await ports.dispatchFirstRun(search);
  } catch (e) {
    console.warn("the topic search's first run could not be dispatched", e);
  }
  return { ok: true, search };
}

export interface StopPorts {
  change(id: string, change: (s: TopicSearch) => TopicSearch): Promise<TopicSearch | null>;
  setLapsed(id: string, lapsed: boolean): Promise<Statement | null>;
}

/**
 * Stop following: the search is marked stopped and its concern lapsed. Null
 * when there is no such search. A concern that will not lapse leaves the
 * search stopped; the next drafting pass can still point at it.
 */
export async function stopFollowing(id: string, ports: StopPorts): Promise<TopicSearch | null> {
  const stopped = await ports.change(id, stopTopicSearch);
  if (!stopped) return null;
  if (stopped.concernId) {
    try {
      await ports.setLapsed(stopped.concernId, true);
    } catch (e) {
      console.warn("the topic search's concern could not be marked lapsed", e);
    }
  }
  return stopped;
}
