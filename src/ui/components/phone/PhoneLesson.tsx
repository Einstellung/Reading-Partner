// The phone's lesson screen (docs/70): a PDF taught in text, because this shell
// does not draw pages.
//
// It is the book-level conversation with a bar over it. Everything about the
// turn arrives as props (lesson-view.ts) — this file binds the bar, the focus
// line, the two standing chips and the chapter sheet to it, and nothing else.
// The conversation itself is the same CallView the desk and the briefing use,
// so a quotation block, an aside and a card render here exactly as they do
// there.

import { useState } from "react";
import CallView from "../chat/CallView";
import { Button } from "../ui/button";
import PhoneChapterSheet from "./PhoneChapterSheet";
import PhoneLessonBar from "./PhoneLessonBar";
import { LESSON_CHIPS, lessonFocusLine, type LessonViewProps } from "./lesson-view";

export default function PhoneLesson(props: LessonViewProps) {
  const [chaptersOpen, setChaptersOpen] = useState(false);

  // One row under the bar. While the paper is being fetched and read there is
  // no focus to state and the status line has the row instead; after that the
  // status is null and the focus has it back.
  const line = props.status ?? lessonFocusLine(props.chapters, props.focus);

  const header = props.aside ? (
    <div className="flex flex-none items-center border-b border-border-subtle px-1 py-1">
      {props.aside.onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={props.aside.onBack}
        >
          ‹ Back to the lesson
        </Button>
      )}
    </div>
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
  // said, so it sends a line and not a command (docs/09).
  const chips = (
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
    <div className="absolute inset-0 flex flex-col bg-chat-surface">
      <CallView
        messages={props.messages}
        onSend={props.onSend}
        // The lesson is left by the bar's back and by the edge swipe, both of
        // which are the shell's one back (nav-stack.ts). There is no hang-up on
        // this screen to route anywhere.
        onHangUp={props.onBack}
        streaming={props.streaming}
        onStop={props.onStop}
        emptyTitle={props.title}
        placeholder="Ask about the paper…"
        scalable={false}
        stickKey={`lesson-${props.bookId}`}
        aside={props.aside}
        header={header}
        footer={chips}
      />
      <PhoneChapterSheet
        open={chaptersOpen}
        chapters={props.chapters}
        focusChapter={props.focus?.chapter ?? null}
        taught={props.taught}
        onOpenChange={setChaptersOpen}
        onPick={props.onPickChapter}
      />
    </div>
  );
}
