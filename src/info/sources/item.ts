// One item as a source yields it (docs/16, docs/17): what the generic engine
// produces for every discovery pipe, before any triage has looked at it. It lives
// here rather than with the briefing model because the engine builds it and the
// briefing only consumes it — the daily briefing is one reader of a source's
// items, not their owner.

export interface InfoItem {
  // Stable hash of source + slug/url, so the same article keeps its id across
  // refetches and the feedback log can reference it (see itemId in extract/id).
  id: string;
  // The source id (descriptor id, docs/17) — no longer a closed union, since
  // sources are user data now.
  source: string;
  // The source's display name (descriptor.name), denormalized so triage prompts
  // and briefing cards render a label without the descriptor at hand.
  sourceName: string;
  // The source's own key for the article — a feed link, a list-page URL, the
  // slug an internal API addresses it by — as discovery received it, before it
  // was hashed into `id`. The funnel (docs/35) fetches bodies in a step of its
  // own, long after discovery has been forgotten, and a detail-endpoint source
  // cannot be asked for a body without the key it knows the article by.
  sourceKey?: string;
  title: string;
  url: string;
  // ISO-ish string as the feed/API supplies it; may be "" if none was given.
  publishedAt: string;
  // Short list-view summary (jiqizhixin ships one; qbitai's is usually empty).
  summary?: string;
  // Full readable article HTML, sanitized at render time. Cached separately from
  // the briefing (per day) so the article view and chat can read it.
  contentHtml?: string;
  // Plain text of the article, fed to triage (trimmed) and to the chat context.
  textContent?: string;
  // True when only a summary/headline was obtained (a discovery-layer-only
  // source, a fetch that failed, or a paywall-truncated feed body). Triage marks
  // these so the model does not pretend to have read the full text (docs/17).
  summaryOnly?: boolean;
  // What the index that yielded this item counted for it (docs/69): attention
  // and citation numbers, present only when an index source reported them. The
  // cable carries them on, so the screen and the analyst read the same numbers.
  signals?: ItemSignals;
}

// The numbers an index reports for an item. Every key is optional: a provider
// fills the ones its library has, and the reader of a signals bag must not
// assume any of them. Plain numbers, no derived scores — deciding what "hot"
// means is the analyst's call, not the adapter's.
export interface ItemSignals {
  // GitHub.
  stars?: number;
  // Stars gained in the period the query asked about (trending).
  starsPeriod?: number;
  forks?: number;
  contributors?: number;
  // OpenDigger's OpenRank and activity for the latest month, when fetched.
  openrank?: number;
  activity?: number;
  // Hugging Face.
  upvotes?: number;
  likes?: number;
  downloads?: number;
  comments?: number;
  // Semantic Scholar.
  citations?: number;
  influentialCitations?: number;
  // Free-form labels the provider wants the screen to see: "code", "weights",
  // "dataset", a venue, a license. Short, a handful at most.
  tags?: string[];
  // When the thing itself was created (a repo, a model), ISO-ish, if it differs
  // from publishedAt (which for an index is when it surfaced in the query).
  createdAt?: string;
}

// One line of the signals for a prompt: "★ 1240 (+310) · ↑ 87 · cites 12 ·
// code, weights". Empty string when there is nothing to say, so a caller can
// append it unconditionally.
export function formatSignals(s: ItemSignals | undefined): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.stars !== undefined) {
    parts.push(`★ ${s.stars}${s.starsPeriod !== undefined ? ` (+${s.starsPeriod})` : ""}`);
  } else if (s.starsPeriod !== undefined) {
    parts.push(`★ +${s.starsPeriod}`);
  }
  if (s.forks !== undefined) parts.push(`forks ${s.forks}`);
  if (s.openrank !== undefined) parts.push(`openrank ${s.openrank}`);
  if (s.upvotes !== undefined) parts.push(`↑ ${s.upvotes}`);
  if (s.likes !== undefined) parts.push(`likes ${s.likes}`);
  if (s.downloads !== undefined) parts.push(`downloads ${s.downloads}`);
  if (s.citations !== undefined) {
    parts.push(
      `cites ${s.citations}${s.influentialCitations !== undefined ? ` (${s.influentialCitations} influential)` : ""}`,
    );
  }
  if (s.tags && s.tags.length) parts.push(s.tags.join(", "));
  return parts.join(" · ");
}
