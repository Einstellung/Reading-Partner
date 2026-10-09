// t.co, X's link shortener: where a link out of a post really goes. Which
// links are worth anything is the link agent's to weigh (info/links/hints.ts).

/**
 * Where a t.co link goes, read off its answer without following it: the 301's
 * Location, or the target t.co writes into the page it serves some clients.
 */
export function tcoTarget(status: number, location: string | null, body: string): string | null {
  if (status >= 300 && status < 400 && location) return location;
  const refresh = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i.exec(body);
  if (refresh) return refresh[1].replace(/&amp;/g, "&");
  const title = /<title>\s*(https?:\/\/[^<\s]+)\s*<\/title>/i.exec(body);
  return title ? title[1].replace(/&amp;/g, "&") : null;
}
