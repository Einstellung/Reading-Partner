// The arXiv half of a run's reading (docs/info/88 「两种 run」「取材 / arXiv」):
// each query's ladder (arxiv-ladder.ts), one query after another, beside the X
// read in the run's `read` phase. arXiv is plain HTTP and touches neither the
// screen nor the X session, so it does not wait for X.
//
// What it found is kept in the run directory (`arxiv-read.json`), written after
// every query, so a run that resumes after a kill searches only the queries
// not yet on file and the build reads the file instead of searching (run-state.ts
// saveArxivRead). A query
// whose ladder failed or was rate limited is on file with that outcome and is
// not searched again in the same run; a retry run reads it again (retry.ts).

import { throwIfAborted } from "../../platform/app/abort";
import { runArxivLadder, type ArxivSearch } from "./arxiv-ladder";
import type { ArxivFound } from "./rank-pool";
import type { TopicSearch } from "./types";
import { arxivWindow } from "./windows";

// A type, not an interface: it goes to disk as JSON.
export type ArxivRead = {
  version: 1;
  /** The submittedDate window every query's ladder starts from, local days. */
  window: { since: string; until: string };
  /** The query ids the run searches, in order. */
  planned: string[];
  /** Each query's ladder, in the order they ended. */
  found: ArxivFound[];
  /** Every planned query has been searched. */
  done: boolean;
};

export interface ArxivReadPlan {
  kind: "first" | "daily";
  /** Start of the run's window, epoch ms. */
  since: number;
  /** Local date the run's arXiv window ends on, YYYY-MM-DD. */
  today: string;
  /** A retry's: only these query ids. Null on the other runs. */
  only: readonly string[] | null;
}

export interface ArxivReadDeps {
  search: ArxivSearch;
  load(): Promise<ArxivRead | null>;
  save(read: ArxivRead): Promise<void>;
  /** Called after each write, for the run's progress line. */
  onChange?(read: ArxivRead): void;
}

/** The queries a run searches on arXiv: every query with arXiv words; a retry's, only those it reads again. */
export function arxivQueries(topic: TopicSearch, only: readonly string[] | null): string[] {
  return topic.queries.filter((q) => q.arxiv && (!only || only.includes(q.id))).map((q) => q.id);
}

export function planArxivRead(topic: TopicSearch, plan: ArxivReadPlan): ArxivRead {
  const planned = arxivQueries(topic, plan.only);
  return { version: 1, window: arxivWindow(plan.kind, plan.since, plan.today), planned, found: [], done: planned.length === 0 };
}

/**
 * Search what is left of the run's arXiv queries and return everything on
 * file. An abort is thrown (the query in flight is not written, so a resume
 * searches it again); a failed or rate-limited ladder is an outcome, not a throw.
 */
export async function readArxiv(topic: TopicSearch, plan: ArxivReadPlan, deps: ArxivReadDeps, signal: AbortSignal): Promise<ArxivRead> {
  let read = await deps.load();
  if (read?.done) return read;
  if (!read) {
    read = planArxivRead(topic, plan);
    await deps.save(read);
    deps.onChange?.(read);
    if (read.done) return read;
  }
  for (const id of read.planned) {
    if (read.found.some((f) => f.query === id)) continue;
    const query = topic.queries.find((q) => q.id === id)?.arxiv;
    // A query taken out of the search (or its arXiv words) since the run planned it.
    if (!query) continue;
    throwIfAborted(signal);
    const { items, error, outcome, steps } = await runArxivLadder(query, read.window, plan.kind, deps.search, signal);
    read = { ...read, found: [...read.found, { query: id, items, error, ladder: { outcome, steps } }] };
    await deps.save(read);
    deps.onChange?.(read);
  }
  read = { ...read, done: true };
  await deps.save(read);
  deps.onChange?.(read);
  return read;
}

/** One line on how far the arXiv half has got: counts and outcomes only. */
export function arxivProgressLine(read: ArxivRead | null): string {
  if (!read) return "arXiv: not started";
  if (read.planned.length === 0) return "arXiv: no query to search";
  const papers = read.found.reduce((n, f) => n + f.items.length, 0);
  const outcomes = new Map<string, number>();
  for (const f of read.found) {
    const o = f.ladder?.outcome ?? (f.error ? "failed" : "searched");
    outcomes.set(o, (outcomes.get(o) ?? 0) + 1);
  }
  const how = outcomes.size ? ` (${[...outcomes].map(([o, n]) => `${n} ${o.replace("_", " ")}`).join(", ")})` : "";
  const count = `${papers} paper${papers === 1 ? "" : "s"}`;
  const of = read.planned.length;
  return read.done
    ? `arXiv done: ${of} quer${of === 1 ? "y" : "ies"} searched${how}, ${count}`
    : `arXiv: ${read.found.length} of ${of} queries searched${how}, ${count}`;
}
