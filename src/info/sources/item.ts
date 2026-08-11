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
}
