// The lesson's chapter list, as a sheet off the bottom edge — the same box the
// reading screen's outline comes out of (PhoneOutlineSheet), for the same
// reason: a list reached with a thumb belongs under the thumb.
//
// A tap is not navigation. There is nothing on this screen to move: the reader
// asks to be taken somewhere, in their own words, and the focus moves when
// read_chapter reads that chapter (docs/09). So the sheet closes and the lesson
// answers, which is why the current chapter is not a link at all.

import { Dialog, DialogSheetContent, DialogTitle } from "../ui/dialog";
import type { TableChapter } from "../../../reading/chapters/table";
import { lessonChapterRows } from "./lesson-view";

export default function PhoneChapterSheet(props: {
  open: boolean;
  chapters: readonly TableChapter[] | null;
  // The printed chapter number the lesson is parked on, or null.
  focusChapter: number | null;
  // The chapters this lesson has already been through, by printed number.
  taught: ReadonlySet<number>;
  onOpenChange: (open: boolean) => void;
  onPick: (chapter: TableChapter) => void;
}) {
  const rows = lessonChapterRows(props.chapters, props.focusChapter, props.taught);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogSheetContent>
        <DialogTitle className="border-b border-border-subtle px-4 py-3 text-[15px]">
          Chapters
        </DialogTitle>
        {rows.length === 0 ? (
          <p className="m-0 px-4 py-6 text-[14px] text-faint-foreground">
            This paper has no chapter list on this device yet.
          </p>
        ) : (
          <ul className="m-0 list-none overflow-y-auto p-0 pb-safe-4">
            {rows.map((row) => (
              <li key={row.index}>
                <button
                  className="flex w-full items-center gap-2.5 border-0 bg-transparent px-4 py-2 text-left coarse:min-h-[52px] can-hover:hover:bg-muted"
                  onClick={() => {
                    props.onOpenChange(false);
                    if (row.state === "now") return;
                    const chapter = props.chapters?.find((c) => c.index === row.index);
                    if (chapter) props.onPick(chapter);
                  }}
                >
                  <span
                    className={`w-4 flex-none text-center text-[13px] ${
                      row.state === "now" ? "text-accent-line" : "text-faint-foreground"
                    }`}
                  >
                    {row.state === "now" ? "●" : row.state === "done" ? "✓" : ""}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[15px] ${
                      row.state === "done" ? "text-muted-foreground" : ""
                    }`}
                  >
                    {row.title}
                  </span>
                  {row.state === "now" ? (
                    <span className="flex-none text-[11px] font-medium tracking-[0.08em] text-accent-line uppercase">
                      Now
                    </span>
                  ) : (
                    <span className="flex-none text-[12px] text-faint-foreground [font-variant-numeric:tabular-nums]">
                      p.{row.startPage}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogSheetContent>
    </Dialog>
  );
}
