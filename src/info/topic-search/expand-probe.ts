// The offline hold-out experiment for a study's graph expansion (docs/info/92
// 怎么评): the yes/pinned labels split in two, each half in turn (with the
// seeds) used as the positives, and the expansion asked to find the other
// half, above all the papers the lexical reads missed. Also measured: how many
// of the expansion's own top 20 the reader said no to, the months the
// recommendations fall in, and the DOI-only papers left out. Pure: the
// expansion itself is a ProbeExpander (expand-probe-s2.ts, or graph-live.ts's
// once it lands), and scripts/topic-expand-probe.ts reads the files and prints.

import { weightedRrf } from "../rank/fusion";
import { arxivEventKey, currentEventKey } from "../rank/events";
import { paperDay } from "../sources/plugins/huggingface";
import type { GraphRead, GraphStreamKind, GraphWhy } from "./graph-read";
import { routeFinds, type RunReads } from "./label-replay";
import { latestLabels, type TopicLabel, type TopicLabelKind } from "./labels";
import type { TopicSeed } from "./types";

// docs/info/92's numbers, as the expansion uses them. graph-expand.ts will own
// them; until then they are kept here and the probe says what it assumed.
export const PROBE_LIMITS = {
  /** Positives and negatives given to a recommendation request. */
  recPositives: 20,
  recNegatives: 10,
  /** Positives whose citations and references are walked. */
  maxWalked: 6,
  /** A positive cited more than this is not walked forward ("hub"). */
  hubCitations: 300,
  /** Of each stream, what enters the pool (STREAM_TAKE). */
  take: { rec: 20, cites: 8, refs: 8 } as Record<GraphStreamKind, number>,
  weight: { rec: 0.8, cites: 0.6, refs: 0.5 } as Record<GraphStreamKind, number>,
  /** The expansion's own top, for the share of no labels in it. */
  top: 20,
} as const;

export interface ProbePositive {
  /** "arxiv:<id>" or "doi:<doi>". */
  key: string;
  title: string;
  why: GraphWhy;
}

/** One expansion asked: positives best first, negatives newest first (keys). */
export interface ExpandRequest {
  positives: ProbePositive[];
  negatives: string[];
}

/**
 * The graph expansion as the probe drives it: one request in, the streams it
 * read out. It must not drop the negatives from its streams (the probe counts
 * them); it should drop the positives.
 */
export type ProbeExpander = (request: ExpandRequest) => Promise<GraphRead>;

export interface ProbeFold {
  n: 1 | 2;
  request: ExpandRequest;
  /** The yes/pinned keys held out, to be found. */
  heldOut: string[];
  /** The no keys held out of the request's negatives. */
  heldOutNo: string[];
}

export interface Holdout {
  folds: [ProbeFold, ProbeFold];
  /** Positive labels on items the expansion cannot start from or find (posts, repos), by key. */
  skipped: string[];
}

const isPaperKey = (key: string) => key.startsWith("arxiv:") || key.startsWith("doi:");

/**
 * The two folds. Positives in the order the expansion takes them: seeds, then
 * pinned, then yes, newest label first. Seeds and DOI-keyed labels go into
 * both folds (a DOI-only paper cannot be found back: the pool takes arXiv
 * papers only); the arXiv-keyed yes/pinned alternate between the halves in
 * that order, and the no labels likewise, newest first.
 */
