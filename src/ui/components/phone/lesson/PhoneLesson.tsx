// The phone's lesson screen (docs/70): a PDF taught in text, because this shell
// does not draw pages.
//
// It is the book-level conversation with a bar over it. Everything about the
// turn arrives as props (lesson-view.ts) — this file binds the bar, the focus
// line, the two standing chips, the chapter sheet and the hold that opens an
// aside to it, and nothing else. The conversation itself is the same CallView
// the desk and the briefing use, so a quotation block, an aside and a card
// render here exactly as they do there.
//
// The same component draws the aside (docs/74). What changes is the ground it
// stands on, the strip naming what it was pulled out of, and the three things
// an aside has none of: the chapter sheet, the standing chips and the hold.

import { useEffect, useRef, useState } from "react";
import CallView from "../../chat/call/CallView";
import { useShellKeyboard } from "../../common/useKeyboardInset";
import { CitationModeContext } from "../../markdown/Markdown";
import { Button } from "../../ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover";
import { longPressFeedback } from "../../../../platform/app/haptics";
import { replySpanAt, type LessonAskSpan } from "./lesson-aside";
import { bindLongPress } from "../gesture/long-press";
import ConfirmDestructiveDialog from "../../common/ConfirmDestructiveDialog";
import HoldMenu from "../HoldMenu";
import { useHoldDelete } from "../use-hold-delete";
import PhoneChapterSheet from "./PhoneChapterSheet";
import PhoneLessonBar from "./PhoneLessonBar";
import { LESSON_CHIPS, lessonFocusLine, type LessonViewProps } from "./lesson-view";

// What an empty aside opens on: the passage itself, set as a quotation, so the
// reader can see which words they took. The strip over it names the aside and
// truncates them (the bar is one line); this is the whole span, and it is the
// only thing on the screen besides the composer.
//
// Undefined where there is none — an aside reopened from its receipt whose
// record lost its anchor — and CallView's own heading stands instead.
function asideEpigraph(span: string) {
  if (span === "") return undefined;
  return (
    <span className="block font-display text-[17px] leading-relaxed text-muted-foreground">
      “{span}”
    </span>
  );
}

// The held paragraph, waiting for the reader to say yes to it, with the point
// the control hangs off.
interface Held {
  span: LessonAskSpan;
  x: number;
  y: number;
}

