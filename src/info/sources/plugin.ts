// A source plugin (docs/69): one file per library the bureau can ask — arXiv,
// GitHub, Hugging Face, Semantic Scholar, OpenAlex, PubMed — registered here and
// looked up by id, so no caller knows the file. The library's low-level client
// (URL builders, parsers) sits beside it as `<id>-client.ts`; reading/papers
// uses those clients too, since info is reading's inlet and the import runs
// that way.
//
// Today every plugin implements the index capability: is this query well
// formed, how would you say it in one line, and what did it yield today — the
// three things the `index` discovery kind needs. Bodies are not its business
// (fulltext is), nor is ranking (the screen and the analyst are). It hands back
// headlines with the numbers the library counted for them, as InfoItem.signals.
// The other capabilities (search, lookup, enrich) are optional slots for the
// next step: reading's paper search and the day-3 / day-14 re-scoring of
// docs/69 will call them instead of the clients directly.
//
// Pure module: the registry is a Map, and every plugin takes its fetch
// injected, so the whole thing runs under bun with a scripted fetch. It sits
// beside the engine rather than in sources/plugins/ so the plugins can import
// the descriptor and item types from here without the engine importing them
// back: sources -> sources/plugins is the one direction the layering test
// allows, and the program registers the set (sources/plugins/all.ts).

import { addDays } from "../../platform/std/day";
import type { FetchFn } from "../extract/http";
import type { SourceDescriptor } from "./descriptor";
import type { InfoItem, ItemSignals } from "./item";

export type IndexQuery = Record<string, unknown>;

export interface PluginDeps {
  fetchFn: FetchFn;
  signal?: AbortSignal;
  // Wall clock and local date, injected so a query for "the last two days" is
  // testable on a fixed day.
  now(): number;
  today(): string;
  // Items the caller wants at most; from the descriptor's `limit`, or the
  // provider's own default when absent.
  limit?: number;
}

export interface SourcePlugin {
  // The `provider` string an index descriptor names.
  id: string;
  // Display name for the sources page ("arXiv", "GitHub").
  name: string;
  // Hostnames the provider talks to, for health notes and caveats.
  hosts: string[];
  // Default `limit` when the descriptor sets none.
  defaultLimit: number;
  // Null when the query is well formed; otherwise one line saying what is wrong.
  // Pure: the descriptor validator calls it with no network.
  validateQuery(query: IndexQuery): string | null;
  // One line a person reads on the sources page: "arXiv cs.RO · last 2 days".
  describeQuery(query: IndexQuery): string;
  // Run the query. Headlines with signals, in the order the library returned
  // them; never a body. Throws on a failed request (collectAll records it as
  // source health); returns [] when the library has nothing.
  discover(desc: SourceDescriptor, query: IndexQuery, deps: PluginDeps): Promise<InfoItem[]>;

  // --- optional capabilities, unimplemented this release -------------------

  // Relevance search for an interactive caller (reading's paper search, a
  // tasking run): free text in, headlines with signals out.
  search?(text: string, opts: { sinceYear?: number; limit?: number }, deps: PluginDeps): Promise<InfoItem[]>;
  // One known handle (an arXiv id, a repo full name, a Hub id) resolved to an
  // item, or null when the library does not have it.
  lookup?(handle: string, deps: PluginDeps): Promise<InfoItem | null>;
  // The library's numbers for handles it knows — S2 citations for arXiv ids,
  // OpenDigger for repos — for the day-3 / day-14 re-scoring (docs/69).
  enrich?(handles: string[], deps: PluginDeps): Promise<Map<string, ItemSignals>>;
}

const providers = new Map<string, SourcePlugin>();

// sources/plugins/all.ts registers the set; the program calls it once at
// startup, and a test registers the one plugin it exercises.
export function registerSourcePlugin(p: SourcePlugin): void {
  providers.set(p.id, p);
}

export function sourcePlugin(id: string): SourcePlugin | undefined {
  return providers.get(id);
}

export function sourcePluginIds(): string[] {
  return [...providers.keys()].sort();
}

// Test seam: forget every registration.
export function resetSourcePluginsForTests(): void {
  providers.clear();
}

// A descriptor's plugin and query, when it is an index source with a
// registered plugin; undefined otherwise. The one lookup the engine, the probe
// and the sources page share.
export function pluginOf(
  desc: SourceDescriptor,
): { provider: SourcePlugin; query: IndexQuery } | undefined {
  if (desc.discovery.kind !== "index") return undefined;
  const provider = providers.get(desc.discovery.provider);
  return provider ? { provider, query: desc.discovery.query } : undefined;
}

// --- shared helpers for providers -------------------------------------------

// Read an optional string field off a query, trimmed; undefined when absent or
// not a string.
export function queryString(q: IndexQuery, key: string): string | undefined {
  const v = q[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

// Read an optional list of strings (or a single string) off a query.
export function queryStrings(q: IndexQuery, key: string): string[] {
  const v = q[key];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return [];
}

// Read an optional positive integer off a query.
export function queryInt(q: IndexQuery, key: string): number | undefined {
  const v = q[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

// Local date `days` back from `today` ("2026-09-13" - 2 -> "2026-09-11").
export function daysBefore(today: string, days: number): string {
  return addDays(today, -days);
}
