// An index provider (docs/69): the adapter behind one `index` discovery kind.
// arXiv, GitHub, Hugging Face and Semantic Scholar each get one file under
// sources/index/; each answers the same three questions — is this query well formed,
// how would you say it in one line, and what did it yield today — and nothing
// else. Bodies are not its business (fulltext is), nor is ranking (the screen
// and the analyst are). It hands back headlines with the numbers the library
// counted for them, as InfoItem.signals.
//
// Pure module: the registry is a Map, and every provider takes its fetch
// injected, so the whole thing runs under bun with a scripted fetch.
//
// It sits beside the engine rather than in sources/index/ so the adapters can
// import the descriptor and item types from here without the engine importing
// them back: sources -> sources/index is the one direction the layering test
// allows, and the program registers the set (sources/index/all.ts).

import type { FetchFn } from "../extract/http";
import type { SourceDescriptor } from "./descriptor";
import type { InfoItem } from "./item";

export type IndexQuery = Record<string, unknown>;

export interface IndexDeps {
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

export interface IndexProvider {
  // The `provider` string a descriptor names.
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
  discover(desc: SourceDescriptor, query: IndexQuery, deps: IndexDeps): Promise<InfoItem[]>;
}

const providers = new Map<string, IndexProvider>();

// Providers register themselves from sources/index/all.ts, which the program
// imports once at startup; a test registers the one it exercises.
export function registerIndexProvider(p: IndexProvider): void {
  providers.set(p.id, p);
}

export function indexProvider(id: string): IndexProvider | undefined {
  return providers.get(id);
}

export function indexProviderIds(): string[] {
  return [...providers.keys()].sort();
}

// Test seam: forget every registration.
export function resetIndexProvidersForTests(): void {
  providers.clear();
}

// A descriptor's provider and query, when it is an index source with a
// registered provider; undefined otherwise. The one lookup the engine, the
// probe and the sources page share.
export function indexOf(
  desc: SourceDescriptor,
): { provider: IndexProvider; query: IndexQuery } | undefined {
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
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
