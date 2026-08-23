// `Retry-After` read once, for every caller that sends HTTP requests. The retry
// loops stay apart — info's briefing fetch and the paper clients differ in
// backoff, per-host spacing and what a terminal 429 means — but the header is
// defined by the RFC and not by the caller, so parsing it is one function.
// Reading it privately is how reading/papers came to Number() the value, which
// is NaN for the date form and unbounded for "999999".

// The longest a retry will wait, however long the server asks for. A source that
// answers 429 with "come back in an hour" is asking for more than the run
// waiting on it has: past the cap the attempt is given up and the caller
// degrades that one item, which is what any other non-OK status does anyway.
// The caller applies it rather than the parser, because each loop decides on its
// own whether its own backoff is capped too.
export const MAX_RETRY_WAIT_MS = 30_000;

// `Retry-After` in either form the RFC allows: a delay in seconds, or an HTTP
// date. Null when the header is absent or is neither, so the caller falls back
// to its own backoff rather than treating a header it cannot read as "retry
// now". A date already in the past is no wait at all.
export function retryAfterMs(header: string | null | undefined, now: number): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // Every form of HTTP date carries letters (a month name, a weekday, "GMT"),
  // so a value with none is a broken delay and not a date. Without this,
  // Date.parse reads "-5" as a year and the header becomes "retry now".
  if (!/[a-z]/i.test(value)) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}
