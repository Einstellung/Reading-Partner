// Index provider for Semantic Scholar (docs/69): one descriptor is one relevance
// query against /graph/v1/paper/search, windowed by publication date and floored
// by citation count. Headlines with the library's counts as signals; the
// abstract is the only text, so every item is summary-only.
//
// Query: { terms, days?, minCitations?, fieldsOfStudy? }. `terms` is the
// relevance query (a string, or a list joined with spaces); `days` is the
// window back from today (default 30) sent as S2's open-ended
// `publicationDateOrYear=<date>:`; `minCitations` goes to the server as
// `minCitationCount` and is applied again locally, since the server treats a
// paper with no known day as January 1st of its year and a filter we rely on
// is one we check. The anonymous pool is thin (docs/pitfall/73): one retry,
// short backoff, and a terminal 429 fails the source rather than waiting it out.

import { throwIfAborted } from "../../../platform/app/abort";
import { fetchWithRetry, HttpStatusError, interactiveRetry } from "../../../platform/http/throttled-fetch";
import { parseS2Search, s2TopicSearchUrl, S2_INDEX_FIELDS, type S2Hit } from "./s2-client";
import { itemId } from "../../extract/id";
import type { SourceDescriptor } from "../descriptor";
import { daysBefore, queryInt, queryStrings, type PluginDeps, type SourcePlugin, type IndexQuery } from "../plugin";
import type { InfoItem, ItemSignals } from "../item";

const HOST = "api.semanticscholar.org";
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;
// /paper/search refuses a larger page.
const MAX_LIMIT = 100;
const SUMMARY_CHARS = 400;

// The query's fields, read loosely and defaulted. `minCitations` allows 0, which
// queryInt does not, so it is read by hand.
interface S2Query {
  terms: string[];
  days: number;
  minCitations: number;
  fieldsOfStudy: string[];
}

function readQuery(q: IndexQuery): S2Query {
  return {
    terms: queryStrings(q, "terms"),
    days: queryInt(q, "days") ?? DEFAULT_DAYS,
    minCitations: minCitations(q) ?? 0,
    fieldsOfStudy: queryStrings(q, "fieldsOfStudy"),
  };
}

function minCitations(q: IndexQuery): number | undefined {
  const v = q.minCitations;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

// The search string S2 sees. Hyphenated terms match nothing on /paper/search
// (the API docs say to replace the hyphen with a space), so "vision-language-action"
// goes out as three words; the describe line keeps the user's spelling.
export function s2SearchTerms(terms: string[]): string {
  return terms.join(" ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

// The request one query makes on a given day, for the given page size.
export function s2IndexUrl(q: IndexQuery, today: string, limit: number): string {
  const read = readQuery(q);
  return s2TopicSearchUrl(s2SearchTerms(read.terms), {
    limit: Math.max(1, Math.min(MAX_LIMIT, limit)),
    fields: S2_INDEX_FIELDS,
    publishedSince: daysBefore(today, read.days),
    minCitationCount: read.minCitations,
    fieldsOfStudy: read.fieldsOfStudy,
  });
}

// The paper's own handle: S2's id first (always present in a search row), then
// the DOI, then the arXiv id. Item id and sourceKey are both built from it.
function paperKey(h: S2Hit): string | null {
  return h.paperId ?? h.doi ?? h.arxivId;
}

// Where the reader lands: the arXiv abstract page when the paper has one (the
// funnel can fetch a body from it), else the open-access PDF, else S2's page.
function paperUrl(h: S2Hit): string {
  if (h.arxivId) return `https://arxiv.org/abs/${h.arxivId}`;
  return h.url ?? "";
}

function signals(h: S2Hit): ItemSignals {
  const s: ItemSignals = {};
  if (h.citationCount !== null) s.citations = h.citationCount;
  if (h.influentialCitationCount != null) s.influentialCitations = h.influentialCitationCount;
  if (h.venue) s.tags = [h.venue];
  return s;
}

export function s2Item(desc: SourceDescriptor, h: S2Hit): InfoItem | null {
  const key = paperKey(h);
  if (!key) return null;
  const item: InfoItem = {
    id: itemId(desc.id, key),
    source: desc.id,
    sourceName: desc.name,
    sourceKey: key,
    title: h.title,
    url: paperUrl(h),
    publishedAt: h.publicationDate ?? (h.year !== null ? String(h.year) : ""),
    summaryOnly: true,
    signals: signals(h),
  };
  const abstract = h.abstract.trim();
  if (abstract) {
    item.summary = abstract.slice(0, SUMMARY_CHARS);
    item.textContent = abstract;
  }
  return item;
}

export const s2Plugin: SourcePlugin = {
  id: "s2",
  name: "Semantic Scholar",
  hosts: [HOST],
  defaultLimit: DEFAULT_LIMIT,

  validateQuery(q: IndexQuery): string | null {
    if (queryStrings(q, "terms").length === 0) return "terms is required (a string or a list of strings)";
    if (q.days !== undefined && queryInt(q, "days") === undefined) return "days must be a positive number";
    if (q.minCitations !== undefined && minCitations(q) === undefined) return "minCitations must be a non-negative number";
    if (q.fieldsOfStudy !== undefined && queryStrings(q, "fieldsOfStudy").length === 0) {
      return "fieldsOfStudy must be a list of strings";
    }
    return null;
  },

  describeQuery(q: IndexQuery): string {
    const read = readQuery(q);
    const parts = ["Semantic Scholar", read.terms.join(" "), `last ${read.days} days`];
    if (read.minCitations > 0) parts.push(`≥ ${read.minCitations} citations`);
    if (read.fieldsOfStudy.length) parts.push(read.fieldsOfStudy.join(", "));
    return parts.join(" · ");
  },

  async discover(desc: SourceDescriptor, q: IndexQuery, deps: PluginDeps): Promise<InfoItem[]> {
    throwIfAborted(deps.signal);
    const url = s2IndexUrl(q, deps.today(), deps.limit ?? DEFAULT_LIMIT);
    const res = await fetchWithRetry(url, { signal: deps.signal }, interactiveRetry(deps.fetchFn));
    if (!res.ok) throw new HttpStatusError(res.status, HOST);
    // parseS2Search already drops untitled rows and reads `data: null` as empty.
    const floor = readQuery(q).minCitations;
    const items: InfoItem[] = [];
    for (const hit of parseS2Search(await res.json())) {
      if ((hit.citationCount ?? 0) < floor) continue;
      const item = s2Item(desc, hit);
      if (item) items.push(item);
    }
    return items;
  },
};