export default function PhoneLesson(props: LessonViewProps) {
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);

  // One row under the bar. While the paper is being fetched and read there is
  // no focus to state and the status line has the row instead; after that the
  // status is null and the focus has it back.
  const line = props.status ?? lessonFocusLine(props.chapters, props.focus);

  const surface = useRef<HTMLDivElement | null>(null);
  const { onAsk, aside } = props;
  useEffect(() => {
    const host = surface.current;
    // Not in an aside: one level deep, so the gesture is simply not bound
    // there (reading/aside.ts).
    if (!host || !onAsk || aside) return;
    return bindLongPress(host, {
      // Armed only over a reply. Everywhere else on the screen the timer never
      // starts, so a finger resting on the composer or the bar is a finger
      // resting on the composer or the bar.
      accepts: (target) => replySpanAt(target as Node | null) !== null,
      feedback: () => void longPressFeedback(),
      onLongPress: (press) => {
        const span = replySpanAt(press.target as Node | null);
        if (span) setHeld({ span, x: press.x, y: press.y });
      },
    });
  }, [onAsk, aside]);

  // A hold on an aside's receipt row (reader/AsideCard.tsx marks each with its
  // thread id) offers to delete that aside. The lesson only.
  const asideDelete = aside ? undefined : props.asideDelete;
  const rowHold = useHoldDelete({
    host: surface,
    attr: "data-aside-id",
    enabled: asideDelete !== undefined,
    subjectOf: (key) => {
      if (!asideDelete) return null;
      const row = surface.current?.querySelector(`[data-aside-id="${CSS.escape(key)}"]`);
      return {
        kind: "aside",
        bookId: props.bookId,
        topicId: asideDelete.topicId,
        asideId: key,
        question: row?.getAttribute("title") ?? "",
      };
    },
    presentKeys: [],
    onNotice: (kind, line) => asideDelete?.onNotice(kind, line),
    onChanged: () => asideDelete?.onChanged(),
  });

  // A lesson that moved on is a lesson the held paragraph may no longer be in.
  useEffect(() => setHeld(null), [props.messages]);

  const header = props.aside ? (
    <>
      <div className="flex flex-none items-center border-b border-border-subtle bg-background px-1 py-0.5">
        {props.aside.onBack && (
          <Button
            variant="ghost"
            size="lg"
            className="px-2 text-[15px] font-normal text-muted-foreground"
            onClick={props.aside.onBack}
          >
            ‹ Back to the lesson
          </Button>
        )}
      </div>
      {/* What this conversation is about. The one thing on the screen that says
          it is not the lesson, besides the ground under it. */}
      <div className="flex flex-none items-baseline gap-2 border-b border-border-subtle bg-background px-4 py-2 text-[12px]">
        <span className="flex-none font-medium uppercase tracking-[0.08em] text-accent-line">
          Aside
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-[13px] text-muted-foreground">
          {props.aside.span === "" ? "" : `“${props.aside.span}”`}
        </span>
      </div>
      {/* The same row the lesson gives the status line. An aside has no focus
          to state, but it has the same ways of going wrong — no provider, a
          conversation that could not be read — and without this they happen in
          silence. */}
      {props.status && (
        <div className="flex flex-none items-center gap-1.5 px-4 py-1.5 text-[12px] text-muted-foreground">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent-line" />
          <span className="min-w-0 truncate">{props.status}</span>
        </div>
      )}
    </>
  ) : (
    <>
      <PhoneLessonBar
        title={props.title}
        onBack={props.onBack}
        onChapters={() => setChaptersOpen(true)}
        onOpenIn={props.onOpenIn}
      />
      {line && (
        <div className="flex flex-none items-center gap-1.5 px-4 py-1.5 text-[12px] text-muted-foreground">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent-line" />
          <span className="min-w-0 truncate">{line}</span>
        </div>
      )}
    </>
  );

  // The two the reader never has to type. A chip says what a reader would have
  // said, so it sends a line and not a command (docs/09). An aside has none:
  // the reader is there about one sentence, and the chips are about the lesson.
  // A phone on its side with the keyboard up has no room for them either: they
  // go with the bar (CallView), for the composer and a line of the lesson.
  const cramped = useShellKeyboard()?.cramped ?? false;
  const chips = props.aside || cramped ? undefined : (
    <div className="mb-2 flex flex-wrap gap-2">
      {LESSON_CHIPS.map((chip) => (
        <Button
          key={chip.label}
          variant="outline"
          size="lg"
          className="rounded-full"
          onClick={() => props.onSend(chip.text)}
        >
          {chip.label}
        </Button>
      ))}
    </div>
  );

  return (
    // Citations in this shell are quotations, not jumps: the phone never draws
    // the paper, so [p.3 "…"] prints the words with the page under them
    // (docs/74). Declared once over the screen rather than handed down the
    // conversation, so no message row carries it — the same reason the citation
    // handler is a context. The aside is this component too, so it is covered
    // by the same line.
    <CitationModeContext.Provider value="quote">
    <div
      ref={surface}
      // The marker the reply's own selection is turned off by (styles.css). On
      // the lesson only: the aside draws no hold, and its replies stay the
      // ordinary selectable text every other conversation in the app is.
      {...(props.aside ? {} : { "data-lesson-press": "" })}
      className={`absolute inset-0 flex flex-col ${props.aside ? "bg-muted" : "bg-chat-surface"}`}
    >
      <CallView
        messages={props.messages}
        onSend={props.onSend}
        // Text only: no dictation control in the lesson (docs/74).
        voice={false}
        // The lesson is left by the bar's back and by the edge swipe, both of
        // which are the shell's one back (nav-stack.ts). There is no hang-up on
        // this screen to route anywhere.
        onHangUp={props.onBack}
        streaming={props.streaming}
        onStop={props.onStop}
        emptyTitle={props.aside ? asideEpigraph(props.aside.span) : props.title}
        {...(props.aside ? {} : { placeholder: "Ask about the paper…" })}
        scalable={false}
        stickKey={props.aside ? `aside-${props.bookId}` : `lesson-${props.bookId}`}
        aside={props.aside}
        header={header}
        {...(chips ? { footer: chips } : {})}
        {...(props.onCardAction ? { onCardAction: props.onCardAction } : {})}
      />
      {/* What a hold offers. Anchored on the point the finger was on rather
          than on a trigger — there is no trigger, the gesture is the trigger —
          so the anchor is a zero-size fixed box at that point and Radix keeps
          the box it opens inside the viewport from there. */}
      <Popover open={held !== null} onOpenChange={(open) => !open && setHeld(null)}>
        <PopoverAnchor asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed"
            style={{ left: held?.x ?? 0, top: held?.y ?? 0, width: 1, height: 1 }}
          />
        </PopoverAnchor>
        <PopoverContent side="top" align="center" className="w-auto p-1">
          <Button
            variant="ghost"
            size="lg"
            onClick={() => {
              const span = held?.span;
              setHeld(null);
              if (span) props.onAsk?.(span);
            }}
          >
            Ask about this
          </Button>
        </PopoverContent>
      </Popover>
      <HoldMenu {...rowHold.menu} />
      {rowHold.ask && (
        <ConfirmDestructiveDialog
          title={rowHold.ask.words.title}
          description={rowHold.ask.words.description}
          actionLabel={rowHold.ask.words.action}
          open
          onOpenChange={(open) => !open && rowHold.endAsk()}
          onConfirm={rowHold.confirm}
        />
      )}
      <PhoneChapterSheet
        open={chaptersOpen}
        chapters={props.chapters}
        focusChapter={props.focus?.chapter ?? null}
        taught={props.taught}
        onOpenChange={setChaptersOpen}
        onPick={props.onPickChapter}
      />
    </div>
    </CitationModeContext.Provider>
  );
}
