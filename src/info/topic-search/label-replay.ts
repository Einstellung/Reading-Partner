// The offline replay of a topic's labels against a result (docs/info/91 标签):
// how the items the reader said were on the mark fared in one result file, with
// recall and placement measured apart (research doc 开源主题情报与研究代理项目调研,
// finding 4). Pure; scripts/topic-labels-replay.ts reads the files and prints.
//
// An item is matched by its event key (info/rank/events.ts), the key the
// pipeline itself merges candidates on: a label's `item` against an item's
// `key` and `keys`, both as currentEventKey spells them today. A result's rank
// is the item's place by final score among the items listed, best first.

import { normalizeArxivId } from "../sources/plugins/arxiv-client";
import { arxivEventKey, currentEventKey, eventKeyOfUrl, xEventKey } from "../rank/events";
import { arxivIdOfDoi, normalizeDoi } from "../rank/link-identity";
import { postLinksOut } from "../x/text-links";
import type { GraphRead, GraphStreamKind } from "./graph-read";
import { gatherCandidates, type ArxivFound } from "./rank-pool";
import type { StudyPlace, TopicSearchResult, TopicSearchResultItem } from "./result-types";
import { versionPart } from "./result-types";
import { latestLabels, newTopicLabelId, type TopicLabel, type TopicLabelKind } from "./labels";
import type { TopicSearch } from "./types";
import type { XReadResult } from "./x-reader";

/** The ranks a label's item counts as near the top at. */
export const TOP_RANKS = [10, 20] as const;

export interface RankedItem {
  /** "E7". */
  id: string;
  key: string;
  /** The item's key and keys, as currentEventKey spells them. */
  keys: string[];
  title: string;
  score: number;
  /** 1-based, by final score, file order on a tie. */
  rank: number;
  /** A study version's place; null for any other result. */
  place: StudyPlace | null;
}

/**
 * The items a result lists, ranked by final score. A study's file is read as
 * one of its versions (`version`, else the latest); any other file as a whole.
 */
export function rankedItems(result: TopicSearchResult, version?: number): { items: RankedItem[]; version: number | null } {
  const versions = result.study?.versions ?? [];
  const n = version ?? (versions.length ? Math.max(...versions.map((v) => v.n)) : null);
  const view = n === null ? result : versionPart(result, n);
  if (!view) throw new Error(`the result has no study version ${n}`);
  const places = new Map((view.studyVersion?.entries ?? []).map((e) => [e.item, e.place]));
  const sorted = view.items.map((item, order) => ({ item, order })).sort((a, b) => b.item.score - a.item.score || a.order - b.order);
  return {
    items: sorted.map(({ item }, i) => ({
      id: item.id,
      key: currentEventKey(item.key),
      keys: itemKeys(item),
      title: item.title,
      score: item.score,
      rank: i + 1,
      place: places.get(item.id) ?? null,
    })),
    version: n,
  };
}

function itemKeys(item: TopicSearchResultItem): string[] {
  return [...new Set([item.key, ...(item.keys ?? [])].map(currentEventKey))];
}

/** Where a candidate pool had an item: read at all, and past the relevance floor (null when the topic was not at hand to measure it). */
export interface PoolEntry {
  title: string | null;
  passedFloor: boolean | null;
}

/** What one run read, as its run directory keeps it. */
export interface RunReads {
  x: XReadResult | null;
  arxiv: readonly ArxivFound[];
  huggingface: readonly ArxivFound[];
  /** A study's graph expansion, first round (graph-read.json). */
  graph?: GraphRead | null;
  /** A study's second round: its queries' reads and its graph expansion (the `-2` files). */
  round2?: { arxiv: readonly ArxivFound[]; huggingface: readonly ArxivFound[]; graph: GraphRead | null } | null;
}

function addPool(pool: Map<string, PoolEntry>, key: string | null, title: string | null, passed: boolean | null): void {
  if (!key) return;
  const had = pool.get(key);
  if (!had) pool.set(key, { title, passedFloor: passed });
  else {
    if (!had.title && title) had.title = title;
    if (passed !== null) had.passedFloor = (had.passedFloor ?? false) || passed;
  }
}

