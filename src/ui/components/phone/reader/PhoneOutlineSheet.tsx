// The phone's one sidebar, as a sheet off the bottom edge (docs/70): the book's
// table of contents and nothing else. No marks list, no prep panel, no trace —
// none of them exist on this shell.
//
// A Radix dialog through ui/dialog.tsx, so it takes the app's layer, its safe
// area and its layer registration without restating any of them (docs/30). The
// only thing said here is where it sits: pinned to the bottom rather than
// centred, because a list reached with a thumb belongs under the thumb.
//
// A long outline fills the sheet to its height limit, so the way out cannot be
// only the strip of book left above it: the title row carries a Done.
//
// The entries carry page numbers rather than hrefs — the outline is read off
// the pagination table (reading/epub/fulltext.ts outlineFor), whose coordinate
// is the position block — so a tap is goToChapter: the page, with the view
// left to find the heading on it.

import type { OutlineItem } from "../../../../fulltext/types";
import type { FlowPaperName } from "../../../../reading/epub/flow/flow-display";
import OutlineView from "../../reader/sidebar/OutlineView";
import { Button } from "../../ui/button";
import { Dialog, DialogClose, DialogSheetContent, DialogTitle } from "../../ui/dialog";

const NO_SUPPLEMENTS = [] as const;
const noop = () => {};

export default function PhoneOutlineSheet(props: {
  open: boolean;
  outline: OutlineItem[];
  // The reading screen's paper. The sheet is portalled to <body>, so the tokens
  // scoped to that attribute have to be restated on it (docs/70).
  paper: FlowPaperName;
  onOpenChange: (open: boolean) => void;
  onGoToChapter: (pageIndex: number) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogSheetContent data-reader-paper={props.paper}>
        {/* Stuck to the top: the sheet scrolls as one, and Done must not scroll away. */}
        <div className="sticky top-0 z-10 flex items-center border-b border-border-subtle bg-background pr-1 pl-4">
          <DialogTitle className="flex-1 py-3 text-[15px]">Outline</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" className="text-[15px] font-medium">
              Done
            </Button>
          </DialogClose>
        </div>
        {/* The phone has no supplements: the sheet is the book's chapters only. */}
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
            props.onOpenChange(false);
          }}
          onOpenBook={noop}
          onOpenSupplement={noop}
        />
      </DialogSheetContent>
    </Dialog>
  );
}
