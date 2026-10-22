// A study's graph expansion, the requests (docs/info/92): the positives turned
// into S2 ids in one batch, then each stream — S2's recommendations, and every
// walked positive's citations and references — asked of S2 first and of
// OpenAlex when S2 is cooling down, rate limited, does not know the paper or
// withholds its edges. Abstracts S2 left out come from OpenAlex (title-checked,
// docs/pitfall/668), then from arXiv's id list. What each stream kept is written
// to the run directory after it is read (graph-read.ts), so a resumed run reads
// only the streams not on file; answers go into this device's cache
// (graph-expand.ts), so a second run inside the cache's life asks nothing.
//
// Never throws for a library's failure: a stream that did not come back is on
// file with its outcome, for a retry to read again (retry.ts). An abort is
// thrown. Requests stay inside the budget (graph-expand.ts): no more than
// S2_REQUESTS_MAX to S2, OPENALEX_LISTS_MAX list requests and
// OPENALEX_LOOKUPS_MAX single works to OpenAlex, ARXIV_ABSTRACT_REQUESTS to arXiv.

import { isAbortError, throwIfAborted } from "../../platform/app/abort";
import { appData } from "../../platform/app/appdata";
import { loadSettings } from "../../platform/app/settings";
import {
  fetchWithRetry,
  HttpStatusError,
  interactiveRetry,
  isHostCoolingDown,
  isRateLimitError,
  type FetchFn,
} from "../../platform/http/throttled-fetch";
import { infoFetch } from "../../workshop/extract/http";
import { normalizeArxivId, parseArxivAtom, type ArxivEntry } from "../sources/plugins/arxiv-client";
import { pickByTitle } from "../sources/plugins/match";
import {
  fetchOpenAlexCitedBy,
  fetchOpenAlexWork,
  fetchOpenAlexWorksByArxiv,
  fetchOpenAlexWorksByIds,
  OA_MAX_OR_IDS,
} from "../sources/plugins/openalex-client";
import { fetchS2Batch, fetchS2EdgePage, fetchS2Recommendations } from "../sources/plugins/s2-client";
import {
  ABSTRACT_BATCH,
  ARXIV_ABSTRACT_REQUESTS,
  arxivIdOfKey,
  cachedStream,
  chooseWalked,
  excludedIds,
  filedPositives,
  foundFromOpenAlex,
  foundFromS2,
  fresh,
  GRAPH_CACHE_FILE,
  CACHE_TTL_MS,
  HUB_CITATIONS,
  keepPapers,
  NEGATIVES_MAX,
  newestWorks,
  OPENALEX_LISTS_MAX,
  OPENALEX_LOOKUPS_MAX,
  openAlexHandle,
  parseGraphCache,
  pickExamples,
  planStreams,
  pruneGraphCache,
  rankRelated,
  REC_LIMIT,
  recCacheKey,
  S2_REQUESTS_MAX,
  s2Handle,
  sift,
  streamOf,
  type CachedWork,
  type GraphCache,
  type PlannedStream,
  type Sifted,
} from "./graph-expand";
import {
  emptyGraphRead,
  loadGraphRead,
  RETRIED_OUTCOMES,
  saveGraphRead,
  withDoiOnly,
  withStream,
  type GraphLibrary,
  type GraphOutcome,
  type GraphPositive,
  type GraphRead,
} from "./graph-read";
import type { TopicLabel } from "./labels";
import type { TopicSeed } from "./types";

export interface GraphReadPlan {
  /** The window's first day, local: a paper whose arXiv month is earlier is left out. */
  since: string;
  /** A retry's: the stream ids it reads again. Null otherwise. */
  only: readonly string[] | null;
  /** An update's: the positives earlier runs of the study walked; only the others are walked, and with none there is nothing to read. Null otherwise. */
  walkedBefore: readonly string[] | null;
}