/**
 * Every item the runs read, keyed: a post by its own key and by its links'
 * keys (a post is how a linked paper or repo reaches the pool), a paper by its
 * arXiv key. With the topic at hand, candidates are gathered the way the
 * build gathers them (rank-pool.ts gatherCandidates), so each also says
 * whether it passed the local relevance floor.
 */
export function candidatePool(runs: readonly RunReads[], topic: TopicSearch | null): Map<string, PoolEntry> {
  const pool = new Map<string, PoolEntry>();
  for (const run of runs) {
    if (topic) {
      const x = run.x ?? ({ posts: [] } as unknown as XReadResult);
      const gathered = gatherCandidates(topic, x, run.arxiv, 0, run.huggingface);
      const kept = new Set(gathered.kept.map((c) => c.key));
      for (const c of gathered.all) {
        const passed = kept.has(c.key);
        addPool(pool, c.key, c.paper ? c.paper.title : null, passed);
        for (const link of c.links) addPool(pool, eventKeyOfUrl(link.url), null, passed);
      }
      continue;
    }
    for (const { post } of run.x?.posts ?? []) {
      addPool(pool, xEventKey(post.id), null, null);
      for (const link of postLinksOut(post)) addPool(pool, eventKeyOfUrl(link.url), null, null);
    }
    for (const found of [...run.arxiv, ...run.huggingface]) {
      for (const item of found.items) {
        const id = normalizeArxivId(item.sourceKey ?? item.url);
        addPool(pool, id ? arxivEventKey(id) : null, item.title, null);
      }
    }
  }
  // The second round's queries are not the topic's, so gatherCandidates drops
  // them: they are counted as read, the floor unmeasured. Graph candidates skip
  // the floor (docs/info/92 进候选池), so with the topic at hand they pass it.
  for (const run of runs) {
    for (const found of [...(run.round2?.arxiv ?? []), ...(run.round2?.huggingface ?? [])]) {
      for (const item of found.items) {
        const id = normalizeArxivId(item.sourceKey ?? item.url);
        addPool(pool, id ? arxivEventKey(id) : null, item.title, null);
      }
    }
    for (const graph of [run.graph, run.round2?.graph]) {
      for (const stream of graph?.streams ?? []) {
        for (const p of stream.papers) addPool(pool, arxivEventKey(p.arxivId), p.title, topic ? true : null);
      }
    }
  }
  return pool;
}

// --- route attribution (docs/info/92 怎么评) -----------------------------------

/** The four ways into the pool, earliest first. */
export const ROUTES = ["query-1", "graph-1", "query-2", "graph-2"] as const;
export type Route = (typeof ROUTES)[number];
export type RouteStream = "x" | "arxiv" | "huggingface" | GraphStreamKind;
/** A route and the stream within it: "query-1:arxiv", "graph-1:rec", "graph-2:cites". */
export type RouteId = `${Route}:${RouteStream}`;

const routeOf = (id: string): Route => id.slice(0, id.indexOf(":")) as Route;

/**
 * Every item each route and stream read, by key, with the item's best 1-based
 * place in any of that stream's lists (an X post's links take the post's place).
 */
export function routeFinds(runs: readonly RunReads[]): Map<string, Map<RouteId, number>> {
  const finds = new Map<string, Map<RouteId, number>>();
  const add = (key: string | null, id: RouteId, place: number) => {
    if (!key) return;
    const routes = finds.get(key) ?? new Map<RouteId, number>();
    const had = routes.get(id);
    if (had === undefined || place < had) routes.set(id, place);
    finds.set(key, routes);
  };
  const papers = (found: readonly ArxivFound[], id: RouteId) => {
    for (const f of found) {
      f.items.forEach((item, i) => {
        const arxivId = normalizeArxivId(item.sourceKey ?? item.url);
        add(arxivId ? arxivEventKey(arxivId) : null, id, i + 1);
      });
    }
  };
  const graph = (read: GraphRead | null | undefined, route: Route) => {
    for (const stream of read?.streams ?? []) {
      stream.papers.forEach((p, i) => add(arxivEventKey(p.arxivId), `${route}:${stream.kind}`, i + 1));
    }
  };
  for (const run of runs) {
    (run.x?.posts ?? []).forEach(({ post }, i) => {
      add(xEventKey(post.id), "query-1:x", i + 1);
      for (const link of postLinksOut(post)) add(eventKeyOfUrl(link.url), "query-1:x", i + 1);
    });
    papers(run.arxiv, "query-1:arxiv");
    papers(run.huggingface, "query-1:huggingface");
    graph(run.graph, "graph-1");
    papers(run.round2?.arxiv ?? [], "query-2:arxiv");
    papers(run.round2?.huggingface ?? [], "query-2:huggingface");
    graph(run.round2?.graph, "graph-2");
  }
  return finds;
}

