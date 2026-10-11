// The lesson screen with a lesson running in it: the hook that holds the turn
// (use-lesson-call.ts) bound to the screen that draws it (PhoneLesson.tsx).
//
// Two files and not one so the lesson opens when the screen appears and lets
// go when it goes: the shell renders this only while the lesson is the screen,
// so mounting is opening the paper and unmounting is leaving it. Leaving does
// not stop a turn: it lands out of sight and puts a box card (use-lesson-call.ts).
// PhoneApp would have to hold a hook for a screen that is not there.
//
// An aside is the same arrangement one level in (docs/74). It replaces the
// lesson's view rather than sitting beside it, and runs its own turn on its own
// conversation. The lesson's hook stays mounted underneath — the paper it read
// and the chapters it found are the same ones on the way back. Stepping out
// does not stop the lesson's turn (only Stop stops): it runs on under the
// aside, unwatched, and the receipt the way back writes sits above its rows,
// on screen and in the file, as a card raised during a turn does
// (use-lesson-call.ts reload). Coming back re-reads the lesson.

import { useCallback, useEffect, useRef } from "react";

import PhoneLesson from "./PhoneLesson";
import { useLessonCall, type LessonBook } from "./use-lesson-call";
import { useLessonAside } from "./use-lesson-aside";
import { takeMeTo } from "../../../../reading/lesson/opening";

export default function PhoneLessonScreen(props: {
  bookId: string;
  title: string;
  topicId: string;
  topicName: string;
  onBack: () => void;
  onOpenIn?: () => void;
  // The shell's one back has to leave the aside before it leaves the screen
  // (nav-stack.ts). The lesson registers the way out of an aside the same way
  // the info call registers the way out of itself: as something drawn over the
  // screens that back consumes first.
  onOverlayChange?: (dismiss: (() => void) | null) => void;
  // The line after an aside was deleted, or the one saying it was not.
  onNotice?: (kind: "info" | "error", line: string) => void;
}) {
  // Read when a lesson reply lands: under the aside it is not on screen.
  const coveredRef = useRef(false);
  const call = useLessonCall({
    bookId: props.bookId,
    title: props.title,
    topicId: props.topicId,
    topicName: props.topicName,
    covered: () => coveredRef.current,
  });
  const aside = useLessonAside(props.bookId, call.threadId);
  coveredRef.current = aside.open !== null;

  const { ask: enter } = aside;
  const { reload } = call;
  // Coming back re-reads the lesson, which now carries that line.
  const { back } = aside;
  const leave = useCallback(() => {
    back();
    reload();
  }, [back, reload]);

  const { onOverlayChange } = props;
  const { open } = aside;
  useEffect(() => {
    if (!onOverlayChange) return;
    onOverlayChange(open ? leave : null);
    return () => onOverlayChange(null);
  }, [leave, onOverlayChange, open]);

  const book: LessonBook = {
    bookId: props.bookId,
    title: props.title,
    topicId: props.topicId,
    topicName: props.topicName,
  };

  if (open) {
    return (
      <PhoneLessonAside
        // The conversation is this id from the moment the view opens; the record
        // behind it is written by the first question (use-lesson-aside.ts), so
        // pressing Ask about this and changing one's mind leaves nothing.
        book={{ ...book, threadId: open.threadId, ensureThread: aside.ensure }}
        span={open.span}
        onBack={leave}
      />
    );
  }

  return (
    <PhoneLesson
      bookId={props.bookId}
      title={props.title}
      onBack={props.onBack}
      {...(props.onOpenIn ? { onOpenIn: props.onOpenIn } : {})}
      messages={call.messages}
      streaming={call.streaming}
      onSend={call.send}
      onStop={call.stop}
      status={call.status}
      chapters={call.chapters}
      focus={call.focus}
      taught={call.taught}
      // A tap on a chapter says what a reader would have said; read_chapter is
      // what parks the lesson there (docs/09).
      onPickChapter={(chapter) => call.send(takeMeTo(chapter))}
      onAsk={enter}
      // A hold on an aside's row deletes that aside; the lesson then re-reads
      // itself without the row.
      {...(props.onNotice
        ? { asideDelete: { topicId: props.topicId, onChanged: reload, onNotice: props.onNotice } }
        : {})}
      // The one card this conversation raises: a receipt row, which is the door
      // back into the side conversation it stands for (reader/AsideCard.tsx).
      onCardAction={(_cardId, action) => {
        if (action.kind === "navigate" && action.to === "aside" && action.arg) {
          aside.reopen(action.arg);
        }
      }}
    />
  );
}

// The aside, with its own turn. A component of its own so the hook mounts with
// the view: the same reason the lesson has one.
function PhoneLessonAside(props: { book: LessonBook; span: string; onBack: () => void }) {
  const call = useLessonCall(props.book);
  return (
    <PhoneLesson
      bookId={props.book.bookId}
      title={props.book.title}
      onBack={props.onBack}
      messages={call.messages}
      streaming={call.streaming}
      onSend={call.send}
      onStop={call.stop}
      status={call.status}
      // An aside has no chapter table, no focus line and no chapter sheet: the
      // lesson's place is the lesson's, and this conversation is about one
      // sentence of it.
      chapters={null}
      focus={null}
      taught={NONE}
      onPickChapter={() => {}}
      aside={{ onBack: props.onBack, span: props.span }}
    />
  );
}

const NONE: ReadonlySet<number> = new Set<number>();
