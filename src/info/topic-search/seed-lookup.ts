// Finding a paper the reader named while drafting a study (docs/info/91 起草与种子).
// The reader says a title, a short name or authors and a year; the program asks
// the libraries and hands back at most three candidates, every field of them
// the library's. The companion never writes a title or an id itself.
//
// One normal request per library, no loops: an arXiv id in the name is looked
// up directly; otherwise arXiv's search and Hugging Face's paper search are
// asked side by side, and Semantic Scholar's search only when neither has a
// paper whose title matches the name. The requests go through the host gate
// the runs use (live.ts), so its spacing and cooldowns hold: a library cooling
// down refuses at once, and that is reported, not waited out.
// Pure: the searches are injected.

import { normalizeArxivId } from "../sources/plugins/arxiv-client";
import { normalizeTitle } from "../sources/plugins/match";
import { isHostCoolingDown } from "../../platform/http/host-gate";
import { normalizeDoi } from "../rank/link-identity";
import type { StudySeedCandidate } from "./cards";

/** A paper as any library gives it, cut to what a seed needs. */
export interface SeedPaper {
  arxivId: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  // A day ("2024-03-01") or a year, "" when the library gave none.
  date: string;
}

/** A search item (arXiv's or Hugging Face's, whose key is the arXiv id) as a seed paper. */
export function itemPaper(item: { sourceKey?: string; doi?: string; title: string; authors?: string[]; publishedAt: string }): SeedPaper {
  return {
    arxivId: item.sourceKey ? normalizeArxivId(item.sourceKey) : null,
    doi: item.doi ?? null,
    title: item.title,
    authors: item.authors ?? [],
    date: item.publishedAt.slice(0, 10),
  };
}

export interface SeedSearches {
  byArxivId(id: string): Promise<SeedPaper | null>;
  arxiv(text: string): Promise<SeedPaper[]>;
  huggingface(text: string): Promise<SeedPaper[]>;
  s2(text: string): Promise<SeedPaper[]>;
}

export interface SeedLookup {
  candidates: StudySeedCandidate[];
  /** Libraries that did not answer, with why (a cooldown names its minutes). */
  misses: { source: string; why: string; cooling: boolean }[];
}

/** Candidates one name gets at most. */
export const SEED_CANDIDATES = 3;

const ARXIV_ID = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?/i;

/** The arXiv id a name holds (a bare id, "arXiv:2401.12345", an abs or pdf link), or null. */
export function arxivIdIn(name: string): string | null {
  const whole = normalizeArxivId(name);
  if (whole) return whole;
  const m = ARXIV_ID.exec(name);
  return m ? normalizeArxivId(m[1]) : null;
}

/** How closely a title matches the name: 2 equal, 1 one holds the other, 0 neither. */
export function titleMatch(title: string, name: string): number {
  const got = normalizeTitle(title);
  const want = normalizeTitle(name);
  if (!got || !want) return 0;
  if (got === want) return 2;
  // A short name ("KeplerAgent") is held by its title; a single common word is not a match.
  if (want.length >= 6 && (got.includes(want) || want.includes(got))) return 1;
  return 0;
}

function keyOf(p: SeedPaper): string | null {
  if (p.arxivId) return `arxiv:${p.arxivId}`;
  const doi = p.doi ? normalizeDoi(p.doi) : null;
  return doi ? `doi:${doi}` : null;
}

/** The card's row for a paper; null for one with neither an arXiv id nor a DOI (no key to pin it by). */
export function seedCandidate(p: SeedPaper): StudySeedCandidate | null {
  const key = keyOf(p);
  if (!key || !p.title.trim()) return null;
  const arxiv = key.startsWith("arxiv:");
  const id = key.slice(key.indexOf(":") + 1);
  return {
    key,
    handle: arxiv ? `arXiv ${id}` : `DOI ${id}`,
    title: p.title.replace(/\s+/g, " ").trim(),
    authors: p.authors,
    date: p.date,
    url: arxiv ? `https://arxiv.org/abs/${id}` : `https://doi.org/${id}`,
    verdict: null,
  };
}

// Two lists in relevance order, alternated, one entry per key: the first seen keeps its fields.
function interleave(lists: readonly SeedPaper[][]): SeedPaper[] {
  const out: SeedPaper[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const p = list[i];
      const key = p ? keyOf(p) : null;
      if (!p || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

// Matches first (equal before held), then the rest in relevance order.
function ranked(papers: readonly SeedPaper[], name: string): SeedPaper[] {
  return papers
    .map((p, i) => ({ p, i, m: titleMatch(p.title, name) }))
    .sort((a, b) => b.m - a.m || a.i - b.i)
    .map((x) => x.p);
}

function missOf(source: string, e: unknown) {
  return { source, why: e instanceof Error ? e.message : String(e), cooling: isHostCoolingDown(e) };
}

/** The candidates for one name, at most three, and the libraries that did not answer. */
export async function findSeedPaper(name: string, searches: SeedSearches): Promise<SeedLookup> {
  const misses: SeedLookup["misses"] = [];
  const finish = (papers: readonly SeedPaper[]): SeedLookup => ({
    candidates: papers
      .map(seedCandidate)
      .filter((c): c is StudySeedCandidate => c !== null)
      .slice(0, SEED_CANDIDATES),
    misses,
  });
  const id = arxivIdIn(name);
  if (id) {
    try {
      const paper = await searches.byArxivId(id);
      return finish(paper ? [paper] : []);
    } catch (e) {
      misses.push(missOf("arXiv", e));
      return finish([]);
    }
  }
  const [arxiv, hf] = await Promise.allSettled([searches.arxiv(name), searches.huggingface(name)]);
  if (arxiv.status === "rejected") misses.push(missOf("arXiv", arxiv.reason));
  if (hf.status === "rejected") misses.push(missOf("Hugging Face", hf.reason));
  const found = interleave([arxiv.status === "fulfilled" ? arxiv.value : [], hf.status === "fulfilled" ? hf.value : []]);
  if (found.some((p) => titleMatch(p.title, name) > 0)) return finish(ranked(found, name));
  // Neither has it by title: Semantic Scholar knows journal papers arXiv does not.
  let s2: SeedPaper[] = [];
  try {
    s2 = await searches.s2(name);
  } catch (e) {
    misses.push(missOf("Semantic Scholar", e));
  }
  return finish(ranked(interleave([s2.filter((p) => titleMatch(p.title, name) > 0), found, s2]), name));
}