export interface RouteRow {
  item: string;
  label: TopicLabelKind;
  /** The earliest route that read it; null when none did. */
  first: Route | null;
  /** Each route and stream that read it, with its best place there. */
  found: Partial<Record<RouteId, number>>;
}

export interface RouteCounts {
  yes: number;
  no: number;
  borderline: number;
}

export interface RouteReport {
  rows: RouteRow[];
  /** Labelled items by the earliest route that read them; "none" for those no route read. */
  first: Record<Route | "none", RouteCounts>;
  /** Labelled items each route and stream read at all (an item read by several counts under each). */
  streams: Partial<Record<RouteId, RouteCounts>>;
  /** Yes/pinned items read by this route and by no other route. */
  aloneByRoute: Record<Route, number>;
  /** Yes/pinned items read by this stream and by no other stream. */
  aloneByStream: Partial<Record<RouteId, number>>;
}

const countsOf = (): RouteCounts => ({ yes: 0, no: 0, borderline: 0 });
const bucketOf = (label: TopicLabelKind): keyof RouteCounts => (label === "pinned" ? "yes" : label);

/**
 * Which route brought each labelled item into the pool (docs/info/92 怎么评):
 * the first round's queries, its graph expansion, the second round's queries,
 * its graph expansion, or none. Yes and pinned count together as yes.
 */
export function routeAttribution(labels: readonly TopicLabel[], runs: readonly RunReads[]): RouteReport {
  const finds = routeFinds(runs);
  const first = Object.fromEntries([...ROUTES, "none"].map((r) => [r, countsOf()])) as Record<Route | "none", RouteCounts>;
  const streams: Partial<Record<RouteId, RouteCounts>> = {};
  const aloneByRoute = Object.fromEntries(ROUTES.map((r) => [r, 0])) as Record<Route, number>;
  const aloneByStream: Partial<Record<RouteId, number>> = {};
  const rows: RouteRow[] = [];
  for (const label of latestLabels(labels).values()) {
    const key = currentEventKey(label.item);
    const found = finds.get(key) ?? new Map<RouteId, number>();
    const routes = new Set([...found.keys()].map(routeOf));
    const earliest = ROUTES.find((r) => routes.has(r)) ?? null;
    const bucket = bucketOf(label.label);
    rows.push({ item: key, label: label.label, first: earliest, found: Object.fromEntries(found) });
    first[earliest ?? "none"][bucket]++;
    for (const id of found.keys()) (streams[id] ??= countsOf())[bucket]++;
    if (bucket !== "yes") continue;
    if (routes.size === 1) aloneByRoute[earliest!]++;
    if (found.size === 1) {
      const [only] = found.keys();
      aloneByStream[only] = (aloneByStream[only] ?? 0) + 1;
    }
  }
  return { rows, first, streams, aloneByRoute, aloneByStream };
}

/** The attribution as the script prints it. */
export function routeLines(r: RouteReport): string[] {
  const c = (n: RouteCounts) => `yes ${n.yes}, no ${n.no}${n.borderline ? `, borderline ${n.borderline}` : ""}`;
  const lines = ["first route into the pool (yes/pinned, no):"];
  for (const route of [...ROUTES, "none"] as const) {
    const n = r.first[route];
    if (route !== "none" && !n.yes && !n.no && !n.borderline && !r.aloneByRoute[route]) continue;
    lines.push(`  ${route.padEnd(8)} ${c(n)}${route === "none" ? "" : `; yes found by this route alone: ${r.aloneByRoute[route]}`}`);
  }
  const ids = (Object.keys(r.streams) as RouteId[]).sort((a, b) => ROUTES.indexOf(routeOf(a)) - ROUTES.indexOf(routeOf(b)) || a.localeCompare(b));
  if (ids.length) {
    lines.push("by stream (an item read by several counts under each):");
    for (const id of ids) lines.push(`  ${id.padEnd(20)} ${c(r.streams[id]!)}; yes by this stream alone: ${r.aloneByStream[id] ?? 0}`);
  }
  return lines;
}

