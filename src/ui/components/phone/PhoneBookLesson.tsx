// The lesson on the phone's EPUB reader (docs/77): the book's conversation, the
// whole screen, over the reader that stays mounted underneath so the page is
// where it was on the way back.
//
// The conversation is the CallView the iPad draws, at phone sizing: a bar of its
// own across the top (back and the book), the chapter focus as a row under it,
// no dictation. The session lives in use-book-lesson.ts; this file binds it.
//
// Citations are chips and quote blocks that jump (no CitationModeContext here —
// "quote" is the PDF lesson's, where there is no page to jump to).

import CallView from "../chat/CallView";
import ChapterFocusBar from "../chat/ChapterFocusBar";
import {
  CitationContext,
  FigureContext,
  PrepSlugContext,
  QuoteCheckContext,
} from "../markdown/Markdown";
import { Button } from "../ui/button";
import type { BookLesson } from "./use-book-lesson";

export default function PhoneBookLesson(props: {
  title: string;
  lesson: BookLesson;
}) {
  const { lesson } = props;
  const call = lesson.call;
  if (!call) return null;

  const header = (
    <>
      <div className="flex flex-none items-center gap-1 border-b border-border-subtle bg-background px-1 py-1">
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          title="Back to the page"
          aria-label="Back to the page"
          onClick={lesson.back}
        >
          ‹
        </Button>
        <span className="min-w-0 flex-1 truncate font-display text-[15px] font-medium text-foreground">
          {props.title}
        </span>
      </div>
      {lesson.focus && <ChapterFocusBar {...lesson.focus} row />}
    </>
  );

  // A failed turn stays on screen with the way to ask again (docs/03).
  const retry = call.error ? (
    <div className="mb-2 flex justify-center">
      <Button variant="outline" size="sm" className="rounded-full" onClick={lesson.retry}>
        Retry
      </Button>
    </div>
  ) : undefined;

  return (
    <CitationContext.Provider value={lesson.onCitation}>
    <PrepSlugContext.Provider value={lesson.sources}>
    <FigureContext.Provider value={lesson.figureHost}>
    <QuoteCheckContext.Provider value={lesson.quoteCheck}>
      <div className="absolute inset-0 z-10 flex flex-col bg-chat-surface" aria-label="Lesson">
        <CallView
          messages={call.messages}
          onSend={lesson.send}
          // No hang-up on this screen: the bar's back and the edge swipe are the
          // way out, and both leave the call open behind the page.
          onHangUp={lesson.back}
          streaming={lesson.streaming}
          onStop={lesson.stop}
          voice={false}
          scalable={false}
          emptyTitle={props.title}
          placeholder="Ask me to teach you part of this book…"
          emptyNote={lesson.note}
          stickKey={call.threadId}
          header={header}
          {...(retry ? { footer: retry } : {})}
        />
      </div>
    </QuoteCheckContext.Provider>
    </FigureContext.Provider>
    </PrepSlugContext.Provider>
    </CitationContext.Provider>
  );
}
