// Learn on the phone's EPUB reader (docs/77, docs/82): the book's conversation,
// or a passage's, as a sheet over the reader that stays mounted underneath so
// the page is where it was on the way back. The strip of page left above the
// sheet is its scrim: a tap there closes it, as Done does.
//
// The conversation is the CallView the iPad draws, at phone sizing: a title row
// with Done, the passage quoted under it when the conversation is about one,
// the chapter focus as a row, no dictation. The session lives in
// use-book-lesson.ts; this file binds it.
//
// Citations are chips and quote blocks that jump (no CitationModeContext here —
// "quote" is the PDF lesson's, where there is no page to jump to).

import { useT } from "../../../../i18n";
import CallView from "../../chat/call/CallView";
import ChapterFocusBar from "../../chat/call/ChapterFocusBar";
import {
  CitationContext,
  FigureContext,
  PrepSlugContext,
  QuoteCheckContext,
} from "../../markdown/Markdown";
import { Button } from "../../ui/button";
import type { BookLesson } from "./use-book-lesson";

export default function PhoneBookLesson(props: {
  title: string;
  lesson: BookLesson;
  // The words a passage's conversation is about; null for the book's.
  quote: string | null;
}) {
  const t = useT();
  const { lesson } = props;
  const call = lesson.call;
  if (!call) return null;

  const quote = props.quote?.replace(/\s+/g, " ").trim() || null;
  const header = (
    <>
      <div className="mx-auto mt-1.5 h-[5px] w-9 flex-none rounded-full bg-border" aria-hidden />
      <div className="flex min-h-12 flex-none items-center border-b border-border-subtle pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {t("phone.bookLesson.title")}
        </span>
        <Button
          variant="ghost"
          className="text-[15px] font-semibold text-accent-line"
          title={t("phone.bookLesson.backToPage")}
          aria-label={t("phone.bookLesson.backToPage")}
          onClick={lesson.back}
        >
          {t("phone.bookLesson.done")}
        </Button>
      </div>
      {quote && (
        <blockquote
          data-lesson-quote
          className="m-0 mx-4 mt-3 flex-none rounded-r-lg border-l-[3px] border-accent-line bg-muted px-3 py-2 font-display text-[15px] leading-snug text-foreground"
        >
          <span className="line-clamp-3">{quote}</span>
        </blockquote>
      )}
      {lesson.focus && <ChapterFocusBar {...lesson.focus} row />}
    </>
  );

  // A failed turn stays on screen with the way to ask again (docs/03).
  const retry = call.error ? (
    <div className="mb-2 flex justify-center">
      <Button variant="outline" size="sm" className="rounded-full" onClick={lesson.retry}>
        {t("phone.bookLesson.retry")}
      </Button>
    </div>
  ) : undefined;

  return (
    <CitationContext.Provider value={lesson.onCitation}>
    <PrepSlugContext.Provider value={lesson.sources}>
    <FigureContext.Provider value={lesson.figureHost}>
    <QuoteCheckContext.Provider value={lesson.quoteCheck}>
      <div className="absolute inset-0 z-10 bg-black/25" data-testid="lesson-scrim" onClick={lesson.back} />
      <div
        className="absolute inset-x-0 bottom-0 z-10 flex h-[85%] flex-col overflow-hidden rounded-t-2xl bg-chat-surface shadow-[0_-8px_30px_rgba(0,0,0,0.14)]"
        aria-label={t("phone.bookLesson.ariaLabel")}
      >
        <CallView
          messages={call.messages}
          onSend={lesson.send}
          // No hang-up on this sheet: Done, the page above it and the edge
          // swipe are the way out, and all three leave the call open behind
          // the page.
          onHangUp={lesson.back}
          streaming={lesson.streaming}
          onStop={lesson.stop}
          voice={false}
          scalable={false}
          emptyTitle={props.title}
          placeholder={quote ? t("phone.bookLesson.passagePlaceholder") : t("phone.bookLesson.placeholder")}
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
