// Reading one saved article from a topic (docs/21, store-and-display slice).
// Read-only: no ask, no highlights, no feedback logging — the briefing's
// ArticleView owns all of that and takes info's own item shape, so this is a
// separate screen rather than a reuse. The prose look is shared (proseCss).

import { useMemo } from "react";
import { ARTICLE_PROSE_CLASS, ARTICLE_PROSE_CSS, hideBrokenImage } from "../markdown/proseCss";
import { articleHtmlForWebview } from "../../../platform/app/image-proxy";
import { handleDelegatedLinkClick } from "../../../platform/app/external-link";
import { formatPublishedAt, type SavedArticle } from "../../../reading/saved-articles";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export default function SavedArticleView({
  article,
  onBack,
  backLabel = "Topic",
}: {
  article: SavedArticle;
  onBack: () => void;
  // What Back leads to. The library opens this from a topic; the phone opens it
  // from the list of kept articles, and the button has to say so.
  backLabel?: string;
}) {
  const published = formatPublishedAt(article.publishedAt);
  // The stored HTML keeps the original image URLs; the img: proxy is applied on
  // the way to the webview (docs/pitfall/30), with the saved article's own URL
  // as the Referer the image hosts ask for.
  const body = useMemo(
    () => articleHtmlForWebview(article.html, article.url),
    [article.html, article.url],
  );
  return (
    <div className="absolute inset-0 overflow-y-auto bg-white">
      <style>{ARTICLE_PROSE_CSS}</style>
      <div className="mx-auto flex w-full max-w-[46rem] flex-col px-4 py-5 sm:px-6 sm:py-8">
        <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-[#ececec] bg-white/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-3">
          <Button variant="subtle" size="chip" onClick={onBack}>
            ‹ {backLabel}
          </Button>
          {article.sourceName && (
            <Badge>{article.sourceName}</Badge>
          )}
          {published && <span className="text-[12px] text-[#888]">{published}</span>}
        </div>

        <h1 className="m-0 mb-4 text-[22px] font-semibold leading-tight text-[#141414] sm:mb-6 sm:text-[26px]">
          {article.title}
        </h1>

        {article.summaryOnly && (
          <p className="mb-6 rounded-lg border border-[#efe2c4] bg-[#fdf8ec] px-3 py-2 text-[13px] leading-relaxed text-[#7a6432]">
            The full text of this article was never retrieved. What follows is only a summary.
          </p>
        )}

        {body ? (
          <div
            className={ARTICLE_PROSE_CLASS}
            onErrorCapture={(e) => hideBrokenImage(e.target)}
            // The links in here are injected HTML, so one delegated listener is
            // what sends them to the system browser (docs/pitfall/94).
            onClick={handleDelegatedLinkClick}
            dangerouslySetInnerHTML={{ __html: body }}
          />
        ) : article.text ? (
          <div className={`${ARTICLE_PROSE_CLASS} whitespace-pre-wrap`}>{article.text}</div>
        ) : (
          <p className="my-3.5 text-[15px] leading-relaxed text-[#777]">
            No body was saved with this article.
          </p>
        )}

        <div className="mt-8 border-t border-[#eee] pt-4 text-[12px] text-[#bbb] sm:mt-10">{article.url}</div>
      </div>
    </div>
  );
}
