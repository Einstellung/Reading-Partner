// The phone's reading screen (docs/70, docs/82): the page, with its chrome away
// until a tap in the middle asks for it, and the book's lesson (docs/77) as a
// sheet over it. No sidebar, no prep panel, no corner cards.
//
// A hold on the words selects them; the reader draws the handles and the
// Highlight / Ask popup over the selection, which the view keeps. Ask lays an
// AI underline on the words and opens a conversation anchored on it, the phone
// form of the iPad's AI pen. A tap on a mark raises what that mark offers.
//
// The pane is a prop rather than an import. It is written against the contract
// (reading/epub/flow/flow-contract.ts) and the shell against the same contract, so
// the two were built apart; the shell that mounts this screen is where they
// meet.
//
// The order a book opens in is reading/session/open-epub.ts, which has no React
// in it. What is here is the binding: the state that sequence produces, the
// handle the pane hands back, and what a tap can reach.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useT } from "../../../../i18n";
import { HIGHLIGHT_COLOR, deleteAnnotations, saveAnnotations } from "../../../../platform/app/annotations";
import type { Annotation, ViewState, ViewStats } from "../../../../platform/app/reader-contract";
import type {
  FlowMarkPopup,
  FlowReaderPaneProps,
  FlowReaderView,
  FlowSelection,
  FlowTool,
} from "../../../../reading/epub/flow/flow-contract";
import {
  FLOW_PAPERS,
  flowPaperSwatch,
  readFlowDisplay,
  writeFlowDisplay,
  type FlowDisplay,
} from "../../../../reading/epub/flow/flow-display";
import { EDGE_ZONE } from "../gesture/edge-back-gesture";
import { pageMarks } from "../../../../platform/app/reader-contract";
import { browserPrefStore } from "../../base/pref-store";
import { cn } from "../../lib/utils";
import {
  closePhoneBook,
  mergeSavedMarks,
  openPhoneBook,
  phoneBookIo,
  type OpenedBook,
  type PhoneBookIo,
} from "../../../../reading/session/open-epub";
import { AI_PEN_COLOR } from "../../../../reading/session/use-marks";
import type { Settings } from "../../../../platform/app/settings";
import { createViewGate } from "../lesson/epub-lesson";
import PhoneBookLesson from "../lesson/PhoneBookLesson";
import { deletePhoneMark, markThreadId, type MarkDeleteIo } from "./delete-mark";
import ConfirmDestructiveDialog from "../../common/ConfirmDestructiveDialog";
import PhoneContentsSheet from "./PhoneContentsSheet";
import PhoneDisplaySheet from "./PhoneDisplaySheet";
import PhoneMarkPopup from "./PhoneMarkPopup";
import type { ScreenFrame } from "./PhonePopup";
import PhoneReaderBar from "./PhoneReaderBar";
import PhoneSelection from "./PhoneSelection";
import { takeReaderHint, type ContentsTab } from "./reader-chrome";
import { useBookLesson, type LessonTopic } from "../lesson/use-book-lesson";
import { deleteThreadTree, loadThreads } from "../../../../platform/app/threads";
import { logEvent } from "../../../../platform/app/events";
import { deleteThreadImages } from "../../../../platform/app/thread-images";

const markDeleteIo: MarkDeleteIo = {
  loadThreads,
  deleteThreadTree,
  deleteAnnotations,
  logThreadDelete: (topicId, threadId) =>
    logEvent(topicId, "thread-delete", { threadId, book: false }),
  removeThreadImages: deleteThreadImages,
};

// No pen on the phone: a drag on the words is always a selection (docs/82).
const NO_PEN: FlowTool = { type: "none", color: HIGHLIGHT_COLOR };

// How long the first-open hint stays up.
const HINT_MS = 5000;

