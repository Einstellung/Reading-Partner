// The lesson on the phone's EPUB reader (docs/77): the iPad's book-level call,
// mounted over the phone's own refs. It renders nothing; PhoneReader draws the
// lesson screen from what this returns.
//
// useCall is the desk's session hook, used as it is: no `form`, so the turn is
// the iPad tier. What the phone supplies is the host — the open book's bytes,
// text, figures and marks — and what the desk does not do here: no prep
// pipeline, no supplements, no pip view, no toast over a failure the lesson
// already shows.
//
// The hook is called ahead of the reader's own open/close effect, so on the way
// out of the book the call is hung up (call-end, distillation) before the reader
// writes its position and lets the archive go — close-book.ts's order.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Fulltext } from "../../../fulltext";
import { toDistillAnnotations } from "../../../memory";
import { logEvent } from "../../../platform/app/events";
import type { Annotation, ViewStats } from "../../../platform/app/reader-contract";
import type { Settings } from "../../../platform/app/settings";
import type { Topic } from "../../../platform/app/topics";
import type { FlowReaderView } from "../../../reading/epub/flow/flow-contract";
import { findFigureById, renderFigure, type Figure, type FiguresIndex } from "../../../reading/figures";
import { bookTextNotice, bookTextState } from "../../../reading/intents";
import type { Citation } from "../../../reading/prep";
import type { PrepPipeline } from "../../../reading/prep/papers/pipeline";
import { lessonDot, seenReplyTs, type LessonDot } from "../../../reading/session/lesson-dot";
import { resolveBookThread } from "../../../reading/session/book-thread";
import {
  citationLogDetail,
  citationSources,
  createQuoteCheck,
} from "../../../reading/session/citations";
import type { OpenedBook } from "../../../reading/session/open-epub";
import { readingTurnContext } from "../../../reading/session/turn-context";
import { useCall } from "../../../reading/session/use-call";
import type { CallRow } from "../../../reading/call-state";
import type { ReadingTurnContext } from "../../../reading/desk";
import { nextCardId, rehydrateMessage, type ChatPart } from "../chat/chatParts";
import type { PendingImage } from "../chat/types";
import type { FigureHost, QuoteCheck } from "../markdown/Markdown";
import {
  citationJump,
  focusLine,
  jumpInBook,
  lessonOnScreen,
  replyStreaming,
  type ViewGate,
} from "./epub-lesson";

// The desk's row: a CallRow plus the render layer's parts (App.tsx CallMessage).
export interface LessonMessage extends CallRow {
  parts?: ChatPart[];
}

// The same cap the desk stages images under. Nothing on the phone stages one
// yet; the session needs the number all the same.
const MAX_PENDING_IMAGES = 3;
const NO_SUPPLEMENTS: readonly { hash: string; title: string }[] = [];

export type LessonTopic = Pick<Topic, "id" | "name" | "files">;

export interface BookLessonArgs {
  bookId: string;
  name: string;
  topic: LessonTopic | null;
  settingsRef: { readonly current: Settings };
  pushToast(kind: "warn" | "error", message: string): void;
  // The shell's one back has to close the lesson before it leaves the book
  // (nav-stack.ts resolveBack): registered while the lesson is on screen.
  onOverlayChange?(dismiss: (() => void) | null): void;
  book: OpenedBook | null;
  stats: ViewStats | null;
  // The reader's marks, all of them (PhoneReader keeps them).
  marksRef: { readonly current: readonly Annotation[] };
  removeMark(id: string): void;
  gate: ViewGate<FlowReaderView>;
}