export interface GraphLiveDeps {
  fetchFn: FetchFn;
  s2Key?: string;
  openAlexKey?: string;
  load(): Promise<GraphRead | null>;
  save(read: GraphRead): Promise<void>;
  /** Called after each write, for the run's progress line. */
  onChange?(read: GraphRead): void;
  cache: { load(): Promise<string | null>; save(text: string): Promise<void> };
  now(): number;
}

type Lane = "s2" | "oaLists" | "oaLookups" | "arxiv";

const LIMIT: Record<Lane, number> = {
  s2: S2_REQUESTS_MAX,
  oaLists: OPENALEX_LISTS_MAX,
  oaLookups: OPENALEX_LOOKUPS_MAX,
  arxiv: ARXIV_ABSTRACT_REQUESTS,
};

interface Ctx {
  deps: GraphLiveDeps;
  signal: AbortSignal;
  since: string;
  cache: GraphCache;
  spent: Record<Lane, number>;
  read: GraphRead;
  exclude: Set<string>;
  /** DOI-only titles counted in this read, lower case. */
  seenDoi: Set<string>;
}

/** One library's try at a stream. */
type Attempt = { kind: "answer"; library: GraphLibrary; sifted: Sifted } | { kind: "miss"; outcome: GraphOutcome };

const miss = (outcome: GraphOutcome): Attempt => ({ kind: "miss", outcome });

function outcomeOf(e: unknown, signal: AbortSignal): GraphOutcome {
  if (signal.aborted || isAbortError(e)) throw e;
  if (isHostCoolingDown(e) && !e.refused) return "cooling_down";
  if (isRateLimitError(e)) return "rate_limited";
  return "failed";
}

/**
 * One request inside the lane's budget. `outcome` null: not sent, the budget is
 * spent. A cooldown that refused it before it went out costs nothing.
 */
async function call<T>(ctx: Ctx, lane: Lane, work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; outcome: GraphOutcome | null }> {
  if (ctx.spent[lane] >= LIMIT[lane]) return { ok: false, outcome: null };
  throwIfAborted(ctx.signal);
  ctx.spent[lane]++;
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    const outcome = outcomeOf(e, ctx.signal);
    if (outcome === "cooling_down") ctx.spent[lane]--;
    return { ok: false, outcome };
  }
}

const answered = (attempts: Attempt[]) => attempts.find((a): a is Extract<Attempt, { kind: "answer" }> => a.kind === "answer") ?? null;

/** The outcome of a stream no library answered: one to read again if any library failed, else not found. */
function missedOutcome(attempts: Attempt[]): GraphOutcome {
  const outcomes = attempts.flatMap((a) => (a.kind === "miss" ? [a.outcome] : []));
  return outcomes.find((o) => RETRIED_OUTCOMES.includes(o)) ?? (outcomes.length ? "not_found" : "failed");
}

// --- ids ---

const idsOf = (ctx: Ctx, key: string) => {
  const e = ctx.cache.ids[key];
  return e && fresh(e.at, CACHE_TTL_MS.ids, ctx.deps.now()) ? e : null;
};

/** How S2 is asked for a paper: its S2 id once the batch knows it; its key's handle when the batch has not answered; null when S2 does not know it. */
function s2Ref(ctx: Ctx, key: string): string | null {
  const ids = idsOf(ctx, key);
  return ids ? ids.s2 : s2Handle(key);
}

/** The positives and negatives S2's batch has not answered for yet, in one request; the positives with what it said. */
async function resolve(ctx: Ctx, positives: GraphPositive[], negatives: readonly string[]): Promise<GraphPositive[]> {
  const ask = [...positives.map((p) => p.key), ...negatives].filter((k) => !idsOf(ctx, k) && s2Handle(k));
  if (ask.length) {
    const r = await call(ctx, "s2", () => fetchS2Batch(ask.map((k) => s2Handle(k)!), ctx.deps.fetchFn, ctx.deps.s2Key));
    if (r.ok) {
      const at = ctx.deps.now();
      ask.forEach((k, i) => {
        const hit = r.value[i];
        const arxivId = (hit?.arxivId ? normalizeArxivId(hit.arxivId) : null) ?? arxivIdOfKey(k);
        ctx.cache.ids[k] = { s2: hit?.paperId ?? null, arxivId, citationCount: hit?.citationCount ?? null, at };
      });
    }
  }
  return positives.map((p) => {
    const ids = idsOf(ctx, p.key);
    return ids ? { ...p, s2: ids.s2, citationCount: ids.citationCount } : p;
  });
}

