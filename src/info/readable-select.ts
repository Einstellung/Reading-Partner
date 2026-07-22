// Choosing between two readable extractions (docs/17): Readability is the
// primary, defuddle the fallback for pages it under-extracts. The decision is
// pure (no DOM) so it is unit-tested; readable.ts runs the two DOM extractors
// and hands their results here.

export interface Extraction {
  title: string;
  contentHtml: string;
  textContent: string;
}

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
