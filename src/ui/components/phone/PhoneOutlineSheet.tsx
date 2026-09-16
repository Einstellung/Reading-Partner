// The phone's one sidebar, as a sheet off the bottom edge (docs/69): the book's
// table of contents and nothing else. No marks list, no prep panel, no trace —
// none of them exist on this shell.
//
// A Radix dialog through ui/dialog.tsx, so it takes the app's layer, its safe
// area and its layer registration without restating any of them (docs/30). The
// only thing said here is where it sits: pinned to the bottom rather than
// centred, because a list reached with a thumb belongs under the thumb.
//
// The entries carry page numbers rather than hrefs — the outline is read off
// the pagination table (reading/epub/fulltext.ts outlineFor), whose coordinate
// is the position block — so a tap is goToPage.

import type { OutlineItem } from "../../../fulltext/types";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export default function PhoneOutlineSheet(props: {
  open: boolean;
  outline: OutlineItem[];
  onOpenChange: (open: boolean) => void;
  onGoToPage: (pageIndex: number) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        // Bottom-pinned: the centring and the box's own padding are replaced,
        // everything else about a dialog stays.
        className="top-auto bottom-0 left-0 max-h-[70dvh] w-full translate-x-0 translate-y-0 gap-0 rounded-b-none p-0"
      >
        <DialogTitle className="border-b border-border-subtle px-4 py-3 text-[15px]">
          Outline
        </DialogTitle>
        {props.outline.length === 0 ? (
          <p className="m-0 px-4 py-6 text-[14px] text-faint-foreground">
            This book has no table of contents.
          </p>
        ) : (
          <ul className="m-0 list-none overflow-y-auto p-0 pb-safe-4">
            {props.outline.map((item, i) => (
              <li key={`${item.page}-${i}`}>
                <button
                  className="flex w-full items-baseline gap-2 border-0 bg-transparent px-4 py-3 text-left text-[15px] coarse:min-h-[44px] can-hover:hover:bg-muted"
                  style={{ paddingLeft: `${16 + item.level * 14}px` }}
                  onClick={() => {
                    props.onGoToPage(item.page - 1);
                    props.onOpenChange(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="flex-none text-[12px] text-faint-foreground">{item.page}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