function notePositive(ctx: Ctx, key: string, change: (p: GraphPositive) => GraphPositive): void {
  ctx.read = { ...ctx.read, positives: ctx.read.positives.map((p) => (p.key === key ? change(p) : p)) };
}

const positiveOf = (ctx: Ctx, key: string): GraphPositive =>
  ctx.read.positives.find((p) => p.key === key) ?? { key, title: "", why: "seed", s2: null, openAlex: null, citationCount: null, walked: false };

/** A positive's OpenAlex work, title-checked: a lookup by arXiv DOI can name another paper (docs/pitfall/668). */
async function openAlexWork(ctx: Ctx, key: string): Promise<{ kind: "work"; work: CachedWork & { openAlex: string } } | { kind: "miss"; outcome: GraphOutcome | null }> {
  const now = ctx.deps.now();
  let entry = ctx.cache.works[key];
  if (!entry || !fresh(entry.at, CACHE_TTL_MS.works, now)) {
    const handle = openAlexHandle(key);
    if (!handle) return { kind: "miss", outcome: "not_found" };
    const r = await call(ctx, "oaLookups", () => fetchOpenAlexWork(handle, ctx.deps.fetchFn, ctx.deps.openAlexKey));
    if (!r.ok) return { kind: "miss", outcome: r.outcome };
    const title = positiveOf(ctx, key).title;
    const got = r.value;
    const same = got && got.hit.openAlexId && (!title.trim() || pickByTitle([got.hit], title, (h) => h.title));
    entry =
      same && got
        ? { openAlex: got.hit.openAlexId, citedBy: got.hit.citedByCount, referenced: got.referenced, related: got.related, at: now }
        : { openAlex: null, citedBy: null, referenced: [], related: [], at: now };
    ctx.cache.works[key] = entry;
  }
  const work = entry;
  notePositive(ctx, key, (p) => ({ ...p, openAlex: work.openAlex, citationCount: p.citationCount ?? work.citedBy }));
  return work.openAlex ? { kind: "work", work: { ...work, openAlex: work.openAlex } } : { kind: "miss", outcome: "not_found" };
}

// --- streams ---

async function readRec(ctx: Ctx, planned: PlannedStream): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  const positive = planned.from.map((k) => s2Ref(ctx, k)).filter((id): id is string => !!id);
  const negative = ctx.read.negatives.map((k) => s2Ref(ctx, k)).filter((id): id is string => !!id);
  if (positive.length === 0) attempts.push(miss("not_found"));
  else {
    const r = await call(ctx, "s2", () =>
      fetchS2Recommendations({ positive, negative }, { limit: REC_LIMIT }, ctx.deps.fetchFn, ctx.deps.s2Key),
    );
    if (r.ok) attempts.push(r.value ? { kind: "answer", library: "s2", sifted: sift(r.value.map(foundFromS2), ctx.since) } : miss("not_found"));
    else if (r.outcome) attempts.push(miss(r.outcome));
  }
  if (answered(attempts)) return attempts;
  // OpenAlex has no recommendations: the works most positives count as related, which are mostly old (docs/pitfall/669).
  const related: string[][] = [];
  for (const key of planned.from) {
    const w = await openAlexWork(ctx, key);
    if (w.kind === "work") related.push(w.work.related);
    else if (w.outcome) attempts.push(miss(w.outcome));
  }
  if (related.length === 0) return attempts;
  const ids = rankRelated(related);
  if (ids.length === 0) return [...attempts, { kind: "answer", library: "openalex", sifted: { total: 0, papers: [], doiOnly: [] } }];
  const r = await call(ctx, "oaLists", () => fetchOpenAlexWorksByIds(ids, { limit: OA_MAX_OR_IDS }, ctx.deps.fetchFn, ctx.deps.openAlexKey));
  if (r.ok) attempts.push({ kind: "answer", library: "openalex", sifted: sift(r.value.map(foundFromOpenAlex), ctx.since) });
  else if (r.outcome) attempts.push(miss(r.outcome));
  return attempts;
}

