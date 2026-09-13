// Index provider for arXiv (docs/69): one descriptor is one export-API query,
// "these categories and/or these terms, submitted in the last N days". The
// query goes through the scholar client's URL grammar and Atom reader; this
// file only shapes the query and maps entries to items.
//
// Recency is a submittedDate range inside search_query, never a sortBy: the
// export API does not answer sortBy=submittedDate and its limiter is strict
// (docs/pitfall/72). One request per run, through fetchWithRetry's per-host
// spacing; a terminal failure throws so collectAll records source health.

import { throwIfAborted } from "../../../platform/app/abort";
import { arxivQueryTerms, parseArxivAtom, type ArxivEntry } from "./arxiv-client";
import { fetchWithRetry, HttpStatusError, interactiveRetry } from "../../../platform/http/throttled-fetch";
import { itemId } from "../../extract/id";
import type { SourceDescriptor } from "../descriptor";
import {
  daysBefore,
  queryInt,
  queryStrings,
  type PluginDeps,
  type SourcePlugin,
  type IndexQuery,
} from "../plugin";
import type { InfoItem } from "../item";

const HOST = "export.arxiv.org";
const DEFAULT_LIMIT = 50;
const DEFAULT_DAYS = 2;
// A window wider than a month is an archive pull, not a recency query.
const MAX_DAYS = 30;
const SUMMARY_CHARS = 400;

// "cs.RO", "math-ph", "q-bio.NC": an archive, optionally with a subject class.
const CATEGORY_RE = /^[a-z-]+(\.[A-Z]{2})?$/;

interface ArxivIndexQuery {
  categories: string[];
  // Cleaned search words, one all: clause each.
  terms: string[];
  days: number;
}

// The query as the provider reads it, or one line saying what is wrong.
function readQuery(q: IndexQuery): ArxivIndexQuery | string {
  const categories = queryStrings(q, "categories");
  const bad = categories.find((c) => !CATEGORY_RE.test(c));
  if (bad !== undefined) return `unknown arXiv category "${bad}" (expected e.g. cs.RO)`;
  const rawTerms = queryStrings(q, "terms");
  // Every term is cleaned to the words an all: search can use (the export API
  // has no free-text query); one term may yield several words.
  const terms = [...new Set(rawTerms.flatMap((t) => arxivQueryTerms(t)))];
  if (rawTerms.length && !terms.length) return "terms contain no searchable words";
  if (!categories.length && !terms.length) return "query needs categories or terms";
  let days = DEFAULT_DAYS;
  if (q.days !== undefined) {
    const d = queryInt(q, "days");
    if (d === undefined) return "days must be a positive integer";
    if (d > MAX_DAYS) return `days must be at most ${MAX_DAYS}`;
    days = d;
  }
  return { categories, terms, days };
}

// Minute-precision stamp the submittedDate field wants: "2026-09-13" -> "202609130000".
function stamp(date: string, hhmm: string): string {
  return `${date.replace(/-/g, "")}${hhmm}`;
}

// The export-API URL for a query on a given UTC day. Closed range from the
// start of `today - days` to the end of today; no sortBy (pitfall 72).
export function arxivIndexUrl(query: IndexQuery, today: string, limit: number): string {
  const read = readQuery(query);
  if (typeof read === "string") throw new Error(read);
  const clauses: string[] = [];
  if (read.categories.length) {
    const cats = read.categories.map((c) => `cat:${c}`).join(" OR ");
    clauses.push(read.categories.length > 1 ? `(${cats})` : cats);
  }
  for (const t of read.terms) clauses.push(`all:${t}`);
  clauses.push(`submittedDate:[${stamp(daysBefore(today, read.days), "0000")} TO ${stamp(today, "2359")}]`);
  const q = encodeURIComponent(clauses.join(" AND "));
  return `https://${HOST}/api/query?search_query=${q}&max_results=${limit}`;
}

function toItem(desc: SourceDescriptor, e: ArxivEntry): InfoItem {
  const tags: string[] = [];
  if (e.primaryCategory) tags.push(e.primaryCategory);
  const n = e.authors.length;
  if (n) tags.push(`${n} author${n === 1 ? "" : "s"}`);
  const item: InfoItem = {
    id: itemId(desc.id, e.id),
    source: desc.id,
    sourceName: desc.name,
    sourceKey: e.id,
    title: e.title || e.id,
    url: `https://arxiv.org/abs/${e.id}`,
    publishedAt: e.published,
    // The abstract is all the index gives; the analyst reads it whole, and the
    // item stays summary-only because no body page was fetched.
    summary: e.summary.slice(0, SUMMARY_CHARS),
    textContent: e.summary,
    summaryOnly: true,
  };
  if (tags.length) item.signals = { tags };
  return item;
}

export const arxivPlugin: SourcePlugin = {
  id: "arxiv",
  name: "arXiv",
  hosts: [HOST],
  defaultLimit: DEFAULT_LIMIT,

  validateQuery(query: IndexQuery): string | null {
    const read = readQuery(query);
    return typeof read === "string" ? read : null;
  },

  // "arXiv cs.RO, cs.AI · all:manipulation · last 2 days"
  describeQuery(query: IndexQuery): string {
    const read = readQuery(query);
    if (typeof read === "string") return `arXiv (invalid query: ${read})`;
    const parts = ["arXiv"];
    if (read.categories.length) parts[0] += ` ${read.categories.join(", ")}`;
    if (read.terms.length) parts.push(read.terms.map((t) => `all:${t}`).join(", "));
    parts.push(`last ${read.days} day${read.days === 1 ? "" : "s"}`);
    return parts.join(" · ");
  },

  async discover(desc: SourceDescriptor, query: IndexQuery, deps: PluginDeps): Promise<InfoItem[]> {
    throwIfAborted(deps.signal);
    const url = arxivIndexUrl(query, deps.today(), deps.limit ?? DEFAULT_LIMIT);
    const init = deps.signal ? { signal: deps.signal } : undefined;
    const res = await fetchWithRetry(url, init, interactiveRetry(deps.fetchFn));
    if (!res.ok) throw new HttpStatusError(res.status, HOST);
    return parseArxivAtom(await res.text()).map((e) => toItem(desc, e));
  },
};