export function holdoutFolds(labels: readonly TopicLabel[], seeds: readonly TopicSeed[]): Holdout {
  const latest = [...latestLabels(labels).values()].map((l) => ({ ...l, item: currentEventKey(l.item) }));
  const byNewest = (kind: TopicLabelKind) => latest.filter((l) => l.label === kind).sort((a, b) => b.at - a.at);
  const fixed: ProbePositive[] = [];
  const seen = new Set<string>();
  for (const s of seeds) {
    const key = currentEventKey(s.key);
    if (seen.has(key) || !isPaperKey(key)) continue;
    seen.add(key);
    fixed.push({ key, title: s.title, why: "seed" });
  }
  const halves: [ProbePositive[], ProbePositive[]] = [[], []];
  const skipped: string[] = [];
  let i = 0;
  for (const l of [...byNewest("pinned"), ...byNewest("yes")]) {
    if (seen.has(l.item)) continue;
    seen.add(l.item);
    const p: ProbePositive = { key: l.item, title: l.title, why: l.label === "pinned" ? "pinned" : "yes" };
    if (l.item.startsWith("arxiv:")) halves[i++ % 2].push(p);
    else if (l.item.startsWith("doi:")) fixed.push(p);
    else skipped.push(l.item);
  }
  const noHalves: [string[], string[]] = [[], []];
  byNewest("no")
    .filter((l) => isPaperKey(l.item))
    .forEach((l, j) => noHalves[j % 2].push(l.item));
  const fold = (n: 1 | 2): ProbeFold => {
    const train = n - 1;
    const test = 1 - train;
    // Seeds first, then the fold's half and the DOI-keyed labels in label order.
    const positives = [...fixed.filter((p) => p.why === "seed"), ...halves[train], ...fixed.filter((p) => p.why !== "seed")];
    const order = (p: ProbePositive) => ["seed", "pinned", "yes"].indexOf(p.why);
    positives.sort((a, b) => order(a) - order(b));
    return {
      n,
      request: { positives, negatives: noHalves[train].slice(0, PROBE_LIMITS.recNegatives) },
      heldOut: halves[test].map((p) => p.key),
      heldOutNo: noHalves[test],
    };
  };
  return { folds: [fold(1), fold(2)], skipped };
}

// --- the request plan -----------------------------------------------------------

export interface PlannedRequest {
  fold: 1 | 2;
  what: "batch" | "rec" | "cites" | "refs";
  /** The positive a walk starts from. */
  from: string | null;
}

export interface RequestPlan {
  requests: PlannedRequest[];
  /** The most S2 requests the probe may send: each fold's batch, recommendation and walks, none shared. */
  cap: number;
}

/**
 * The S2 requests the folds would send if every positive resolved and none
 * were a hub, with a walk on a positive both folds share sent once: per fold,
 * one batch (only the keys not looked up before), one recommendation, and the
 * citations and references of its first MAX_WALKED positives. The cap is the
 * worst case, no walk shared between folds: per fold at most what one run's
 * first round sends (docs/info/92 预算).
 */
export function requestPlan(folds: readonly ProbeFold[]): RequestPlan {
  const requests: PlannedRequest[] = [];
  const looked = new Set<string>();
  const walked = new Set<string>();
  for (const fold of folds) {
    const keys = [...fold.request.positives.map((p) => p.key), ...fold.request.negatives];
    if (keys.some((k) => !looked.has(k))) requests.push({ fold: fold.n, what: "batch", from: null });
    for (const k of keys) looked.add(k);
    if (fold.request.positives.length) requests.push({ fold: fold.n, what: "rec", from: null });
    for (const p of fold.request.positives.slice(0, PROBE_LIMITS.maxWalked)) {
      if (walked.has(p.key)) continue;
      walked.add(p.key);
      requests.push({ fold: fold.n, what: "cites", from: p.key }, { fold: fold.n, what: "refs", from: p.key });
    }
  }
  const cap = folds.reduce((n, f) => n + 2 + 2 * Math.min(PROBE_LIMITS.maxWalked, f.request.positives.length), 0);
  return { requests, cap };
}

// --- evaluation -------------------------------------------------------------------

export interface HeldOutRow {
  key: string;
  title: string;
  /** In the run's paper window (by the id's month and day). */
  inWindow: boolean;
  /** A query read it (either round). */
  lexical: boolean;
  /** Each graph stream kind that read it, with its best place there. */
  found: Partial<Record<GraphStreamKind, number>>;
  /** Some stream had it within what enters the pool. */
  inTake: boolean;
}

export interface TopRow {
  key: string;
  title: string;
  label: TopicLabelKind | null;
  heldOut: boolean;
}

export interface FoldReport {
  n: 1 | 2;
  positives: { total: number; resolved: number; walked: string[] };
  negatives: number;
  streams: { id: string; outcome: string; library: string | null; total: number; papers: number }[];
  heldOut: {
    total: number;
    inWindow: number;
    lexical: number;
    graph: number;
    graphInTake: number;
    /** Found by the graph, not by any query: what the expansion adds. */
    graphNotLexical: number;
    graphNotLexicalInTake: number;
    rows: HeldOutRow[];
  };
  top: { n: number; no: number; heldOutNo: number; heldOutYes: number; labelled: number; rows: TopRow[] };
  /** Recommendation papers by the id's year and month. */
  recMonths: Record<string, number>;
  doiOnly: number;
}

