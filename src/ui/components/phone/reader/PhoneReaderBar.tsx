// The phone reader's bars (docs/82). Hidden while reading: a tap in the middle
// of the page brings both, and a turn, a scroll or another tap puts them away.
//
// The top bar is the way back, the book, and where the reader is in it. The
// bottom bar is the three things a reader reaches for: the Outline panel
// (outline, marks and prep), the Display sheet, and Learn, which opens the
// book's lesson (docs/77). There is no pen rack: marking starts from a hold on
// the words.
//
// With the bars away, two things stay: the page line at the foot of the
// screen, faint, and a dot at the top right when Learn has a reply waiting.
//
// While the bottom bar is up it fills the shell's composer slot, the way a
// conversation's composer does, so Lumen's corner stands above it instead of on
// Learn (lumen/corner-placement.ts).

import { useT } from "../../../../i18n";
import type { ViewStats } from "../../../../platform/app/reader-contract";
import type { LessonDot } from "../../../../reading/session/lesson-dot";
import { IconBookSparkle, IconOutline, IconTextSize } from "../../base/icons";
import { useComposerSlot } from "../../chat/call/composer-slot";
import { cn } from "../../lib/utils";
import { readerPageText } from "../../reader/reader-page-text";
import { Button } from "../../ui/button";

export default function PhoneReaderBar(props: {
  shown: boolean;
  title: string;
  // The cutting line while the pages are being laid out, or null.
  status: string | null;
  stats: ViewStats | null;
  onBack: () => void;
  onOutline: () => void;
  onDisplay: () => void;
  // Learn. Absent until the book is open: the lesson reads the book's bytes.
  onLearn?: () => void;
  // The lesson left open behind the page: a reply being written, or one that
  // finished while the reader was on the page (lesson-dot.ts).
  learnDot: LessonDot;
  // A panel is up: the dot over the page steps aside for it.
  covered: boolean;
}) {
  const t = useT();
  const pageText = readerPageText(props.stats, t);
  const bookThread = t("phone.readerBar.learnThisBook");
  const dotWords: Record<Exclude<LessonDot, null>, string> = {
    writing: t("phone.readerBar.dotWriting"),
    unseen: t("phone.readerBar.dotUnseen"),
  };
  const position = props.status ?? pageText.blocks;
  const hidden = !props.shown;
  const cornerSlot = useComposerSlot();

  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-1 z-2 text-center text-[11px] tracking-wide text-faint-foreground opacity-70 transition-opacity duration-200 [font-variant-numeric:tabular-nums]",
          props.shown && "opacity-0",
        )}
        aria-hidden
      >
        {position}
      </div>
      {props.learnDot && hidden && !props.covered && (
        <span
          aria-hidden
          data-lesson-dot-page={props.learnDot}
          className={cn(
            "pointer-events-none absolute top-2.5 right-3.5 z-2 h-2 w-2 rounded-full bg-accent-line shadow-[0_0_0_2px_var(--background)]",
            props.learnDot === "writing" && "animate-pulse motion-reduce:animate-none",
          )}
        />
      )}

      <header
        data-reader-chrome="top"
        aria-hidden={hidden || undefined}
        className={cn(
          "absolute inset-x-0 top-0 z-5 flex items-center gap-1 border-b border-border-subtle bg-background/95 py-1 pr-2 pl-1 backdrop-blur-md transition-transform duration-[240ms] ease-out",
          hidden && "pointer-events-none -translate-y-full",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-[26px] text-muted-foreground"
          title={t("phone.readerBar.backToShelf")}
          aria-label={t("phone.readerBar.backToShelf")}
          onClick={props.onBack}
        >
          ‹
        </Button>
        <span className="min-w-0 flex-1 truncate font-display text-[15px] font-medium text-foreground">
          {props.title}
        </span>
        <span className="flex-none px-1 text-[12px] whitespace-nowrap text-muted-foreground [font-variant-numeric:tabular-nums]">
          {position}
          {!props.status && pageText.printed && (
            <span className="ml-1.5 text-faint-foreground">{pageText.printed}</span>
          )}
        </span>
      </header>

      <nav
        ref={hidden ? undefined : cornerSlot}
        data-reader-chrome="bottom"
        aria-label={t("phone.readerBar.tools")}
        aria-hidden={hidden || undefined}
        className={cn(
          "absolute inset-x-0 bottom-0 z-5 grid grid-cols-3 border-t border-border-subtle bg-background/95 px-2 pt-1 backdrop-blur-md transition-transform duration-[240ms] ease-out",
          hidden && "pointer-events-none translate-y-full",
        )}
      >
        <BarTool label={t("phone.readerBar.outline")} onClick={props.onOutline}>
          <IconOutline size={22} />
        </BarTool>
        <BarTool label={t("phone.readerBar.display")} onClick={props.onDisplay}>
          <IconTextSize size={22} />
        </BarTool>
        <BarTool
          label={t("phone.readerBar.learn")}
          ariaLabel={bookThread + (props.learnDot ? dotWords[props.learnDot] : "")}
          title={bookThread}
          disabled={!props.onLearn}
          onClick={props.onLearn}
        >
          <IconBookSparkle size={22} />
          {props.learnDot && (
            <span
              data-lesson-dot={props.learnDot}
              className={cn(
                "absolute top-1.5 left-[calc(50%+8px)] h-2 w-2 rounded-full bg-accent-line shadow-[0_0_0_2px_var(--background)]",
                props.learnDot === "writing" && "animate-pulse motion-reduce:animate-none",
              )}
            />
          )}
        </BarTool>
      </nav>
    </>
  );
}

function BarTool(props: {
  label: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size={null}
      className="relative flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-normal text-muted-foreground"
      title={props.title ?? props.label}
      aria-label={props.ariaLabel ?? props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
      <span aria-hidden>{props.label}</span>
    </Button>
  );
}
