// The sources a search answer cites: dedupe, URL cleanup, and putting `[n]`
// markers into the answer text.
//
// Portions adapted from pi-web-search by ttttmr (https://www.npmjs.com/package/pi-web-search),
// MIT License; see LICENSE.pi-web-search in this directory.

export interface Source {
  title: string;
  url: string;
}

/** What one search sub-request produced: the answer with `[n]` markers, and the sources the markers count into. */
export interface SearchOutcome {
  text: string;
  sources: Source[];
}

/** Index of `source` in `sources`, adding it when it is new. Same URL means same source. */
export function pushUniqueSource(sources: Source[], source: Source): number {
  const url = normalizeSearchUrl(source.url);
  const existing = sources.findIndex((s) => s.url === url);
  if (existing >= 0) return existing;
  sources.push({ title: source.title || titleFromUrl(url), url });
  return sources.length - 1;
}

/** Drop the fragment and the tracking parameters, so one page cited twice counts once. */
export function normalizeSearchUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (!/(^|\.)youtube\.com$/i.test(parsed.hostname) && !/(^|\.)youtu\.be$/i.test(parsed.hostname)) {
      for (const name of ["ref", "referral_type", "openLinerExtension", "_clear", "lang", "api-mode"]) {
        parsed.searchParams.delete(name);
      }
      for (const name of [...parsed.searchParams.keys()]) {
        if (name.toLowerCase().startsWith("utm_")) parsed.searchParams.delete(name);
      }
    }
    const query = parsed.searchParams.toString();
    parsed.search = query ? `?${query}` : "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname || url;
  } catch {
    return url;
  }
}

const JUNK_SUFFIXES = [
  ".gz", ".zip", ".tgz", ".tar", ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".webm", ".mp4", ".mp3", ".wav", ".eps", ".sql", ".csv", ".xls", ".xlsx", ".ppt", ".pptx",
];

/** An archive, font or media file: never a page worth listing as a source. */
export function isLikelyJunkSearchUrl(url: string): boolean {
  try {
    const path = decodeURIComponent(new URL(url).pathname).toLowerCase();
    if (JUNK_SUFFIXES.some((suffix) => path.endsWith(suffix))) return true;
    return path === "/%" || path.endsWith("/%");
  } catch {
    return false;
  }
}

/**
 * Insert a `[n]` marker at each citation's end index (OpenAI Responses
 * annotations). Every cited source is listed, with or without an index.
 */
export function applyIndexCitations(
  text: string,
  citations: readonly { endIndex?: number; title: string; url: string }[],
): SearchOutcome {
  const sources: Source[] = [];
  const insertions = citations
    .filter((c) => c.url)
    .map((c) => ({ index: c.endIndex, marker: `[${pushUniqueSource(sources, c) + 1}]` }))
    .filter((i): i is { index: number; marker: string } => i.index !== undefined)
    .map((i) => ({ index: Math.max(0, Math.min(i.index, text.length)), marker: i.marker }))
    .sort((a, b) => b.index - a.index);
  let result = text;
  const seen = new Set<string>();
  for (const { index, marker } of insertions) {
    const key = `${index}:${marker}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result = result.slice(0, index) + marker + result.slice(index);
  }
  return { text: result, sources };
}

/** Sources as the provider listed them, junk dropped. */
export function cleanSources(sources: readonly Source[]): Source[] {
  const out: Source[] = [];
  for (const s of sources) {
    if (!s.url || isLikelyJunkSearchUrl(s.url)) continue;
    pushUniqueSource(out, s);
  }
  return out;
}