export default function PhoneReader(props: {
  Pane: ComponentType<FlowReaderPaneProps>;
  bookId: string;
  name: string;
  // Where the book was opened from, so leaving it can record that it was read.
  topicId: string;
  path: string;
  // The topic itself, for what a lesson turn is told about where the book is
  // filed (turn-context.ts). Null until the shelf has been read.
  topic: LessonTopic | null;
  settingsRef: { readonly current: Settings };
  pushToast(kind: "warn" | "error", message: string): void;
  // The lesson is drawn over the reader rather than pushed on the stack, so the
  // shell's back has to be told to close it first (nav-stack.ts).
  onOverlayChange?(dismiss: (() => void) | null): void;
  onBack: () => void;
  io?: PhoneBookIo;
}) {
  const t = useT();
  const { Pane, bookId, name, topicId, path } = props;
  const io = props.io ?? phoneBookIo;
  const [book, setBook] = useState<OpenedBook | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(t("phone.reader.rendering"));
  const [stats, setStats] = useState<ViewStats | null>(null);
  const [chrome, setChrome] = useState(false);
  const [panel, setPanel] = useState<"contents" | "display" | null>(null);
  const [tab, setTab] = useState<ContentsTab>("outline");
  // This device's view of the text (flow-display.ts). Read once, synchronously,
  // so the column mounts at the size and paper the reader left it at.
  const prefs = useMemo(() => browserPrefStore(window), []);
  const [display, setDisplay] = useState<FlowDisplay>(() => readFlowDisplay(prefs));
  const [hint, setHint] = useState(false);
  // The selection and the tapped mark, each with the screen's box as it was
  // when the view reported them: the rects are the viewport's.
  const [selection, setSelection] = useState<{ selection: FlowSelection; frame: ScreenFrame } | null>(null);
  const [popup, setPopup] = useState<{ popup: FlowMarkPopup; frame: ScreenFrame } | null>(null);
  // The marks live in a ref the session reads; this redraws what shows them.
  const [, setMarksVersion] = useState(0);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<FlowReaderView | null>(null);
  // Every mark the book has, the half the pane cannot hold included: what is
  // written back is this merged with what the pane hands over.
  const marksRef = useRef<readonly Annotation[]>([]);
  // The last position the pane reported, for the write on the way out.
  const lastStateRef = useRef<ViewState | null>(null);
  // Holds a citation's jump until the column can take it (epub-lesson.ts).
  const gate = useMemo(() => createViewGate<FlowReaderView>(), []);

  const frameNow = useCallback((): ScreenFrame => {
    const r = screenRef.current?.getBoundingClientRect();
    // A screen not laid out yet has no box; the window stands in for it.
    return r && r.height > 0
      ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  }, []);

  const setMarks = useCallback((next: readonly Annotation[]) => {
    marksRef.current = next;
    setMarksVersion((v) => v + 1);
  }, []);

  const removeMark = useCallback(
    (id: string) => {
      viewRef.current?.removeAnnotations([id]);
      deleteAnnotations(bookId, [id]);
      setMarks(marksRef.current.filter((a) => a.id !== id));
      setPopup(null);
    },
    [bookId, setMarks],
  );

  // Above the open/close effect below, so leaving the book hangs the lesson up
  // before the reader lets the book go (use-book-lesson.ts).
  const lesson = useBookLesson({
    bookId,
    name,
    topic: props.topic,
    settingsRef: props.settingsRef,
    pushToast: props.pushToast,
    ...(props.onOverlayChange ? { onOverlayChange: props.onOverlayChange } : {}),
    book,
    stats,
    marksRef,
    removeMark,
    gate,
  });

  // Open on arrival, and settle the book on the way out. One effect: the two
  // halves are the same book, and the cleanup has to release exactly what this
  // run acquired.
  useEffect(() => {
    let left = false;
    setBook(null);
    setFailed(null);
    setStatus(t("phone.reader.rendering"));
    setStats(null);
    lastStateRef.current = null;
    void openPhoneBook(bookId, io, (line) => {
      if (!left) setStatus(line);
    })
      .then((opened) => {
        if (left) return;
        setMarks(opened.allAnnotations);
        setBook(opened);
      })
      .catch((e: unknown) => {
        console.error("failed to open the book", e);
        if (!left) setFailed(t("phone.reader.openFailed"));
      });
    return () => {
      left = true;
      gate.detach();
      viewRef.current?.destroy();
      viewRef.current = null;
      closePhoneBook(io, { bookId, topicId, path }, lastStateRef.current);
    };
  }, [bookId, topicId, path, io, gate, setMarks]);

  // Said once per device, the first time a book comes up here.
  useEffect(() => {
    if (!book || !takeReaderHint(prefs)) return;
    setHint(true);
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [book, prefs]);

  const changeDisplay = useCallback(
    (next: FlowDisplay) => {
      setDisplay(next);
      writeFlowDisplay(prefs, next);
    },
    [prefs],
  );

  const openPanel = useCallback((next: "contents" | "display") => {
    setChrome(false);
    setHint(false);
    viewRef.current?.clearSelection();
    setPopup(null);
    setPanel(next);
  }, []);

  // The mark whose conversation is about to go with it, while that is being
  // confirmed.
  const [confirming, setConfirming] = useState<string | null>(null);

  // Deleting a mark: the conversation opened from it goes too (delete-mark.ts).
  // removeMark above stays mark-only, which is what the lesson's call asks of
  // it after it has dropped the threads itself.
  const deleteMarkWithThread = useCallback(
    (id: string) => {
      void deletePhoneMark({ bookId, topicId }, marksRef.current, id, markDeleteIo)
        .then((ids) => {
          viewRef.current?.removeAnnotations(ids);
          const gone = new Set(ids);
          setMarks(marksRef.current.filter((a) => !gone.has(a.id)));
        })
        .catch((e: unknown) => console.error("failed to delete the mark", e));
    },
    [bookId, topicId, setMarks],
  );

  const askRemoveMark = useCallback(
    (id: string) => {
      setPopup(null);
      if (markThreadId(marksRef.current.find((a) => a.id === id))) setConfirming(id);
      else deleteMarkWithThread(id);
    },
    [deleteMarkWithThread],
  );

  // Ask: the selection becomes an AI underline carrying a new thread's id, and
  // that conversation opens over the page.
  const { openMark } = lesson;
  const askAboutSelection = useCallback(() => {
    const mark = viewRef.current?.saveSelection({
      stroke: "underline",
      color: AI_PEN_COLOR,
      aiThreadId: crypto.randomUUID(),
    });
    setSelection(null);
    if (mark) openMark(mark);
  }, [openMark]);

  const askAboutMark = useCallback(
    (id: string) => {
      if (viewRef.current?.selectMark(id)) askAboutSelection();
    },
    [askAboutSelection],
  );

  const openConversation = useCallback(
    (id: string) => {
      const mark = marksRef.current.find((a) => a.id === id);
      if (mark) openMark(mark);
    },
    [openMark],
  );

  // The passage a conversation in the slot is about, for the quote over it.
  const call = lesson.call;
  const quote =
    call && !call.isBook && call.annotationId
      ? (marksRef.current.find((a) => a.id === call.annotationId)?.text as string | undefined) ?? null
      : null;

  const covered = panel !== null || lesson.onScreen;

  return (
    <div className="absolute inset-0">
    {/* The paper the reader chose is the whole reading screen's, not just the
        column's: the dark one redefines the tokens the bars and the sheets are
        drawn from (styles.css), and the other three leave them alone. */}
    <div
      ref={screenRef}
      className="absolute inset-0 overflow-hidden bg-background"
      // The strip under the paged view, where the page line sits, is the paper.
      style={{ backgroundColor: flowPaperSwatch(FLOW_PAPERS[display.paper]) }}
      data-reader-paper={display.paper}
      data-chrome={chrome ? "shown" : "hidden"}
      // Covered, not unmounted, while the lesson is up: the column keeps its
      // place and its layout, so a citation can be found and marked in it.
      aria-hidden={lesson.onScreen || undefined}
    >
      {/* The paged view leaves a strip at the foot for the page line; the
          scrolled column runs under it. */}
      <div className={cn("absolute inset-x-0 top-0", display.mode === "paged" ? "bottom-6" : "bottom-0")}>
        {failed ? (
          <p className="m-0 px-5 py-8 text-[15px] text-muted-foreground">{failed}</p>
        ) : book ? (
          <Pane
            bookId={bookId}
            buffer={book.buffer}
            // The marks as they stand now, not as the book opened: a switch
            // between scrolling and turning mounts a new view with this list,
            // and the list it saves back replaces the page marks on disk.
            annotations={pageMarks(marksRef.current)}
            authorName="me"
            viewState={book.viewState}
            tool={NO_PEN}
            display={display}
            backEdgePx={EDGE_ZONE}
            className="absolute inset-0"
            onView={(view) => {
              viewRef.current = view;
              gate.attach(view);
            }}
            onInitialized={() => {
              setStatus(null);
              gate.ready();
            }}
            onError={(e) => {
              console.error("the reading area failed", e);
              setFailed(t("phone.reader.drawFailed"));
            }}
            onChangeViewState={(s) => {
              // A turn or a scroll puts the bars away.
              const was = lastStateRef.current;
              if (was && (was.cfi !== s.cfi || was.pageIndex !== s.pageIndex)) setChrome(false);
              lastStateRef.current = s;
              io.keepReadingPosition(bookId, s);
            }}
            onChangeViewStats={setStats}
            onSaveAnnotations={(anns) => {
              setMarks(mergeSavedMarks(marksRef.current, anns));
              saveAnnotations(bookId, [...marksRef.current]);
            }}
            onSelectAnnotations={() => {}}
            onSetAnnotationPopup={(params) => {
              setChrome(false);
              setHint(false);
              setPopup(params ? { popup: params, frame: frameNow() } : null);
            }}
            onSelection={(next) => {
              if (next) {
                setChrome(false);
                setHint(false);
                setPopup(null);
              }
              setSelection(next ? { selection: next, frame: frameNow() } : null);
            }}
            onMiddleTap={() => {
              setHint(false);
              setChrome((on) => !on);
            }}
          />
        ) : null}
      </div>

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-[64%] left-1/2 z-4 -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-primary px-4.5 py-3 text-center text-[14px] leading-snug whitespace-nowrap text-primary-foreground opacity-0 shadow-lg transition-opacity duration-300",
          hint && "opacity-90",
        )}
      >
        {t("phone.reader.hintTap")}
        <br />
        {t("phone.reader.hintHold")}
      </div>

      {selection && (
        <PhoneSelection
          selection={selection.selection}
          frame={selection.frame}
          onMoveEnd={(end, x, y) => viewRef.current?.moveSelectionEnd(end, x, y)}
          onHighlight={() => {
            viewRef.current?.saveSelection({ stroke: "highlight", color: HIGHLIGHT_COLOR });
            setSelection(null);
          }}
          onAsk={askAboutSelection}
        />
      )}

      {popup && (
        <PhoneMarkPopup
          popup={popup.popup}
          frame={popup.frame}
          onClose={() => setPopup(null)}
          onDelete={askRemoveMark}
          onAsk={askAboutMark}
          onOpen={openConversation}
        />
      )}

      <PhoneReaderBar
        shown={chrome}
        title={name}
        status={status}
        stats={stats}
        onBack={props.onBack}
        onOutline={() => openPanel("contents")}
        onDisplay={() => openPanel("display")}
        {...(book ? { onLearn: lesson.learn } : {})}
        learnDot={lesson.dot}
        covered={covered}
      />

      {confirming && (
        // Opened after the popup has closed, so it sits on the dialog layer
        // and nothing covers Cancel (docs/pitfall/211).
        <ConfirmDestructiveDialog
          title={t("phone.reader.deleteMarkTitle")}
          description={t("phone.reader.deleteMarkDescription")}
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          onConfirm={() => deleteMarkWithThread(confirming)}
        />
      )}

      <PhoneContentsSheet
        open={panel === "contents"}
        tab={tab}
        onTabChange={setTab}
        bookId={bookId}
        outline={book?.outline ?? []}
        marks={marksRef.current}
        paper={display.paper}
        onOpenChange={(open) => setPanel(open ? "contents" : null)}
        onGoToChapter={(pageIndex) => viewRef.current?.goToChapter(pageIndex)}
        onGoToMark={(id) => viewRef.current?.goToAnnotation(id)}
        onOpenConversation={openConversation}
        onDeleteMark={askRemoveMark}
      />

      <PhoneDisplaySheet
        open={panel === "display"}
        display={display}
        onOpenChange={(open) => setPanel(open ? "display" : null)}
        onChange={changeDisplay}
      />
    </div>

    {lesson.onScreen && <PhoneBookLesson title={name} lesson={lesson} quote={quote} />}
    </div>
  );
}
