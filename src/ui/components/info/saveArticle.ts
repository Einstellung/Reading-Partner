// Saving a briefing article into reading (docs/21). The mapping from info's
// shapes to reading's SavedArticle lives here rather than in either domain: info
// and reading have no import between them, and ui is the layer allowed to touch
// both.
//
// What is written here is read back by more than the saved list now: from the open
// book's chat the reader can have an article put on the open book's prep list, where
// its `text` becomes the material and its `summaryOnly` becomes the caveat that rides
// with every quote (reading/saved-article-tools.ts). Nothing here proposes a
// topic — that is still a later slice.
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
