// Saving a briefing article into reading (docs/21, first slice). The mapping
// from info's shapes to reading's SavedArticle lives here rather than in either
// domain: info and reading have no import between them, and ui is the layer
// allowed to touch both.
//
// Store + display only. Nothing here feeds a prompt, packs a fulltext, or
// proposes a topic — those are later slices.
//
// What is kept is whatever the briefing view answered with (docs/36): the day's
// article cache on the machine that collected it, images and all, or the
// published body on a device that only reads, which has none. Both are already
// sanitized, and both know whether the article itself was ever read — so there
// is no guessing left to do here.

import type { ArticleBody } from "../../../info/briefing/reader";
import type { BriefingItemMeta } from "../../../info/briefing/types";
import type { SavedArticleInput } from "../../../reading/saved-articles";

export function toSavedArticleInput(ctx: {
  topicId: string;
  meta: BriefingItemMeta;
  body: ArticleBody;
}): SavedArticleInput {
  return {
    topicId: ctx.topicId,
    url: ctx.meta.url,
    title: ctx.meta.title,
    source: ctx.meta.source,
    sourceName: ctx.meta.sourceName,
    publishedAt: ctx.meta.publishedAt,
    summaryOnly: ctx.body.summaryOnly,
    text: ctx.body.text,
    html: ctx.body.html,
  };
}
