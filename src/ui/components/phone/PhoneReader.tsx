// The phone's reading screen (docs/70). Its own top bar over the reflow pane,
// and nothing else: no sidebar, no call, no prep panel.
//
// The pane is a prop rather than an import. It is written against the contract
// (reading/epub/flow-contract.ts) and the shell against the same contract, so
// the two were built apart; the shell that mounts this screen is where they
// meet.
//
// The order a book opens in is open-epub.ts, which has no React in it. What is
// here is the binding: the state that sequence produces, the handle the pane
// hands back, and the four things a tap can reach.

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  ANNOTATION_COLORS,
  deleteAnnotations,
  saveAnnotations,
} from "../../../platform/app/annotations";
import type {
  Annotation,
  AnnotationPopupParams,
  ViewState,
  ViewStats,
} from "../../../platform/app/reader-contract";
import type {
  FlowReaderPaneProps,
  FlowReaderView,
} from "../../../reading/epub/flow-contract";
import { IconTrash } from "../base/icons";
import { cn } from "../lib/utils";
import type { Tool } from "../reader/types";
import { Button } from "../ui/button";
import { OVERLAY_Z } from "../ui/overlay";
import {
  closePhoneBook,
  mergeSavedMarks,
  openPhoneBook,
  phoneBookIo,
  type OpenedBook,
  type PhoneBookIo,
} from "./open-epub";
import { flowTool } from "./reader-gate";
import PhoneOutlineSheet from "./PhoneOutlineSheet";
import PhoneReaderBar from "./PhoneReaderBar";

export default function PhoneReader(props: {
  Pane: ComponentType<FlowReaderPaneProps>;
  bookId: string;
  name: string;
  // Where the book was opened from, so leaving it can record that it was read.
  topicId: string;
  path: string;
  onBack: () => void;
  io?: PhoneBookIo;
}) {
  const { Pane, bookId, name, topicId, path } = props;
  const io = props.io ?? phoneBookIo;
  const [book, setBook] = useState<OpenedBook | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>("Rendering…");
  const [stats, setStats] = useState<ViewStats | null>(null);
  const [tool, setTool] = useState<Tool>({ type: "none", color: ANNOTATION_COLORS[0].color });
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [popup, setPopup] = useState<AnnotationPopupParams | null>(null);
  const viewRef = useRef<FlowReaderView | null>(null);
  // Every mark the book has, the half the pane cannot hold included: what is
  // written back is this merged with what the pane hands over.
  const marksRef = useRef<readonly Annotation[]>([]);
  // The last position the pane reported, for the write on the way out.
  const lastStateRef = useRef<ViewState | null>(null);

  // Open on arrival, and settle the book on the way out. One effect: the two
  // halves are the same book, and the cleanup has to release exactly what this
  // run acquired.
  useEffect(() => {
    let left = false;
    setBook(null);
    setFailed(null);
    setStatus("Rendering…");
    setStats(null);
    lastStateRef.current = null;
    void openPhoneBook(bookId, io, (line) => {
      if (!left) setStatus(line);
    })
      .then((opened) => {
        if (left) return;
        marksRef.current = opened.allAnnotations;
        setBook(opened);
      })
      .catch((e: unknown) => {
        console.error("failed to open the book", e);
        if (!left) setFailed("This book could not be opened.");
      });
    return () => {
      left = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      closePhoneBook(io, { bookId, topicId, path }, lastStateRef.current);
    };
  }, [bookId, topicId, path, io]);

  // The rack drives the pane directly as well as the state: the pane holds the
  // tool it was last told about, and a prop change alone would not reach a pane
  // that does not re-read it.
  const changeTool = useCallback((next: Tool) => {
    setTool(next);
    viewRef.current?.setTool(flowTool(next));
  }, []);

  const removeMark = useCallback(
    (id: string) => {
      viewRef.current?.removeAnnotations([id]);
      deleteAnnotations(bookId, [id]);
      marksRef.current = marksRef.current.filter((a) => a.id !== id);
      setPopup(null);
    },
    [bookId],
  );

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <PhoneReaderBar
        title={name}
        status={status}
        stats={stats}
        tool={tool}
        onToolChange={changeTool}
        onBack={props.onBack}
        onOutline={() => setOutlineOpen(true)}
      />

      <div className="relative min-h-0 flex-1">
        {failed ? (
          <p className="m-0 px-5 py-8 text-[15px] text-muted-foreground">{failed}</p>
        ) : book ? (
          <Pane
            bookId={bookId}
            buffer={book.buffer}
            annotations={book.annotations}
            authorName="me"
            viewState={book.viewState}
            tool={flowTool(tool)}
            className="absolute inset-0"
            onView={(view) => {
              viewRef.current = view;
            }}
            onInitialized={() => setStatus(null)}
            onError={(e) => {
              console.error("the reading area failed", e);
              setFailed("This book could not be drawn.");
            }}
            onChangeViewState={(s) => {
              lastStateRef.current = s;
              io.keepReadingPosition(bookId, s);
            }}
            onChangeViewStats={setStats}
            onSaveAnnotations={(anns) => {
              marksRef.current = mergeSavedMarks(marksRef.current, anns);
              saveAnnotations(bookId, [...marksRef.current]);
            }}
            onSelectAnnotations={() => {}}
            onSetAnnotationPopup={(params) => setPopup(params ?? null)}
          />
        ) : null}

        {popup && (
          <MarkPopup
            rect={popup.rect}
            onDelete={() => removeMark(popup.annotation.id)}
            onClose={() => setPopup(null)}
          />
        )}
      </div>

      <PhoneOutlineSheet
        open={outlineOpen}
        outline={book?.outline ?? []}
        onOpenChange={setOutlineOpen}
        onGoToPage={(pageIndex) => viewRef.current?.goToPage(pageIndex)}
      />
    </div>
  );
}

// A mark that was tapped: delete it, or let it be. No colour and no comment —
// the pane draws the marks it was handed and the contract gives the shell no
// way to change one that is already on screen, only to take it away.
function MarkPopup(props: {
  rect: [number, number, number, number];
  onDelete: () => void;
  onClose: () => void;
}) {
  const [left, , right, bottom] = props.rect;
  return (
    <>
      {/* A press anywhere else puts it away. */}
      <div className="fixed inset-0" onPointerDown={props.onClose} />
      <div
        className={cn(
          "fixed -translate-x-1/2 rounded-xl border border-black/10 bg-popover p-1 shadow-lg",
          OVERLAY_Z.floating,
        )}
        style={{ left: (left + right) / 2, top: bottom + 8 }}
      >
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          title="Delete this mark"
          aria-label="Delete this mark"
          onClick={props.onDelete}
        >
          <IconTrash size={16} />
          <span className="ml-1.5">Delete</span>
        </Button>
      </div>
    </>
  );
}