export function useBookLesson(args: BookLessonArgs) {
  const { bookId, book, gate, marksRef, onOverlayChange } = args;

  const bookIdRef = useRef<string | null>(null);
  const docIdRef = useRef<string | null>(null);
  const bufferRef = useRef<ArrayBuffer | null>(null);
  const fulltextRef = useRef<Promise<Fulltext | null> | null>(null);
  const figuresRef = useRef<Promise<FiguresIndex | null> | null>(null);
  const pipelineRef = useRef<PrepPipeline | null>(null);
  const supplementsRef = useRef(NO_SUPPLEMENTS);
  const ctxRef = useRef<ReadingTurnContext>(readingTurnContext(null, "", null));
  useEffect(() => {
    ctxRef.current = readingTurnContext(args.topic, args.name, args.stats);
  });
  // The marks by id, read off the reader's list whenever the session asks, so
  // a save or a delete is in it without a second copy to keep in step.
  const annsRef = useMemo(
    () => ({
      get current() {
        return new Map(marksRef.current.map((a) => [a.id, a] as const));
      },
    }),
    [marksRef],
  );
  const distillAnnotations = useCallback(
    () => toDistillAnnotations([...marksRef.current]),
    [marksRef],
  );
  // Stable, whatever the shell hands in: the session's callbacks depend on them.
  const toastRef = useRef(args.pushToast);
  toastRef.current = args.pushToast;
  const pushToast = useCallback(
    (kind: "warn" | "error", message: string) => toastRef.current(kind, message),
    [],
  );
  const removeRef = useRef(args.removeMark);
  removeRef.current = args.removeMark;
  const removeMark = useCallback((id: string) => removeRef.current(id), []);

  const lesson = useCall<LessonMessage, PendingImage>({
    annsRef,
    bookIdRef,
    docIdRef,
    supplementsRef,
    bufferRef,
    ctxRef,
    currentFiguresRef: figuresRef,
    currentFulltextRef: fulltextRef,
    distillAnnotations,
    pipelineRef,
    pushToast,
    // The failure row and its Retry are what the lesson shows; a toast would
    // cover the composer (the phone PDF lesson raises none either).
    failureInline: true,
    removeMark,
    settingsRef: args.settingsRef,
    toDisplay: (msgs) => msgs.map(rehydrateMessage),
    newRow: (row) => row,
    cards: { id: nextCardId },
    maxImages: MAX_PENDING_IMAGES,
    imageLimitHint: `You can attach up to ${MAX_PENDING_IMAGES} images.`,
    loadingImage: (id) => ({ id, status: "loading" }),
    readyImage: (id, image) => ({ id, status: "ready", data: image.data, mediaType: image.mediaType }),
    sendableImages: (staged) =>
      staged.some((p) => p.status === "loading")
        ? null
        : staged.flatMap((p) => (p.status === "ready" ? [{ data: p.data, mediaType: p.mediaType }] : [])),
  });
  const { call, showChat, showReading, reopenThread } = lesson;
  const sessionRef = useRef(lesson);
  sessionRef.current = lesson;

  // The book's text and figures, resolved, for what renders: the note under
  // an empty lesson, the quote check, the figure cards.
  const [fulltext, setFulltext] = useState<Fulltext | null>(null);
  const [pending, setPending] = useState(true);
  const [figures, setFigures] = useState<Figure[]>([]);
  const figureListRef = useRef<Figure[]>([]);
  figureListRef.current = figures;

  // The book arrives once per reader (PhoneApp keys the screen by book). Its
  // refs are the session's from then on, and leaving hangs the call up the way
  // closing a book on the iPad does — then lets go of them, so a reply that
  // lands afterwards is nobody's to watch and goes to the box.
  useEffect(() => {
    if (!book) return;
    let alive = true;
    bookIdRef.current = bookId;
    docIdRef.current = bookId;
    bufferRef.current = book.buffer;
    fulltextRef.current = book.fulltext;
    figuresRef.current = book.figures;
    void book.fulltext.then((ft) => {
      if (!alive) return;
      setFulltext(ft);
      setPending(false);
    });
    void book.figures.then((index) => {
      if (alive) setFigures(index?.figures ?? []);
    });
    return () => {
      alive = false;
      const session = sessionRef.current;
      session.captureHangup();
      session.close();
      session.discardStagedImages();
      bookIdRef.current = null;
      docIdRef.current = null;
      bufferRef.current = null;
      fulltextRef.current = null;
      figuresRef.current = null;
    };
  }, [book, bookId]);

  // Learn: the book's thread, read from its file on every press
  // (book-thread.ts), or the call already open behind the page.
  const learn = useCallback(() => {
    if (sessionRef.current.current()) {
      showChat();
      return;
    }
    const id = bookIdRef.current;
    if (!id) return;
    void (async () => {
      const resolved = await resolveBookThread(id, () => bookIdRef.current !== id);
      if (resolved.status === "unreadable") {
        pushToast("warn", "Saved AI conversations could not be loaded");
        return;
      }
      if (resolved.status === "cancelled") return;
      reopenThread(resolved.thread, { view: "chat-main", anchor: { x: 0, y: 0 } });
    })();
  }, [showChat, reopenThread, pushToast]);

  const onScreen = lessonOnScreen(call);
  useEffect(() => {
    if (!onOverlayChange) return;
    onOverlayChange(onScreen ? showReading : null);
    return () => onOverlayChange(null);
  }, [onOverlayChange, onScreen, showReading]);

  // The dot on Learn. What was last seen moves forward while the lesson is on
  // screen, read off the call on every render.
  const seenRef = useRef<number | null>(null);
  seenRef.current = seenReplyTs(seenRef.current, call);
  const dot: LessonDot = lessonDot(call, seenRef.current);

  // A citation leaves the lesson and takes the column to the passage.
  const onCitation = useCallback(
    (c: Citation) => {
      const topicId = ctxRef.current.topicId;
      if (topicId) logEvent(topicId, "citation-click", citationLogDetail(c));
      const jump = citationJump(c, figureListRef.current);
      if (!jump) return;
      if (jump.kind === "warn") {
        pushToast("warn", jump.message);
        return;
      }
      showReading();
      const text = fulltextRef.current;
      gate.run((view) => void jumpInBook(view, jump, text));
    },
    [gate, pushToast, showReading],
  );

  const figureHost = useMemo<FigureHost | null>(() => {
    if (figures.length === 0) return null;
    return {
      getFigure: (id) => findFigureById(figures, id),
      renderCard: async (figure) => {
        const buffer = bufferRef.current;
        if (!buffer) return null;
        const r = await renderFigure(bookId, buffer, figure, "card");
        return r ? { src: r.dataUrl, width: r.width, height: r.height } : null;
      },
      onJump: (figure) => onCitation({ kind: "figure", id: figure.id }),
    };
  }, [figures, onCitation, bookId]);

  const quoteCheck = useMemo<QuoteCheck>(() => createQuoteCheck(fulltext), [fulltext]);
  // Loaded and empty: no slug is linkified, there is no prep panel to open.
  const sources = useMemo(() => citationSources("", ""), []);

  const focus = focusLine(lesson.focusChapter);
  const { setFocusChapter } = lesson;
  const clearFocus = useCallback(() => setFocusChapter(null), [setFocusChapter]);

  return {
    call,
    onScreen,
    dot,
    learn,
    back: showReading,
    send: lesson.send,
    stop: lesson.stop,
    retry: lesson.retry,
    streaming: call ? replyStreaming(call.messages) : false,
    focus: focus ? { ...focus, onClear: clearFocus } : null,
    note: bookTextNotice(bookTextState(fulltext, pending)),
    onCitation,
    figureHost,
    quoteCheck,
    sources,
  };
}

export type BookLesson = ReturnType<typeof useBookLesson>;
