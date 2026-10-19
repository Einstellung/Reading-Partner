// Which arXiv paper a DOI link is (docs/info/88 「看原文」). A post often links a
// paper by its journal DOI (a PRX or Nature DOI) while arXiv and Hugging Face
// found the same paper by its arXiv id; mapped, the link scores as a paper,
// merges with the arXiv candidate and is read through arXiv.
//
// First what the run holds: the DOI an arXiv entry carries (<arxiv:doi>). Then
// a lookup (Semantic Scholar's DOI route in build-live.ts), once per DOI for
// the run: answers, misses and failures are all kept, like fetch-memo.ts keeps
// a page, so nothing is asked twice. A failed or skipped lookup is a miss: the
// link stays a DOI page.

import { normalizeArxivId } from "../sources/plugins/arxiv-client";
import { eventKeyOfUrl } from "../rank/events";
import { normalizeDoi } from "../rank/link-identity";
import type { ArxivFound } from "./rank-pool";

/** Asks a library which arXiv paper a DOI is; null when it knows none. May throw. */
export type DoiLookup = (doi: string, signal: AbortSignal) => Promise<string | null>;

/** The DOIs the run's arXiv and Hugging Face finds carry, to their arXiv ids. */
export function heldDois(found: readonly ArxivFound[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of found) {
    for (const item of f.items) {
      const doi = item.doi ? normalizeDoi(item.doi) : null;
      const id = normalizeArxivId(item.sourceKey ?? item.url);
      if (doi && id && !out.has(doi)) out.set(doi, id);
    }
  }
  return out;
}

/** The DOIs the pool's links name (not arXiv's own, which are keyed as arXiv already), each once, in order. */
export function poolDois(numbered: readonly { links: readonly { url: string }[] }[]): string[] {
  const out = new Set<string>();
  for (const n of numbered) {
    for (const l of n.links) {
      const key = eventKeyOfUrl(l.url);
      if (key?.startsWith("doi:")) out.add(key.slice(4));
    }
  }
  return [...out];
}

export interface DoiArxiv {
  /** The arXiv id a DOI is as far as already settled; null when unknown or none. */
  known(doi: string): string | null;
  /** The arXiv id a DOI is, from what the run holds or the lookup; null when none was found. */
  resolve(doi: string, signal: AbortSignal): Promise<string | null>;
  /** eventKeyOfUrl, with a "doi:" key turned into "arxiv:<id>" when the DOI is known to be that paper. */
  keyOfUrl(url: string): string | null;
}

export function doiArxiv(held: ReadonlyMap<string, string>, lookup: DoiLookup | null): DoiArxiv {
  const asked = new Map<string, Promise<string | null>>();
  const settled = new Map<string, string | null>();
  const known = (doi: string) => held.get(doi) ?? settled.get(doi) ?? null;
  return {
    known,
    resolve(doi, signal) {
      const have = held.get(doi);
      if (have) return Promise.resolve(have);
      if (!lookup) return Promise.resolve(null);
      const hit = asked.get(doi);
      if (hit) return hit;
      const got = lookup(doi, signal).then(
        (raw) => {
          const id = raw ? normalizeArxivId(raw) : null;
          settled.set(doi, id);
          return id;
        },
        (e: unknown) => {
          if (signal.aborted) {
            asked.delete(doi);
            throw e;
          }
          settled.set(doi, null);
          return null;
        },
      );
      // In the map while in flight, so two reads at once share the one request.
      asked.set(doi, got);
      return got;
    },
    keyOfUrl(url) {
      const key = eventKeyOfUrl(url);
      if (!key?.startsWith("doi:")) return key;
      const id = known(key.slice(4));
      return id ? `arxiv:${id}` : key;
    },
  };
}
