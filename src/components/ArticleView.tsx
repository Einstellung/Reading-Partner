// The article reading view (docs/16): a clean typographic page for one briefing
// item's sanitized HTML, prose width, images no-referrer. Opens fast from cache.
// No highlights/annotations in v1. The host logs "opened" feedback on mount and
// owns the back / ask actions. Because preflight is off and the body is injected
// HTML (utilities can't reach it), a scoped <style> establishes the prose look.

import { IconSparkle } from "./icons";
import type { BriefingItemMeta, InfoSource } from "../info/types";

const SOURCE_TAG: Record<InfoSource, string> = {
  jiqizhixin: "机器之心",
  qbitai: "量子位",
};

const PROSE_CSS = `
.info-article-body { color: #222; font-size: 17px; line-height: 1.75; }
.info-article-body p { margin: 0 0 1.1em; }
.info-article-body h1, .info-article-body h2, .info-article-body h3 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 600; color: #111; }
.info-article-body h1 { font-size: 1.5em; }
.info-article-body h2 { font-size: 1.3em; }
.info-article-body h3 { font-size: 1.12em; }
.info-article-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; display: block; }
/* External images are blocked by the webview's CSP/COEP (docs/pitfall/30); the
   host inlines them as data: URLs progressively. Hide any still-external img so
   it shows no broken-image icon until its data: URL swaps in. */
.info-article-body img[src^="http"] { display: none; }
.info-article-body figure { margin: 1.2em 0; }
.info-article-body figcaption { font-size: 0.85em; color: #888; text-align: center; margin-top: 0.5em; }
.info-article-body a { color: #6d5ae0; text-decoration: underline; text-underline-offset: 2px; }
.info-article-body ul, .info-article-body ol { margin: 0 0 1.1em; padding-left: 1.4em; }
.info-article-body li { margin: 0.3em 0; }
.info-article-body blockquote { margin: 1.1em 0; padding-left: 1em; border-left: 3px solid #e0dcf3; color: #555; }
.info-article-body pre { overflow-x: auto; background: #f6f6f8; padding: 0.9em; border-radius: 8px; font-size: 0.9em; }
.info-article-body code { font-family: ui-monospace, monospace; font-size: 0.92em; }
.info-article-body table { display: block; overflow-x: auto; border-collapse: collapse; }
.info-article-body td, .info-article-body th { border: 1px solid #e6e6e6; padding: 0.4em 0.7em; }
`;

export function ArticleView({
  meta,
  contentHtml,
  onBack,
  onAsk,
}: {
  meta: BriefingItemMeta;
  contentHtml: string | null;
  onBack: () => void;
  onAsk: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <style>{PROSE_CSS}</style>
      <div className="mx-auto flex w-full max-w-[46rem] flex-col px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            className="rounded-lg border border-[#dcdcdc] px-2.5 py-1 text-[13px] text-[#555] hover:bg-[#f4f4f4]"
            onClick={onBack}
          >
            ‹ Briefing
          </button>
          <span className="rounded-full bg-[#f0eefb] px-2 py-0.5 text-[11px] font-medium text-[#6d5ae0]">
            {SOURCE_TAG[meta.source]}
          </span>
          <span className="flex-1" />
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
          <div className="info-article-body" dangerouslySetInnerHTML={{ __html: contentHtml }} />
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