export interface EvaluateContext {
  /** The run's reads, for what the queries found. */
  runs: readonly RunReads[];
  labels: readonly TopicLabel[];
  /** The window's first day, YYYY-MM-DD. */
  since: string;
  /** Titles by key, for rows the graph did not title. */
  titles?: ReadonlyMap<string, string>;
}

function lexicalKeys(runs: readonly RunReads[]): Set<string> {
  const out = new Set<string>();
  for (const [key, routes] of routeFinds(runs)) {
    if ([...routes.keys()].some((id) => id.startsWith("query-"))) out.add(key);
  }
  return out;
}

/** Each stream's papers by key with their 1-based places; the first place of a repeated key stands. */
function graphPlaces(read: GraphRead): Map<string, Partial<Record<GraphStreamKind, number>>> {
  const out = new Map<string, Partial<Record<GraphStreamKind, number>>>();
  for (const s of read.streams) {
    s.papers.forEach((p, i) => {
      const key = arxivEventKey(p.arxivId);
      if (!key) return;
      const got = out.get(key) ?? {};
      if (got[s.kind] === undefined || i + 1 < got[s.kind]!) got[s.kind] = i + 1;
      out.set(key, got);
    });
  }
  return out;
}

/** The graph streams fused alone, best first, each cut to what enters the pool. */
export function graphTop(read: GraphRead, n: number = PROBE_LIMITS.top): string[] {
  const streams = read.streams.map((s) => ({
    weight: PROBE_LIMITS.weight[s.kind],
    take: PROBE_LIMITS.take[s.kind],
    items: s.papers.flatMap((p) => {
      const key = arxivEventKey(p.arxivId);
      return key ? [{ key }] : [];
    }),
  }));
  return weightedRrf(streams, { maxPerAuthor: Infinity }).slice(0, n).map((f) => f.key);
}

const monthOf = (arxivId: string): string => {
  const m = /^(\d{2})(\d{2})\./.exec(arxivId);
  return m ? `20${m[1]}-${m[2]}` : "old-style id";
};

export function evaluateFold(fold: ProbeFold, read: GraphRead, ctx: EvaluateContext): FoldReport {
  const lexical = lexicalKeys(ctx.runs);
  const places = graphPlaces(read);
  const labels = new Map([...latestLabels(ctx.labels).values()].map((l) => [currentEventKey(l.item), l]));
  const titles = new Map(ctx.titles ?? []);
  for (const s of read.streams) for (const p of s.papers) {
    const key = arxivEventKey(p.arxivId);
    if (key && !titles.has(key)) titles.set(key, p.title);
  }

  const rows: HeldOutRow[] = fold.heldOut.map((key) => {
    const found = places.get(key) ?? {};
    const id = key.slice("arxiv:".length);
    const day = paperDay(id, "");
    return {
      key,
      title: labels.get(key)?.title || titles.get(key) || "",
      inWindow: day !== null && day >= ctx.since,
      lexical: lexical.has(key),
      found,
      inTake: (Object.entries(found) as [GraphStreamKind, number][]).some(([kind, place]) => place <= PROBE_LIMITS.take[kind]),
    };
  });
  const isFound = (r: HeldOutRow) => Object.keys(r.found).length > 0;

  const heldOutYes = new Set(fold.heldOut);
  const heldOutNo = new Set(fold.heldOutNo);
  const topKeys = graphTop(read);
  const topRows: TopRow[] = topKeys.map((key) => ({
    key,
    title: titles.get(key) ?? "",
    label: labels.get(key)?.label ?? null,
    heldOut: heldOutYes.has(key) || heldOutNo.has(key),
  }));

  const recMonths: Record<string, number> = {};
  for (const s of read.streams.filter((x) => x.kind === "rec")) {
    for (const p of s.papers) recMonths[monthOf(p.arxivId)] = (recMonths[monthOf(p.arxivId)] ?? 0) + 1;
  }

  return {
    n: fold.n,
    positives: {
      total: fold.request.positives.length,
      resolved: read.positives.filter((p) => p.s2 || p.openAlex).length,
      walked: read.positives.filter((p) => p.walked).map((p) => p.key),
    },
    negatives: fold.request.negatives.length,
    streams: read.streams.map((s) => ({ id: s.id, outcome: s.outcome, library: s.library, total: s.total, papers: s.papers.length })),
    heldOut: {
      total: rows.length,
      inWindow: rows.filter((r) => r.inWindow).length,
      lexical: rows.filter((r) => r.lexical).length,
      graph: rows.filter(isFound).length,
      graphInTake: rows.filter((r) => r.inTake).length,
      graphNotLexical: rows.filter((r) => isFound(r) && !r.lexical).length,
      graphNotLexicalInTake: rows.filter((r) => r.inTake && !r.lexical).length,
      rows,
    },
    top: {
      n: topRows.length,
      no: topRows.filter((r) => r.label === "no").length,
      heldOutNo: topRows.filter((r) => r.label === "no" && heldOutNo.has(r.key)).length,
      heldOutYes: topRows.filter((r) => heldOutYes.has(r.key)).length,
      labelled: topRows.filter((r) => r.label !== null).length,
      rows: topRows,
    },
    recMonths,
    doiOnly: read.doiOnly.count,
  };
}