/** Why a labelled item is not in the result. */
export type MissingWhy = "not-retrieved" | "under-floor" | "not-selected" | "retrieved-not-selected" | "unknown";

export interface LabelRow {
  item: string;
  title: string;
  label: TopicLabelKind;
  /** Null when the item is not in the result. */
  rank: number | null;
  score: number | null;
  id: string | null;
  place: StudyPlace | null;
  /** Only for an item not in the result. */
  missing: MissingWhy | null;
}

export interface ReplayReport {
  items: number;
  version: number | null;
  /** Whether run reads were at hand, and whether the floor could be measured. */
  pool: "none" | "reads" | "floor";
  rows: LabelRow[];
  positives: { total: number; found: number; recall: number | null; mrr: number | null; top: Record<string, number> };
  negatives: { total: number; found: number; ranks: number[] };
  borderline: { total: number; found: number };
  missing: Record<MissingWhy, number>;
  /** Which route read each labelled item, when the runs' reads were at hand. */
  routes?: RouteReport;
}

const POSITIVE: ReadonlySet<TopicLabelKind> = new Set(["yes", "pinned"]);

function missingWhy(key: string, pool: Map<string, PoolEntry> | null): MissingWhy {
  if (!pool) return "unknown";
  const entry = pool.get(key);
  if (!entry) return "not-retrieved";
  if (entry.passedFloor === null) return "retrieved-not-selected";
  return entry.passedFloor ? "not-selected" : "under-floor";
}

/**
 * The labels in force (latest per item) against a ranked result and, when the
 * runs' reads are at hand, their candidate pool. Yes and pinned count as on
 * the mark; borderline is listed and counted nowhere.
 */
export function replayLabels(
  labels: readonly TopicLabel[],
  ranked: { items: readonly RankedItem[]; version: number | null },
  pool: Map<string, PoolEntry> | null,
  poolFloor = false,
): ReplayReport {
  const byKey = new Map<string, RankedItem>();
  for (const item of ranked.items) for (const k of item.keys) if (!byKey.has(k)) byKey.set(k, item);
  const rows: LabelRow[] = [];
  for (const label of latestLabels(labels).values()) {
    const key = currentEventKey(label.item);
    const hit = byKey.get(key) ?? null;
    rows.push({
      item: key,
      title: label.title || hit?.title || pool?.get(key)?.title || "",
      label: label.label,
      rank: hit?.rank ?? null,
      score: hit?.score ?? null,
      id: hit?.id ?? null,
      place: hit?.place ?? null,
      missing: hit ? null : missingWhy(key, pool),
    });
  }
  const order: TopicLabelKind[] = ["pinned", "yes", "borderline", "no"];
  rows.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label) || (a.rank ?? Infinity) - (b.rank ?? Infinity));

  const positives = rows.filter((r) => POSITIVE.has(r.label));
  const found = positives.filter((r) => r.rank !== null);
  const top: Record<string, number> = {};
  for (const n of TOP_RANKS) top[n] = found.filter((r) => r.rank! <= n).length;
  const negatives = rows.filter((r) => r.label === "no");
  const borderline = rows.filter((r) => r.label === "borderline");
  const missing: Record<MissingWhy, number> = { "not-retrieved": 0, "under-floor": 0, "not-selected": 0, "retrieved-not-selected": 0, unknown: 0 };
  for (const r of positives) if (r.missing) missing[r.missing]++;
  return {
    items: ranked.items.length,
    version: ranked.version,
    pool: pool ? (poolFloor ? "floor" : "reads") : "none",
    rows,
    positives: {
      total: positives.length,
      found: found.length,
      recall: positives.length ? found.length / positives.length : null,
      mrr: positives.length ? found.reduce((s, r) => s + 1 / r.rank!, 0) / positives.length : null,
      top,
    },
    negatives: { total: negatives.length, found: negatives.filter((r) => r.rank !== null).length, ranks: negatives.flatMap((r) => (r.rank ? [r.rank] : [])) },
    borderline: { total: borderline.length, found: borderline.filter((r) => r.rank !== null).length },
    missing,
  };
}

