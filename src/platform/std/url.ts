// URL helpers shared across domains. Pure, and this file imports nothing.

/** The site a URL belongs to, for a label that would otherwise be a line of
 * query string. The URL itself when it will not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