// --- printing ----------------------------------------------------------------------

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "-");

export function formatPlan(holdout: Holdout, plan: RequestPlan): string {
  const lines: string[] = [];
  for (const f of holdout.folds) {
    lines.push(`fold ${f.n}: ${f.request.positives.length} positives, ${f.request.negatives.length} negatives; holds out ${f.heldOut.length} yes/pinned and ${f.heldOutNo.length} no`);
    f.request.positives.forEach((p, i) =>
      lines.push(`  ${i < PROBE_LIMITS.maxWalked ? "walk" : i < PROBE_LIMITS.recPositives ? "rec " : "-   "} ${p.why.padEnd(7)} ${p.key}  ${p.title}`),
    );
  }
  if (holdout.skipped.length) lines.push(`not papers, left out: ${holdout.skipped.join(", ")}`);
  lines.push("", `S2 requests planned: ${plan.requests.length} (cap ${plan.cap}; a hub or an unresolved positive sends fewer, a retry counts)`);
  for (const r of plan.requests) lines.push(`  fold ${r.fold}  ${r.what.padEnd(5)} ${r.from ?? ""}`.trimEnd());
  return lines.join("\n");
}

export function formatFold(r: FoldReport): string {
  const h = r.heldOut;
  const lines = [
    `fold ${r.n}: ${r.positives.resolved}/${r.positives.total} positives resolved, ${r.positives.walked.length} walked, ${r.negatives} negatives`,
    `  streams: ${r.streams.map((s) => `${s.id} ${s.outcome}${s.library ? ` (${s.library})` : ""} ${s.papers}/${s.total}`).join("; ") || "none"}`,
    `  held out: ${h.total} yes/pinned, ${h.inWindow} in the window; the queries read ${h.lexical}`,
    `  graph found ${h.graph} (${h.graphInTake} within the pool's take); of them the queries missed ${h.graphNotLexical} (${h.graphNotLexicalInTake} within the take)`,
    `  graph top ${r.top.n}: ${r.top.no} labelled no (${pct(r.top.no, r.top.n)}; ${r.top.heldOutNo} of them held out), ${r.top.heldOutYes} held-out yes, ${r.top.n - r.top.labelled} unlabelled`,
    `  recommendations by month: ${Object.entries(r.recMonths).sort(([a], [b]) => b.localeCompare(a)).map(([m, n]) => `${m} ${n}`).join(", ") || "none"}`,
    `  DOI-only papers left out: ${r.doiOnly}`,
  ];
  for (const row of h.rows) {
    const kinds = (Object.entries(row.found) as [string, number][]).map(([k, n]) => `${k}#${n}`).join(" ");
    lines.push(`    ${row.lexical ? "query" : "-    "} ${kinds.padEnd(22)} ${row.inWindow ? "  " : "o "}${row.key}  ${row.title}`);
  }
  return lines.join("\n");
}

/** The two folds' main numbers summed. */
export function formatTotals(reports: readonly FoldReport[]): string {
  const sum = (f: (r: FoldReport) => number) => reports.reduce((s, r) => s + f(r), 0);
  return [
    `both folds: held out ${sum((r) => r.heldOut.total)}; the graph found ${sum((r) => r.heldOut.graph)}, ${sum((r) => r.heldOut.graphNotLexical)} of them missed by the queries (${sum((r) => r.heldOut.graphNotLexicalInTake)} within the take)`,
    `both folds: graph top ${PROBE_LIMITS.top} held ${sum((r) => r.top.no)} labelled no of ${sum((r) => r.top.n)} papers (${pct(sum((r) => r.top.no), sum((r) => r.top.n))})`,
    `in the held-out rows: "query" = a query read it, kind#n = the graph stream and place, "o" = outside the window`,
  ].join("\n");
}