// --- printing ----------------------------------------------------------------

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "-");
const cutTitle = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function pad(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  ").trimEnd());
}

const MISSING_WORDS: Record<MissingWhy, string> = {
  "not-retrieved": "not retrieved",
  "under-floor": "retrieved, under the relevance floor",
  "not-selected": "retrieved, past the floor, not selected",
  "retrieved-not-selected": "retrieved but not selected",
  unknown: "not in the result",
};

/** One line per metric, as the script prints them. */
export function summaryLines(r: ReplayReport): string[] {
  const p = r.positives;
  const lines = [
    `recall: ${p.found}/${p.total} yes/pinned labels are in the result (${pct(p.found, p.total)})`,
    `placement: MRR ${p.mrr === null ? "-" : p.mrr.toFixed(3)}; ${TOP_RANKS.map((n) => `top ${n}: ${p.top[n]}/${p.total}`).join("; ")}`,
    `no: ${r.negatives.found}/${r.negatives.total} no-labelled items are in the result${r.negatives.ranks.length ? `, at rank ${r.negatives.ranks.join(", ")}` : ""}`,
    `borderline: ${r.borderline.found}/${r.borderline.total} in the result (listed, not counted)`,
  ];
  const missing = p.total - p.found;
  if (r.pool === "none") {
    lines.push(`missing: ${missing}; no run reads at hand, so not retrieved and not selected cannot be told apart`);
  } else {
    const parts = (Object.keys(MISSING_WORDS) as MissingWhy[]).filter((k) => r.missing[k]).map((k) => `${MISSING_WORDS[k]} ${r.missing[k]}`);
    lines.push(`missing: ${missing}${parts.length ? ` (${parts.join("; ")})` : ""}${r.pool === "reads" ? "; the topic config was not at hand, so the floor was not measured" : ""}`);
  }
  return lines;
}

/** The label table and the summary lines. */
export function formatReport(r: ReplayReport): string {
  const head = `${r.items} items in the result${r.version !== null ? ` (study version ${r.version})` : ""}; ${r.rows.length} labelled items`;
  const table = [
    ["label", "rank", "score", "item", "place", "key", "title / why missing"],
    ...r.rows.map((row) => [
      row.label,
      row.rank === null ? "-" : String(row.rank),
      row.score === null ? "-" : String(row.score),
      row.id ?? "-",
      row.place ?? "-",
      row.item,
      row.missing ? `${cutTitle(row.title, 40)} [${MISSING_WORDS[row.missing]}]` : cutTitle(row.title),
    ]),
  ];
  return [head, "", ...pad(table), "", ...summaryLines(r), ...(r.routes ? ["", ...routeLines(r.routes)] : [])].join("\n");
}

/** Two results side by side: each labelled item's rank in both, then the metrics in both. */
export function formatComparison(a: ReplayReport, b: ReplayReport, names: [string, string]): string {
  const rankOf = (r: ReplayReport, item: string) => {
    const row = r.rows.find((x) => x.item === item);
    return row?.rank ?? null;
  };
  const items = [...new Map([...a.rows, ...b.rows].map((row) => [row.item, row])).values()];
  const table = [
    ["label", "A", "B", "key", "title"],
    ...items.map((row) => [
      row.label,
      String(rankOf(a, row.item) ?? "-"),
      String(rankOf(b, row.item) ?? "-"),
      row.item,
      cutTitle(row.title, 50),
    ]),
  ];
  const sa = summaryLines(a);
  const sb = summaryLines(b);
  return [`A: ${names[0]} (${a.items} items)`, `B: ${names[1]} (${b.items} items)`, "", ...pad(table), "", ...sa.flatMap((line, i) => [`A ${line}`, `B ${sb[i]}`])].join("\n");
}

// --- bootstrapping a label file -----------------------------------------------

