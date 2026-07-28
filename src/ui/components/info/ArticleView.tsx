// The article reading view (docs/16): a clean typographic page for one briefing
// item's sanitized HTML, prose width, images no-referrer. Opens fast from cache.
// No highlights/annotations in v1. The host logs "opened" feedback on mount and
// owns the back / ask actions. Because preflight is off and the body is injected
// HTML (utilities can't reach it), a scoped <style> establishes the prose look.

import { IconCheck, IconFileInto, IconSparkle } from "../common/icons";
import { ARTICLE_PROSE_CLASS, ARTICLE_PROSE_CSS } from "../common/proseCss";
import type { BriefingItemMeta } from "../../../info/briefing/types";

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
  return (
    <div className="h-full overflow-y-auto bg-white">
      <style>{ARTICLE_PROSE_CSS}</style>
      <div className="mx-auto flex w-full max-w-[46rem] flex-col px-6 py-8">
        <div className="sticky top-0 z-10 -mx-6 mb-6 flex items-center gap-3 border-b border-[#ececec] bg-white/85 px-6 py-3 backdrop-blur">
          <button
            className="rounded-lg border border-[#dcdcdc] px-2.5 py-1 text-[13px] text-[#555] hover:bg-[#f4f4f4]"
            onClick={onBack}
          >
            ‹ Briefing
          </button>
          {meta.sourceName && (
            <span className="rounded-full bg-[#f0eefb] px-2 py-0.5 text-[11px] font-medium text-[#6d5ae0]">
              {meta.sourceName}
            </span>
          )}
          <span className="flex-1" />
          <button
            className={
              saved
                ? "flex items-center gap-1.5 rounded-lg border border-[#cfe3d2] bg-[#eff6f0] px-2.5 py-1 text-[13px] text-[#3e6b48]"
                : "flex items-center gap-1.5 rounded-lg border border-[#dcdcdc] px-2.5 py-1 text-[13px] text-[#555] hover:bg-[#f4f4f4]"
            }
            onClick={onSave}
            disabled={saved}
            title={saved ? "Already in Brief" : "Keep this in my reading context"}
          >
            {saved ? <IconCheck size={14} /> : <IconFileInto size={14} />}
            {saved ? "Kept" : "Keep"}
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-[#c9c2e8] bg-[#efecfb] px-2.5 py-1 text-[13px] text-[#4a3a9e] hover:bg-[#e7e3f7]"
            onClick={onAsk}
            title="Ask about this article"
          >
            <IconSparkle size={14} /> Ask
          </button>
        </div>

        <h1 className="m-0 mb-6 text-[26px] font-semibold leading-tight text-[#141414]">{meta.title}</h1>

        {contentHtml ? (
          <div className={ARTICLE_PROSE_CLASS} dangerouslySetInnerHTML={{ __html: contentHtml }} />
        ) : (
          <p className="text-[15px] leading-relaxed text-[#777]">
            The full text of this article could not be retrieved. It may be summarized in the
            briefing above.
          </p>
        )}

        <div className="mt-10 border-t border-[#eee] pt-4 text-[12px] text-[#bbb]">{meta.url}</div>
      </div>
    </div>
  );
}