const HUB = "hub" as const;

async function readWalk(ctx: Ctx, planned: PlannedStream & { kind: "cites" | "refs" }): Promise<Attempt[] | typeof HUB> {
  const key = planned.from[0];
  const isHub = () => (positiveOf(ctx, key).citationCount ?? 0) > HUB_CITATIONS;
  if (planned.kind === "cites" && isHub()) return HUB;
  const attempts: Attempt[] = [];
  const ref = s2Ref(ctx, key);
  if (!ref) attempts.push(miss("not_found"));
  else {
    const r = await call(ctx, "s2", () =>
      fetchS2EdgePage(ref, planned.kind === "cites" ? "citations" : "references", ctx.deps.fetchFn, ctx.deps.s2Key),
    );
    // Not known, or its edges withheld (docs/pitfall/73): OpenAlex may have them.
    if (r.ok) attempts.push(r.value.kind === "ok" ? { kind: "answer", library: "s2", sifted: sift(r.value.hits.map(foundFromS2), ctx.since) } : miss("not_found"));
    else if (r.outcome) attempts.push(miss(r.outcome));
  }
  if (answered(attempts)) return attempts;
  const w = await openAlexWork(ctx, key);
  if (w.kind === "miss") return w.outcome ? [...attempts, miss(w.outcome)] : attempts;
  if (planned.kind === "cites" && isHub()) return HUB;
  if (planned.kind === "refs" && w.work.referenced.length === 0) {
    return [...attempts, { kind: "answer", library: "openalex", sifted: { total: 0, papers: [], doiOnly: [] } }];
  }
  const r =
    planned.kind === "cites"
      ? await call(ctx, "oaLists", async () => {
          const page = await fetchOpenAlexCitedBy(w.work.openAlex, { since: ctx.since, limit: 100 }, ctx.deps.fetchFn, ctx.deps.openAlexKey);
          return { hits: page.hits, total: page.total ?? page.hits.length };
        })
      : // The newest of the bibliography, as many as one request takes; the window is applied here, by the arXiv id.
        await call(ctx, "oaLists", async () => {
          const ids = newestWorks(w.work.referenced);
          const hits = await fetchOpenAlexWorksByIds(ids, { limit: OA_MAX_OR_IDS }, ctx.deps.fetchFn, ctx.deps.openAlexKey);
          return { hits, total: w.work.referenced.length };
        });
  if (r.ok) attempts.push({ kind: "answer", library: "openalex", sifted: { ...sift(r.value.hits.map(foundFromOpenAlex), ctx.since), total: r.value.total } });
  else if (r.outcome) attempts.push(miss(r.outcome));
  return attempts;
}

const cacheKeyOf = (ctx: Ctx, planned: PlannedStream) => (planned.kind === "rec" ? recCacheKey(planned.from, ctx.read.negatives) : planned.id);

