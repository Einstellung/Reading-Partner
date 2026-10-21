// The libraries the seed lookup asks (docs/info/91 起草与种子): find_seed_paper
// at the door, and a study's build adding a seed no read found.

import { fetchWithRetry, interactiveRetry } from "../../platform/http/throttled-fetch";
import { infoFetch } from "../../workshop/extract/http";
import { arxivPlugin } from "../sources/plugins/arxiv";
import { arxivIdUrl, parseArxivAtom } from "../sources/plugins/arxiv-client";
import { huggingfacePlugin } from "../sources/plugins/huggingface";
import { searchS2Topic } from "../sources/plugins/s2-client";
import { itemPaper, type SeedSearches } from "./seed-lookup";
import { localDay } from "./windows";

// Candidates one library is asked for when looking a seed up.
const SEED_LIMIT = 5;

const pluginDeps = () => ({ fetchFn: infoFetch, now: () => Date.now(), today: () => localDay(Date.now()) });

/**
 * The libraries find_seed_paper asks, one request each, through the host gate
 * the runs use (infoFetch): its spacing holds, and a library cooling down after
 * a rate limit refuses at once rather than being waited out.
 */
export const liveSeedSearches: SeedSearches = {
  byArxivId: async (id) => {
    const res = await fetchWithRetry(arxivIdUrl(id), undefined, interactiveRetry(infoFetch));
    if (!res.ok) throw new Error(`arXiv answered HTTP ${res.status}`);
    const entry = parseArxivAtom(await res.text()).find((e) => e.id === id && e.title !== "");
    return entry
      ? { arxivId: entry.id, doi: entry.doi ?? null, title: entry.title, authors: entry.authors, date: entry.published.slice(0, 10) }
      : null;
  },
  arxiv: async (text) => (await arxivPlugin.search!(text, { limit: SEED_LIMIT }, pluginDeps())).map(itemPaper),
  huggingface: async (text) => (await huggingfacePlugin.search!(text, { limit: SEED_LIMIT }, pluginDeps())).map(itemPaper),
  s2: async (text) =>
    (await searchS2Topic(text, { limit: SEED_LIMIT }, infoFetch)).map((h) => ({
      arxivId: h.arxivId,
      doi: h.doi,
      title: h.title,
      authors: h.authors,
      date: h.publicationDate ?? (h.year !== null ? String(h.year) : ""),
    })),
};
