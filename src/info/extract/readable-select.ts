// The readable-extraction contract, and choosing between two extractions
// (docs/17): Readability is the primary, defuddle the fallback for pages it
// under-extracts. Both live here because both are pure (no DOM) — readable.ts
// runs the two DOM extractors and hands their results here, and everything that
// only injects an extractor (the source engine, the tools) depends on this
// module instead of on the DOM half.

export interface Extraction {
  title: string;
  contentHtml: string;
  textContent: string;
}

// A readable-article extraction: (page HTML, its URL) -> body. Wired to
// Readability/defuddle in readable.ts; injected into the source engine so the
// collect logic stays DOM-free and testable.
export type ExtractReadable = (html: string, url: string) => Extraction | null;

// Below this many characters of body text, the primary extraction is treated as
// having failed to get the real article, and the fallback is consulted.
export const MIN_BODY_CHARS = 500;

// Pick the better of a primary (Readability) and a fallback (defuddle). The
// primary wins when it cleared the length bar; otherwise the longer body wins,
// so defuddle only overrides when it genuinely got more. Either may be null.
export function pickExtraction(
  primary: Extraction | null,
  fallback: Extraction | null,
  opts: { minChars?: number } = {},
): Extraction | null {
  const min = opts.minChars ?? MIN_BODY_CHARS;
  const pLen = primary?.textContent.trim().length ?? 0;
  const fLen = fallback?.textContent.trim().length ?? 0;
  if (primary && pLen >= min) return primary;
  if (!primary) return fallback;
  if (!fallback) return primary;
  return fLen > pLen ? fallback : primary;
}
