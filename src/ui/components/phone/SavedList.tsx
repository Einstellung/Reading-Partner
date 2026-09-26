// The kept articles, on the phone (docs/22). A list of what the reader saved out
// of a briefing; tapping one opens SavedArticleView. A hold on one offers to take
// it out of Saved (hold-menu.ts), and it leaves where it stands.

import { useRef } from "react";
import type { SavedArticle } from "../../../reading/saved/saved-articles";
import ConfirmDestructiveDialog from "../common/ConfirmDestructiveDialog";
import { cn } from "../lib/utils";
import { savedArticleLine } from "../shelf/article-row";
import { Button } from "../ui/button";
import HoldMenu, { HOLDABLE_ROW } from "./HoldMenu";
import { visibleItems } from "./hold-menu";
import { useHoldDelete, type NoticeKind } from "./use-hold-delete";

export default function SavedList({
  articles: all,
  onOpen,
  onBack,
  onChanged,
  onNotice,
}: {
  articles: SavedArticle[];
  onOpen: (article: SavedArticle) => void;
  onBack: () => void;
  // One was taken out (or failed to be): reread the list.
  onChanged: () => Promise<void>;
  onNotice: (kind: NoticeKind, line: string) => void;
}) {
  const surface = useRef<HTMLDivElement | null>(null);
  const hold = useHoldDelete({
    host: surface,
    subjectOf: (key) => {
      const a = all.find((x) => x.id === key);
      return a ? { kind: "saved", id: a.id, title: a.title } : null;
    },
    presentKeys: all.map((a) => a.id),
    onNotice,
    onChanged,
  });
  const articles = visibleItems(all, hold.hidden, (a) => a.id);

  return (
    <div
      ref={surface}
      className="absolute inset-0 overflow-y-auto bg-background select-none [-webkit-touch-callout:none]"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-5">
        <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 border-b border-border-subtle bg-background/85 px-4 py-3 backdrop-blur">
          <Button variant="subtle" size="chip" onClick={onBack}>
            ‹ Today
          </Button>
          <span className="text-[13px] text-faint-foreground">
            {articles.length} saved article{articles.length === 1 ? "" : "s"}
          </span>
        </div>

        {articles.length === 0 && (
          <p className="m-0 text-[14px] text-faint-foreground">Nothing kept yet.</p>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {articles.map((a) => {
            const line = savedArticleLine(a);
            return (
              <li key={a.id}>
                <button
                  data-hold={a.id}
                  className={cn(
                    "flex w-full flex-col items-start gap-1.5 rounded-xl border border-border-soft bg-card p-4 text-left coarse:min-h-[44px] hover:border-secondary-border",
                    HOLDABLE_ROW,
                  )}
                  onClick={() => onOpen(a)}
                >
                  <span className="text-[15px] font-medium leading-snug text-foreground">{a.title}</span>
                  <span className="flex items-center gap-2">
                    {line && <span className="text-[12px] text-faint-foreground">{line}</span>}
                    {a.summaryOnly && <span className="text-[12px] text-[#b08a3a]">summary only</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <HoldMenu {...hold.menu} />
      {hold.ask && (
        <ConfirmDestructiveDialog
          title={hold.ask.words.title}
          description={hold.ask.words.description}
          actionLabel={hold.ask.words.action}
          open
          onOpenChange={(open) => !open && hold.endAsk()}
          onConfirm={hold.confirm}
        />
      )}
    </div>
  );
}
