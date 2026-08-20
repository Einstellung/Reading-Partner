// The kept articles, on the phone (docs/22). A list of what the reader saved out
// of a briefing; tapping one opens SavedArticleView. Read-only, like the records
// themselves (docs/21): no removal here — that lives in the library, next to the
// topic the article was filed under.

import { formatPublishedAt, type SavedArticle } from "../../../reading/saved-articles";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export default function SavedList({
  articles,
  onOpen,
  onBack,
}: {
  articles: SavedArticle[];
  onOpen: (article: SavedArticle) => void;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-5">
        <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 border-b border-border-subtle bg-background/85 px-4 py-3 backdrop-blur">
          <Button variant="subtle" size="chip" onClick={onBack}>
            ‹ Today
          </Button>
          <span className="text-[13px] text-[#999]">
            {articles.length} saved article{articles.length === 1 ? "" : "s"}
          </span>
        </div>

        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {articles.map((a) => {
            const published = formatPublishedAt(a.publishedAt);
            return (
              <li key={a.id}>
                <button
                  className="flex w-full flex-col items-start gap-1.5 rounded-xl border border-border-soft bg-card p-4 text-left coarse:min-h-[44px] hover:border-[#d3ccef]"
                  onClick={() => onOpen(a)}
                >
                  <span className="text-[15px] font-medium leading-snug text-[#1b1b1b]">{a.title}</span>
                  <span className="flex items-center gap-2">
                    {a.sourceName && (
                      <Badge>{a.sourceName}</Badge>
                    )}
                    {published && <span className="text-[12px] text-[#888]">{published}</span>}
                    {a.summaryOnly && <span className="text-[12px] text-[#b08a3a]">summary only</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
