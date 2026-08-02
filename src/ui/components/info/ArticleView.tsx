// The article reading view (docs/16): a clean typographic page for one briefing
// item's sanitized HTML, prose width, images no-referrer. Opens fast from cache.
// No highlights/annotations in v1. The host logs "opened" feedback on mount and
// owns the back / ask actions. The body is injected HTML that utilities can't
// reach, so a scoped <style> establishes the prose look (proseCss).

import { useMemo } from "react";
import { IconCheck, IconFileInto, IconSparkle } from "../common/icons";
import { ARTICLE_PROSE_CLASS, ARTICLE_PROSE_CSS, hideBrokenImage } from "../common/proseCss";
import { articleHtmlForWebview } from "../../../platform/app/image-proxy";
import type { BriefingItemMeta } from "../../../info/briefing/types";
import { Button } from "../ui/button";

export function ArticleView({
  meta,
  contentHtml,
  saved,
  onBack,
  onAsk,
  onSave,
}: {
  meta: BriefingItemMeta;
  contentHtml: string | null;
  // Whether this article is already filed under a topic.
  saved: boolean;
  onBack: () => void;
  onAsk: () => void;
  onSave: () => void;
}) {
  // External images are pointed at the img: proxy here rather than in what the
  // host holds, so the HTML that gets kept keeps its original URLs.
  const body = useMemo(
    () => (contentHtml === null ? null : articleHtmlForWebview(contentHtml)),
    [contentHtml],
  );
  return (
    <div className="h-full overflow-y-auto bg-white">
      <style>{ARTICLE_PROSE_CSS}</style>
      <div className="mx-auto flex w-full max-w-[46rem] flex-col px-4 py-5 sm:px-6 sm:py-8">
        <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 border-b border-[#ececec] bg-white/85 px-4 py-2 backdrop-blur sm:-mx-6 sm:mb-6 sm:gap-3 sm:px-6 sm:py-3">
          <Button variant="subtle" size="chip" onClick={onBack}>
            ‹ Briefing
          </Button>
          {meta.sourceName && (
            <span className="rounded-full bg-[#f0eefb] px-2 py-0.5 text-[11px] font-medium text-primary">
              {meta.sourceName}
            </span>
          )}
          <span className="flex-1" />
          <Button
            variant="subtle"
            size="chip"
            // `disabled` here means "already kept" — a state, not an unavailable
            // control — so the variant's dimming is cancelled.
            className={
              saved ? "border-[#cfe3d2] bg-[#eff6f0] text-[#3e6b48] disabled:opacity-100" : undefined
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
        </div>

        <h1 className="m-0 mb-4 text-[22px] font-semibold leading-tight text-[#141414] sm:mb-6 sm:text-[26px]">{meta.title}</h1>

        {body ? (
          <div
            className={ARTICLE_PROSE_CLASS}
            onErrorCapture={(e) => hideBrokenImage(e.target)}
            dangerouslySetInnerHTML={{ __html: body }}
          />
        ) : (
          <p className="my-3.5 text-[15px] leading-relaxed text-[#777]">
            The full text of this article could not be retrieved. It may be summarized in the
            briefing above.
          </p>
        )}

        <div className="mt-8 border-t border-[#eee] pt-4 text-[12px] text-[#bbb] sm:mt-10">{meta.url}</div>
      </div>
    </div>
  );
}