/** One stream read (or taken from the cache) and put on the read. */
async function readStream(ctx: Ctx, planned: PlannedStream): Promise<void> {
  const now = ctx.deps.now();
  const key = cacheKeyOf(ctx, planned);
  let answer: { library: GraphLibrary; sifted: Sifted } | null = null;
  const hit = cachedStream(ctx.cache, key, ctx.since, now);
  if (hit) answer = { library: hit.library, sifted: { total: hit.total, papers: hit.papers, doiOnly: hit.doiOnly } };
  else {
    const attempts = planned.kind === "rec" ? await readRec(ctx, planned) : await readWalk(ctx, planned as PlannedStream & { kind: "cites" | "refs" });
    if (attempts === HUB) {
      ctx.read = withStream(ctx.read, streamOf(planned, { library: null, outcome: "hub", total: 0, papers: [] }, now));
      return;
    }
    const got = answered(attempts);
    if (!got) {
      ctx.read = withStream(ctx.read, streamOf(planned, { library: null, outcome: missedOutcome(attempts), total: 0, papers: [] }, now));
      return;
    }
    answer = got;
    ctx.cache.streams[key] = { library: got.library, since: ctx.since, total: got.sifted.total, papers: got.sifted.papers, doiOnly: got.sifted.doiOnly, at: now };
  }
  const papers = keepPapers(planned.kind, answer.sifted.papers, ctx.exclude, ctx.since);
  const stream = streamOf(planned, { library: answer.library, outcome: papers.length ? "ok" : "empty", total: answer.sifted.total, papers }, now);
  const doiOnly = answer.sifted.doiOnly.filter((t) => !ctx.seenDoi.has(t.toLowerCase()));
  for (const t of doiOnly) ctx.seenDoi.add(t.toLowerCase());
  ctx.read = withDoiOnly(withStream(ctx.read, stream), doiOnly);
}

// --- abstracts ---

/** arXiv's export API for many ids at once. */
export function arxivIdListUrl(ids: readonly string[]): string {
  return `https://export.arxiv.org/api/query?id_list=${ids.map(encodeURIComponent).join(",")}&max_results=${ids.length}`;
}

async function fetchArxivEntries(ids: readonly string[], fetchFn: FetchFn): Promise<ArxivEntry[]> {
  const res = await fetchWithRetry(arxivIdListUrl(ids), undefined, interactiveRetry(fetchFn));
  if (!res.ok) throw new HttpStatusError(res.status, "export.arxiv.org");
  return parseArxivAtom(await res.text());
}

/** The abstracts the kept papers lack: from the cache, OpenAlex (title-checked), then arXiv. Whether any was found. */
async function fillAbstracts(ctx: Ctx): Promise<boolean> {
  const missing = new Map<string, string>();
  for (const s of ctx.read.streams) for (const p of s.papers) if (!p.abstract.trim()) missing.set(p.arxivId, p.title);
  if (missing.size === 0) return false;
  const now = ctx.deps.now();
  const found = new Map<string, string>();
  for (const id of missing.keys()) {
    const c = ctx.cache.abstracts[id];
    if (c && c.text && fresh(c.at, CACHE_TTL_MS.abstracts, now)) found.set(id, c.text);
  }
  const left = () => [...missing.keys()].filter((id) => !found.has(id));
  const batches = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / ABSTRACT_BATCH) }, (_, i) => ids.slice(i * ABSTRACT_BATCH, (i + 1) * ABSTRACT_BATCH));
  for (const batch of batches(left())) {
    const r = await call(ctx, "oaLists", () => fetchOpenAlexWorksByArxiv(batch, ctx.deps.fetchFn, ctx.deps.openAlexKey));
    if (!r.ok) break;
    for (const hit of r.value) {
      const id = hit.arxivId ? normalizeArxivId(hit.arxivId) : null;
      const title = id ? missing.get(id) : undefined;
      if (!id || title === undefined || !hit.abstract.trim()) continue;
      if (!pickByTitle([hit], title, (h) => h.title)) continue;
      found.set(id, hit.abstract.trim());
    }
  }
  for (const batch of batches(left())) {
    const r = await call(ctx, "arxiv", () => fetchArxivEntries(batch, ctx.deps.fetchFn));
    if (!r.ok) break;
    for (const e of r.value) if (missing.has(e.id) && e.summary.trim()) found.set(e.id, e.summary.trim());
  }
  if (found.size === 0) return false;
  for (const [id, text] of found) if (!ctx.cache.abstracts[id]) ctx.cache.abstracts[id] = { text, at: now };
  ctx.read = {
    ...ctx.read,
    streams: ctx.read.streams.map((s) => ({
      ...s,
      papers: s.papers.map((p) => (!p.abstract.trim() && found.has(p.arxivId) ? { ...p, abstract: found.get(p.arxivId)! } : p)),
    })),
  };
  return true;
}

