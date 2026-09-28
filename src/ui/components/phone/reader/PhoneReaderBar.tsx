// The phone reader's top bar (docs/70). The desk's ReaderTopBar is built for a
// window with a sidebar, a zoom group and an overflow menu; this is the same
// controls a phone has room for, in two lines: the way back, the book, where the
// reader is in it, the outline, the pen rack, and Learn, which opens the book's
// lesson (docs/77).
//
// The AI pen is dim, with the treatment ReaderTopBar gives the blackboard when
// a level is closed: drawn, disabled, and carrying the reason as its title and
// in its accessible name. Same PenToolbar, same `disabled` map.
//
// The rack's navigation lock is not dim but absent (`omit`), and the Aa that
// opens the display sheet takes that place in the row: the phone has no pages
// to lock, and the one thing a reader reaches for there instead is the size of
// the type (docs/70).

import { useT } from "../../../../i18n";
import type { ViewStats } from "../../../../platform/app/reader-contract";
import type { LessonDot } from "../../../../reading/session/lesson-dot";
import { IconBookSparkle, IconOutline, IconTextSize } from "../../base/icons";
import { cn } from "../../lib/utils";
import PenToolbar from "../../reader/PenToolbar";
import { readerPageText } from "../../reader/reader-page-text";
import type { Tool } from "../../reader/types";
import { Button } from "../../ui/button";
import { aiPenNotOnPhone, PHONE_OMITTED_TOOLS } from "./reader-gate";

export default function PhoneReaderBar(props: {
  title: string;
  // The cutting line while the pages are being laid out, or null.
  status: string | null;
  stats: ViewStats | null;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onBack: () => void;
  onOutline: () => void;
  onDisplay: () => void;
  // Learn. Absent until the book is open: the lesson reads the book's bytes.
  onLearn?: () => void;
  // The lesson left open behind the page: a reply being written, or one that
  // finished while the reader was on the page (lesson-dot.ts).
  learnDot: LessonDot;
}) {
  const t = useT();
  const pageText = readerPageText(props.stats, t);
  const bookThread = t("phone.readerBar.learnThisBook");
  // What the dot says, in the button's accessible name.
  const dotWords: Record<Exclude<LessonDot, null>, string> = {
    writing: t("phone.readerBar.dotWriting"),
    unseen: t("phone.readerBar.dotUnseen"),
  };
  return (
    <div className="flex flex-none flex-col gap-0.5 border-b border-border-subtle px-1 pt-1 pb-1">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          title={t("phone.readerBar.backToShelf")}
          aria-label={t("phone.readerBar.backToShelf")}
          onClick={props.onBack}
        >
          ‹
        </Button>
        <span className="min-w-0 flex-1 truncate font-display text-[15px] font-medium text-foreground">
          {props.title}
        </span>
        <span className="flex-none [font-variant-numeric:tabular-nums] px-1 text-[12px] whitespace-nowrap text-muted-foreground">
          {props.status ?? pageText.blocks}
          {!props.status && pageText.printed && (
            <span className="ml-1.5 text-faint-foreground">{pageText.printed}</span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          title={t("phone.readerBar.outline")}
          aria-label={t("phone.readerBar.outline")}
          onClick={props.onOutline}
        >
          <IconOutline size={20} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          title={t("phone.readerBar.display")}
          aria-label={t("phone.readerBar.display")}
          onClick={props.onDisplay}
        >
          <IconTextSize size={20} />
        </Button>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <PenToolbar
            orientation="horizontal"
            tool={props.tool}
            onToolChange={props.onToolChange}
            disabled={{ ai: aiPenNotOnPhone() }}
            omit={PHONE_OMITTED_TOOLS}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="relative flex-none text-muted-foreground"
          disabled={!props.onLearn}
          title={bookThread}
          aria-label={bookThread + (props.learnDot ? dotWords[props.learnDot] : "")}
          onClick={props.onLearn}
        >
          <IconBookSparkle size={20} />
          {props.learnDot && (
            <span
              data-lesson-dot={props.learnDot}
              className={cn(
                "absolute top-1 right-1 h-2 w-2 rounded-full bg-accent-line shadow-[0_0_0_2px_var(--background)] coarse:top-2 coarse:right-2",
                props.learnDot === "writing" && "animate-pulse motion-reduce:animate-none",
              )}
            />
          )}
        </Button>
      </div>
    </div>
  );
}
