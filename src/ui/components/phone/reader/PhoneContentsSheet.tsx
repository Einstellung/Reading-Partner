// The phone's one sidebar, as a sheet off the bottom edge (docs/82): three tabs
// on one sheet of fixed height, so switching tabs never moves its edge.
// Outline is the book's table of contents, Marks every highlight and underline
// in reading order, Prep what the AI prepared about the book on the iPad or the
// desktop. The sheet reopens on the tab last looked at; the reader holds that.
//
// A Radix dialog through ui/dialog.tsx, so it takes the app's layer, its safe
// area and its layer registration without restating any of them (docs/30).
//
// Outline entries carry page numbers rather than hrefs — the outline is read
// off the pagination table (reading/epub/fulltext.ts outlineFor), whose
// coordinate is the position block — so a tap is goToChapter: the page, with
// the view left to find the heading on it.

import { useT } from "../../../../i18n";
import type { OutlineItem } from "../../../../fulltext/types";
import type { Annotation } from "../../../../platform/app/reader-contract";
import type { FlowPaperName } from "../../../../reading/epub/flow/flow-display";
import OutlineView from "../../reader/sidebar/OutlineView";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogSheetContent, DialogTitle } from "../../ui/dialog";
import PhoneMarksList from "./PhoneMarksList";
import PhonePrepTab from "./PhonePrepTab";
import { CONTENTS_TABS, type ContentsTab } from "./reader-chrome";

const NO_SUPPLEMENTS = [] as const;
const noop = () => {};

const TAB_LABEL = {
  outline: "phone.contents.outline",
  marks: "phone.contents.marks",
  prep: "phone.contents.prep",
} as const;

export default function PhoneContentsSheet(props: {
  open: boolean;
  tab: ContentsTab;
  onTabChange: (tab: ContentsTab) => void;
  bookId: string;
  outline: OutlineItem[];
  marks: readonly Annotation[];
  // The reading screen's paper. The sheet is portalled to <body>, so the tokens
  // scoped to that attribute have to be restated on it (docs/70).
  paper: FlowPaperName;
  onOpenChange: (open: boolean) => void;
  onGoToChapter: (pageIndex: number) => void;
  onGoToMark: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onDeleteMark: (id: string) => void;
}) {
  const t = useT();
  const close = () => props.onOpenChange(false);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogSheetContent
        data-reader-paper={props.paper}
        aria-describedby={undefined}
        className="flex h-[85dvh] flex-col overflow-hidden"
      >
        <DialogTitle className="sr-only">{t("phone.contents.label")}</DialogTitle>
        <div className="mx-auto mt-1.5 h-[5px] w-9 flex-none rounded-full bg-border" aria-hidden />
        <div className="flex min-h-12 flex-none items-center justify-between gap-2 border-b border-border-subtle py-1 pr-1 pl-3">
          <div role="tablist" aria-label={t("phone.contents.label")} className="grid max-w-[270px] flex-1 grid-cols-3 gap-[3px] rounded-xl bg-muted p-[3px]">
            {CONTENTS_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={props.tab === tab}
                className={cn(
                  "h-[38px] cursor-pointer rounded-[9px] border-0 bg-transparent text-[15px] text-muted-foreground",
                  props.tab === tab && "bg-background font-semibold text-foreground shadow-sm",
                )}
                onClick={() => props.onTabChange(tab)}
              >
                {t(TAB_LABEL[tab])}
              </button>
            ))}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" className="text-[15px] font-semibold text-accent-line">
              {t("phone.contents.done")}
            </Button>
          </DialogClose>
        </div>

        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe-3">
          {props.tab === "outline" && (
            // The phone has no supplements: the tab is the book's chapters only.
            <OutlineView
              size="sheet"
              outline={props.outline}
              pending={false}
              bookTitle=""
              supplements={NO_SUPPLEMENTS}
              docId={null}
              bookId={null}
              displaySource={() => ""}
              onNavigatePage={(page) => {
                props.onGoToChapter(page - 1);
                close();
              }}
              onOpenBook={noop}
              onOpenSupplement={noop}
            />
          )}
          {props.tab === "marks" && (
            <PhoneMarksList
              marks={props.marks}
              outline={props.outline}
              onGoTo={(id) => {
                close();
                props.onGoToMark(id);
              }}
              onOpenConversation={(id) => {
                close();
                props.onOpenConversation(id);
              }}
              onDelete={props.onDeleteMark}
            />
          )}
          {props.tab === "prep" && <PhonePrepTab bookId={props.bookId} />}
        </div>
      </DialogSheetContent>
    </Dialog>
  );
}