// --- the read ---

async function saveCache(ctx: Ctx): Promise<void> {
  try {
    await ctx.deps.cache.save(JSON.stringify(pruneGraphCache(ctx.cache, ctx.deps.now())));
  } catch {
    // Only a cache: the next read asks again.
  }
}

/**
 * Read what is left of a study's graph expansion and return everything on
 * file; null when there is nothing to expand from (no positive, or an update
 * with no new one), and then nothing is written.
 */
export async function readGraphExpansion(
  input: { seeds: readonly TopicSeed[]; labels: readonly TopicLabel[] },
  plan: GraphReadPlan,
  deps: GraphLiveDeps,
  signal: AbortSignal,
): Promise<GraphRead | null> {
  const examples = pickExamples(input.seeds, input.labels);
  const onFile = await deps.load();
  let cacheText: string | null = null;
  try {
    cacheText = await deps.cache.load();
  } catch {
    // An unreadable cache is an empty one.
  }
  const ctx: Ctx = {
    deps,
    signal,
    since: plan.since,
    cache: parseGraphCache(cacheText),
    spent: { s2: 0, oaLists: 0, oaLookups: 0, arxiv: 0 },
    read: onFile ?? emptyGraphRead([], []),
    exclude: new Set(),
    seenDoi: new Set((onFile?.doiOnly.titles ?? []).map((t) => t.toLowerCase())),
  };
  const save = async () => {
    await deps.save(ctx.read);
    deps.onChange?.(ctx.read);
  };
  if (!onFile) {
    if (examples.positives.length === 0) return null;
    const walked = chooseWalked(examples.positives, plan);
    if (!walked) return null;
    const negatives = examples.negatives.slice(0, NEGATIVES_MAX).map((n) => n.key);
    throwIfAborted(signal);
    ctx.read = emptyGraphRead(await resolve(ctx, filedPositives(examples.positives, walked), negatives), negatives);
    await save();
    await saveCache(ctx);
  }
  ctx.exclude = excludedIds(examples, ctx.read.positives.map((p) => idsOf(ctx, p.key)?.arxivId ?? null));
  for (const planned of planStreams(ctx.read.positives, plan.only)) {
    if (ctx.read.streams.some((s) => s.id === planned.id)) continue;
    throwIfAborted(signal);
    await readStream(ctx, planned);
    await save();
    await saveCache(ctx);
  }
  if (await fillAbstracts(ctx)) {
    await save();
    await saveCache(ctx);
  }
  return ctx.read;
}

/** The expansion's files and libraries on this device: the run directory, the cache, the app's fetch and the keys in Settings. */
export async function liveGraphDeps(dir: string, onChange?: (read: GraphRead) => void): Promise<GraphLiveDeps> {
  const settings = await loadSettings().catch(() => null);
  return {
    fetchFn: infoFetch,
    s2Key: settings?.semanticScholarApiKey ?? undefined,
    openAlexKey: settings?.openAlexApiKey ?? undefined,
    load: () => loadGraphRead(appData, dir),
    save: (read) => saveGraphRead(appData, dir, read),
    onChange,
    cache: {
      load: async () => ((await appData.exists(GRAPH_CACHE_FILE)) ? appData.readText(GRAPH_CACHE_FILE) : null),
      save: (text) => appData.writeAtomic(GRAPH_CACHE_FILE, text),
    },
    now: () => Date.now(),
  };
}