export interface SeedLine {
  /** 1-based line number in the file. */
  line: number;
  label: TopicLabelKind;
  /** The arXiv id, URL, key or title as written. */
  ref: string;
  reason: string;
}

const SEED_KINDS: readonly TopicLabelKind[] = ["yes", "no", "borderline", "pinned"];

/**
 * A hand-written label list: one item a line, `<yes|no|borderline|pinned> <ref>`,
 * optionally `| <reason>`; the ref an arXiv id, a URL, a key ("github:o/r") or
 * a title. Blank lines and lines starting with `#` are skipped; a line that is
 * none of these is returned in `bad`.
 */
export function parseSeedLines(text: string): { lines: SeedLine[]; bad: { line: number; text: string }[] } {
  const lines: SeedLine[] = [];
  const bad: { line: number; text: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith("#")) return;
    const m = /^(\S+)\s+(.+)$/.exec(s);
    const label = m?.[1].toLowerCase() as TopicLabelKind | undefined;
    if (!m || !label || !SEED_KINDS.includes(label)) {
      bad.push({ line: i + 1, text: s });
      return;
    }
    const bar = m[2].indexOf(" | ");
    const ref = (bar < 0 ? m[2] : m[2].slice(0, bar)).trim();
    const reason = bar < 0 ? "" : m[2].slice(bar + 3).trim();
    lines.push({ line: i + 1, label, ref, reason });
  });
  return { lines, bad };
}

const KEY_PREFIX = /^(arxiv|doi|github|x|url|openreview|acl|ieee):/i;

/** The event key a ref names without looking anything up; null for a title. */
export function keyOfRef(ref: string): string | null {
  const s = ref.trim();
  if (/^arxiv:/i.test(s)) return arxivEventKey(s.slice(6));
  // GitHub keys are lowercased where the pipeline makes them (events.ts eventKeyOfUrl).
  if (/^github:/i.test(s)) return s.toLowerCase();
  if (KEY_PREFIX.test(s)) return currentEventKey(s.replace(KEY_PREFIX, (p) => p.toLowerCase()));
  if (/^https?:\/\//i.test(s)) return eventKeyOfUrl(s);
  const arxiv = arxivEventKey(s);
  if (arxiv) return arxiv;
  const doi = normalizeDoi(s);
  if (doi && /^10\./.test(s)) {
    const id = arxivIdOfDoi(doi);
    return id ? `arxiv:${id}` : `doi:${doi}`;
  }
  return null;
}

/** A title as compared: lower case, letters and digits only. */
export function titleForm(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface ImportOptions {
  searchId: string;
  /** The file's name, for each label's evidence. */
  file: string;
  /** The topic's revision, or 0 when the topic was not at hand. */
  criteria: number;
  now: number;
  random?: () => number;
}

/**
 * Labels for the parsed lines. A ref resolves to a key by itself (keyOfRef) or,
 * for a title, by an exact title match among `known` (key by titleForm); a
 * title that matches nothing is returned in `unresolved` and gets no label.
 * Each label's title is the known one when there is one, else the ref.
 */
export function importedLabels(
  lines: readonly SeedLine[],
  known: ReadonlyMap<string, { key: string; title: string }>,
  knownByKey: ReadonlyMap<string, string>,
  opts: ImportOptions,
): { labels: TopicLabel[]; unresolved: SeedLine[] } {
  const labels: TopicLabel[] = [];
  const unresolved: SeedLine[] = [];
  lines.forEach((l, i) => {
    const byTitle = known.get(titleForm(l.ref));
    const key = keyOfRef(l.ref) ?? byTitle?.key ?? null;
    if (!key) {
      unresolved.push(l);
      return;
    }
    labels.push({
      id: newTopicLabelId(opts.random),
      searchId: opts.searchId,
      item: key,
      title: knownByKey.get(key) ?? byTitle?.title ?? l.ref,
      label: l.label,
      reason: l.reason,
      source: "import",
      evidence: `import:${opts.file}:${l.line}`,
      // In file order: a later line on the same item outranks an earlier one.
      at: opts.now + i,
      brief: null,
      criteria: opts.criteria,
    });
  });
  return { labels, unresolved };
}
