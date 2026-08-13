// The article reading view (docs/16): a clean typographic page for one briefing
// item's sanitized HTML, prose width, images through the img: proxy carrying
// this article's URL as their Referer. Opens fast from cache.
// No highlights/annotations in v1. The host logs "opened" feedback on mount and
// owns the back / ask actions. The body is injected HTML that utilities can't
// reach, so a scoped <style> establishes the prose look (proseCss).

import { useMemo } from "react";
import { IconCheck, IconFileInto, IconSparkle } from "../base/icons";
import { ARTICLE_PROSE_CLASS, ARTICLE_PROSE_CSS, hideBrokenImage } from "../common/proseCss";
import { articleHtmlForWebview } from "../../../platform/app/image-proxy";
import { handleDelegatedLinkClick, openExternal } from "../../../platform/app/external-link";
import type { ArticleState } from "../../../info/briefing/reader";
import type { BriefingItemMeta } from "../../../info/briefing/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

// What to say when there is no body. Four cases and four different sentences,
// because they call for four different things from the reader (docs/36): wait,
// don't wait, open it yourself, or nothing at all.
function noBodyLine(state: ArticleState): string {
  switch (state.kind) {
    case "pending":
      return "The text of this article is still on its way from the computer that collected it.";
    case "filtered":
      return `Filtered out of today's briefing as ${state.category}, so the full text was never fetched.`;
    case "summaryOnly":
      return "The full text of this article could not be retrieved. It may be summarized in the briefing.";
    default:
      return "This article is not in the briefing on this device.";
  }
}

export function ArticleView({
  meta,
  state,
  saved,
  onBack,
  onAsk,
  onSave,
}: {
  meta: BriefingItemMeta;
  // What can be shown for this item, or null while it is being read.
  state: ArticleState | null;
  // Whether this article is already filed under a topic.
  saved: boolean;
  onBack: () => void;
  onAsk: () => void;
  onSave: () => void;
}) {
  const html = state?.kind === "body" ? state.body.html : null;
  // External images are pointed at the img: proxy here rather than in what the
  // host holds, so the HTML that gets kept keeps its original URLs. meta.url is
  // the article URL the briefing recorded — the proxy sends it as Referer, and
  // it has to come from here rather than from anything inside the body.
  const body = useMemo(
    () => (html ? articleHtmlForWebview(html, meta.url) : null),
    [html, meta.url],
  );
  // Keep and the article chat are for an article there is text of. Without one
  // the chat would carry a headline and nothing else, and keeping it would write
  // an empty snapshot over the full-text record another device saved under the
  // same id (docs/36).
  const hasBody = state?.kind === "body";
  return (
    <div className="h-full overflow-y-auto bg-white">
      <style>{ARTICLE_PROSE_CSS}</style>
      <div className="mx-auto flex w-full max-w-[46rem] flex-col px-4 py-5 sm:px-6 sm:py-8">
        <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-[#ececec] bg-white/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-3">
          <Button variant="subtle" size="chip" onClick={onBack}>
            ‹ Briefing
          </Button>
          {meta.sourceName && (
            <Badge>{meta.sourceName}</Badge>
          )}
          <span className="flex-1" />
          {hasBody && (
            <>
              <Button
                variant="subtle"
                size="chip"
                // `disabled` here means "already kept" — a state, not an
                // unavailable control — so the variant's dimming is cancelled.
                className={
                  saved
                    ? "border-[#cfe3d2] bg-[#eff6f0] text-[#3e6b48] disabled:opacity-100"
                    : undefined
                }
                onClick={onSave}
                disabled={saved}
                title={saved ? "Already in Brief" : "Keep this in my reading context"}
              >
                {saved ? <IconCheck size={14} /> : <IconFileInto size={14} />}
                {saved ? "Kept" : "Keep"}
              </Button>
              <Button variant="secondary" size="chip" onClick={onAsk} title="Ask about this article">
                <IconSparkle size={14} /> Ask
              </Button>
            </>
          )}
          {state && !hasBody && (
            <Button
              variant="subtle"
              size="chip"
              onClick={() => openExternal(meta.url)}
              title="Open the article on its own site"
            >
              Open in browser
            </Button>
          )}
        </div>

        <h1 className="m-0 mb-4 text-[22px] font-semibold leading-tight text-[#141414] sm:mb-6 sm:text-[26px]">{meta.title}</h1>

        {body ? (
          <div
            className={ARTICLE_PROSE_CLASS}
            onErrorCapture={(e) => hideBrokenImage(e.target)}
            // The links in here are injected HTML, so one delegated listener is
            // what sends them to the system browser (docs/pitfall/94).
            onClick={handleDelegatedLinkClick}
            dangerouslySetInnerHTML={{ __html: body }}
          />
        ) : (
          state && (
            <p className="my-3.5 text-[15px] leading-relaxed text-[#777]">{noBodyLine(state)}</p>
          )
        )}

        <div className="mt-8 border-t border-[#eee] pt-4 text-[12px] text-[#bbb] sm:mt-10">{meta.url}</div>
      </div>
    </div>
  );
}
