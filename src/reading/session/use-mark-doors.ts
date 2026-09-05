// What a mark is a door into, lifted out of App: the stroke that lands and the
// conversation it starts, the press that reopens one, and the trace-list row
// that goes to either the page or the room. The other half of the marks — the
// map, the list and the popup — is use-marks.ts, which this one is handed.
//
// It renders nothing, and it is called after useCall: every door here needs the
// call's own ways in (openThread, reopenThread, openChatAside), which is the
// whole reason the marks are two hooks rather than one.

import { useCallback, useEffect } from "react";
import { isPageMark, type Annotation, type AnnotationPopupParams, type ViewInstance } from "../../platform/app/reader-contract";
import {
  createAsideThread,
  createThread,
  getThread,
  type AsideAnchor,
  type Thread,
  type ThreadMessage,
} from "../../platform/app/threads";
import { asideAnchorAt } from "../aside";
import type { CallRow, CallState } from "../call-state";
import {
  buildChatMark,
  chatMarkWords,
  markDoorThread,
  markOpenAction,
  traceSelectAction,
  type ChatMarkDraw,
} from "../chat-marks";
import type { ChatAsideMark, OpeningCall, ReopenAt } from "./use-call";
import { AI_PEN_COLOR, type MarkStore } from "./use-marks";

// A ref the shell owns and this hook only reads.
type HostRef<T> = { readonly current: T };

export interface MarkDoorsHost {
  // The marks themselves (use-marks.ts): the map, the list, the popup and the
  // writes that keep them in agreement.
  marks: MarkStore;
  viewRef: HostRef<ViewInstance | null>;
  bookIdRef: HostRef<string | null>;
  // The reader pane's DOM container, for the fallback bubble anchor when a pen
  // stroke gave no pen-lift.
  readerPaneRef: HostRef<HTMLDivElement | null>;

  // Whether the pen in the rack is the AI pen, and the color the other two draw
  // in. Both are the shell's tool state.
  aiPen: boolean;
  penColor: string;

  // A mark landing is one of the two things that start preparation (docs/09).
  onMarkPrepTrigger(): void;
  setSidebarOpen(open: boolean): void;

  // The call's doors (use-call.ts).
  openThreadCall(call: OpeningCall<CallRow>, stored: ThreadMessage[]): void;
  reopenThreadCall(thread: Thread, at: ReopenAt): void;
  openChatAside(anchor: AsideAnchor, mark?: ChatAsideMark): void;
  currentCall(): CallState<CallRow> | null;
  dropThread(annotationId: string, threadId: string | undefined): void;
}

export interface MarkDoors {
  onSaveAnnotations(incoming: Annotation[]): void;
  hasThread(threadId: string): boolean;
  onSetAnnotationPopup(params?: AnnotationPopupParams): void;
  drawChatMark(draw: ChatMarkDraw): void;
  openChatMark(ann: Annotation, at: { x: number; y: number }): void;
  onTraceSelect(id: string): void;
  deleteTraceAnnotation(id: string): void;
  openThreadForAnnotation(annotationId: string): void;
  onPositionClick(): void;
}

export function useMarkDoors(host: MarkDoorsHost): MarkDoors {
  const {
    marks,
    viewRef,
    bookIdRef,
    readerPaneRef,
    aiPen,
    penColor,
    onMarkPrepTrigger,
    setSidebarOpen,
    openThreadCall,
    reopenThreadCall,
    openChatAside,
    currentCall,
    dropThread,
  } = host;
  const {
    annsRef,
    aiPenRef,
    penUpRef,
    asideFramingFor,
    persistAnnotations,
    removeAnnotation,
    setPopup,
    setSelectedAnnId,
    syncTraceList,
  } = marks;

  // Which pen a stroke that lands was drawn with. Host-owned, not read back off
  // the color the engine was handed.
  useEffect(() => {
    aiPenRef.current = aiPen;
  }, [aiPen, aiPenRef]);

  // Engine created/modified annotations (drag-to-highlight, AI-pen underline, etc.).
  // A brand-new annotation drawn while the AI pen is active starts a thread and
  // opens the call bubble.
  const onSaveAnnotations = useCallback(
    (incoming: Annotation[]) => {
      let aiCreated: { annotation: Annotation; threadId: string } | null = null;
      let newMark = false;
      for (const a of incoming) {
        const { onlyTextOrComment, ...clean } = a as Annotation & { onlyTextOrComment?: boolean };
        void onlyTextOrComment;
        const isNew = !annsRef.current.has(clean.id);
        if (isNew) newMark = true;
        const prev = annsRef.current.get(clean.id);
        let entry = prev ? { ...prev, ...clean } : clean;
        if (isNew && aiPenRef.current && !entry.aiThreadId) {
          const threadId = crypto.randomUUID();
          entry = { ...entry, aiThreadId: threadId };
          aiCreated = { annotation: entry, threadId };
        }
        annsRef.current.set(clean.id, entry);
      }
      persistAnnotations();
      syncTraceList();
      // A new mark is the only signal for the highlight trigger (docs/09): page
      // navigation is not, so the frontier only ever advances on a fresh mark.
      if (newMark) onMarkPrepTrigger();

      if (aiCreated) {
        // Persist the aiThreadId into the engine model, open the thread + bubble.
        // A chat mark has no page anchor and is never the engine's to draw.
        if (isPageMark(aiCreated.annotation)) viewRef.current?.setAnnotations([aiCreated.annotation]);
        const bookId = bookIdRef.current;
        // Drawn while the lesson is live: this is a side conversation off it
        // (docs/09), not an independent one. Everything else about the mark is
        // unchanged — it keeps its thread back-pointer and its place in the
        // trace list, and the bubble opens beside it exactly as it does with no
        // lesson running. With no lesson, nothing here changes at all: 19 of 23
        // of this reader's marked conversations happen hours or days from one.
        const lesson = currentCall();
        const parentThreadId = lesson?.isBook ? lesson.threadId : null;
        if (bookId && parentThreadId) {
          createAsideThread(bookId, aiCreated.threadId, {
            parentThreadId,
            annotationId: aiCreated.annotation.id,
          });
        } else if (bookId) {
          createThread(bookId, aiCreated.annotation.id, aiCreated.threadId);
        }
        const up = penUpRef.current;
        const rect = readerPaneRef.current?.getBoundingClientRect();
        const anchor = up
          ? { x: up.x, y: up.y }
          : { x: (rect?.left ?? 0) + (rect?.width ?? 480) / 2, y: (rect?.top ?? 0) + 240 };
        setPopup(null);
        // A brand-new thread has nothing stored: the bubble opens on the
        // opening intents and sends nothing until one is pressed (docs/03).
        openThreadCall(
          {
            threadId: aiCreated.threadId,
            annotationId: aiCreated.annotation.id,
            // Through asideFraming like every other door, so the span is the
            // one shape everywhere: one line, cut to the same length.
            // `parentView` is what the reader had the lesson in when they drew —
            // the corner card, in the flow this is for — and going back restores
            // it rather than putting chat over the page they were reading.
            ...(parentThreadId
              ? asideFramingFor(
                  { annotationId: aiCreated.annotation.id, parentThreadId },
                  lesson?.view,
                )
              : {}),
            view: "bubble",
            anchor,
          },
          [],
        );
      }
    },
    [
      annsRef,
      aiPenRef,
      penUpRef,
      asideFramingFor,
      bookIdRef,
      readerPaneRef,
      setPopup,
      viewRef,
      persistAnnotations,
      syncTraceList,
      openThreadCall,
      currentCall,
      onMarkPrepTrigger,
    ],
  );

  // The conversation a mark is a door into, when this device still has it
  // (reading/chat-marks.ts: markDoorThread). Every press on a mark asks here
  // first: annotations and threads sync as two files, so an id with no record
  // behind it is a door to nothing, and opening a call on it would make an empty
  // conversation the reader cannot get out of.
  const hasThread = useCallback(
    (threadId: string) => {
      const bookId = bookIdRef.current;
      return !!bookId && getThread(bookId, threadId) !== undefined;
    },
    [bookIdRef],
  );

  const markDoor = useCallback(
    (ann: { id: string; aiThreadId?: unknown } | null | undefined) => {
      const bookId = bookIdRef.current;
      const threadId = markDoorThread(ann, hasThread);
      const thread = bookId && threadId ? getThread(bookId, threadId) : undefined;
      return threadId && thread ? { threadId, thread } : null;
    },
    [hasThread, bookIdRef],
  );

  // Clicking a mark. The engine shares the shell's document, so the rect is
  // already in viewport coordinates. An AI-pen mark (has aiThreadId) opens its
  // call bubble with history instead of the annotation editor.
  const onSetAnnotationPopup = useCallback(
    (params?: AnnotationPopupParams) => {
      if (!params) {
        setPopup(null);
        return;
      }
      const [l, , r, bottom] = params.rect;
      const anchor = { x: (l + r) / 2, y: bottom };
      const ann = params.annotation;
      const door = markDoor(ann);
      if (door) {
        setPopup(null);
        reopenThreadCall(door.thread, { view: "bubble", anchor });
      } else {
        setPopup({ annotation: ann, anchor });
      }
    },
    [reopenThreadCall, markDoor, setPopup],
  );

  // A pen stroke on a reply (docs/09). The classroom's answers are the book
  // continued, so this writes the same kind of entry the page path writes, into
  // the same file — anchored on the message rather than on a page
  // (reading/chat-marks.ts) and never handed to the engine.
  //
  // The AI pen also opens the second level: a side conversation off the lesson,
  // on the words that were marked. It is written down at once rather than at the
  // first question, exactly as one drawn on the page is — the mark is a door
  // into it from the moment it exists.
  const drawChatMark = useCallback(
    (draw: ChatMarkDraw) => {
      const lesson = currentCall();
      if (!bookIdRef.current || !lesson) return;
      // What the aside would be about. Null when the AI pen was not the one
      // drawing, and when what it caught is too short to be a question — that
      // stroke is then an underline and nothing more, rather than a mark
      // pointing at a conversation that was never opened.
      // The stroke's words as a person reads them, which is not the string it is
      // found again by when it crossed a block (reading/chat-marks.ts:
      // chatMarkWords). The whole draw is spread into the mark rather than
      // copied field by field: the verbatim string, the copy of it and the
      // readable one travel together or the mark is anchored on one and shown
      // as another.
      const asideAnchor = draw.pen === "ai" ? asideAnchorAt(draw.messageTs, chatMarkWords(draw)) : null;
      const aiThreadId = asideAnchor ? crypto.randomUUID() : undefined;
      const mark = buildChatMark({
        ...draw,
        id: crypto.randomUUID(),
        color: draw.pen === "ai" ? AI_PEN_COLOR : penColor,
        threadId: lesson.threadId,
        ...(aiThreadId ? { aiThreadId } : {}),
      });
      if (!mark) return;
      annsRef.current.set(mark.id, mark);
      persistAnnotations();
      syncTraceList();
      // No prep trigger: that frontier is measured in pages and this mark is on
      // none (reading/prep/use-prep-trigger.ts skips a mark with no page).
      if (!asideAnchor || !aiThreadId) return;
      setPopup(null);
      // The same door the pen opens on the page, one level down: openChatAside
      // takes the isBook guard with it, so an AI pen that reached here inside a
      // side conversation opens nothing and the mark still stands.
      openChatAside(asideAnchor, { annotationId: mark.id, threadId: aiThreadId });
    },
    [penColor, persistAnnotations, syncTraceList, currentCall, openChatAside, annsRef, bookIdRef, setPopup],
  );

  // A press on a mark drawn on a reply. An AI-pen one is the door into the
  // conversation it opened, the same as on the page; the other two raise the
  // same editor a mark on the page raises, at the words that were pressed.
  const openChatMark = useCallback(
    (ann: Annotation, at: { x: number; y: number }) => {
      const door = markDoor(ann);
      if (!door) {
        // No conversation behind it, or none left on this device: the editor at
        // the words that were pressed, which is all such a mark has to show.
        setPopup({ annotation: ann, anchor: at });
        return;
      }
      setPopup(null);
      reopenThreadCall(door.thread, { view: "chat-main", anchor: at });
    },
    [reopenThreadCall, markDoor, setPopup],
  );

  // Trace-list click: jump to the mark. Programmatic select does not open the
  // popup (pitfall 04), which is what we want for a list jump.
  const onTraceSelect = useCallback(
    (id: string) => {
      const action = traceSelectAction(annsRef.current.get(id), hasThread);
      if (action.act === "mark") {
        // A classroom mark with nothing left to open: the row is the only place
        // those words are shown, so the drawer stays open around it. Closing it
        // would answer the press with an empty screen.
        setSelectedAnnId(id);
        return;
      }
      // Same as the outline jump: leaving the drawer open parks its backdrop
      // over the page we just navigated to, and the backdrop only answers a tap.
      setSidebarOpen(false);
      setSelectedAnnId(id);
      if (action.act === "page") {
        viewRef.current?.selectAnnotations([id]);
        viewRef.current?.navigate({ annotationID: id });
        return;
      }
      const bookId = bookIdRef.current;
      const thread = bookId ? getThread(bookId, action.threadId) : undefined;
      // The row is a door into the conversation the mark opened, or failing that
      // into the lesson it was drawn in — which is the book's own, and reopening
      // it as anything else takes the AI pen, the chips and the empty-state line
      // away from it (reading/reopen.ts).
      if (thread) reopenThreadCall(thread, { view: "chat-main", anchor: { x: 0, y: 0 } });
    },
    [reopenThreadCall, hasThread, annsRef, bookIdRef, setSelectedAnnId, setSidebarOpen, viewRef],
  );

  // Delete a mark from the trace list. This is the only way to get rid of an
  // AI-pen mark: tapping one on the page opens its conversation, so the
  // annotation editor's Delete never reaches it.
  //
  // The mark and its thread go together. The mark is the thread's only door —
  // tapping it on the page, or its sparkle in the trace list — so a thread left
  // behind is a conversation nothing can ever open again, syncing forever. That
  // is the same pairing the ✕'s delete already makes from the other end, and
  // both ends now go through the same one in the session: the threads file, the
  // turn, the staging and the event line are all keyed by thread id and none of
  // them is this file's. The mark goes through removeAnnotation like every other
  // deletion, so the annotations file, the in-memory map and sync stay in
  // agreement. What was distilled from the retell stays.
  const deleteTraceAnnotation = useCallback(
    (id: string) => {
      dropThread(id, annsRef.current.get(id)?.aiThreadId as string | undefined);
      removeAnnotation(id);
    },
    [dropThread, removeAnnotation, annsRef],
  );

  const openThreadForAnnotation = useCallback(
    (annotationId: string) => {
      const ann = annsRef.current.get(annotationId);
      const { jump, threadId } = markOpenAction(ann, hasThread);
      if (jump) {
        viewRef.current?.selectAnnotations([annotationId]);
        viewRef.current?.navigate({ annotationID: annotationId });
      }
      setSelectedAnnId(annotationId);
      // The conversation is gone: the row still shows the words that were
      // marked, and there is nothing to open beside them.
      if (!threadId) return;
      const bookId = bookIdRef.current;
      const thread = bookId ? getThread(bookId, threadId) : undefined;
      if (thread) reopenThreadCall(thread, { view: "chat-main", anchor: { x: 0, y: 0 } });
    },
    [reopenThreadCall, hasThread, annsRef, bookIdRef, setSelectedAnnId, viewRef],
  );

  // Jump the reading back to the thread's mark (from the reading corner card).
  // The book-level thread has no mark, so there is nothing to jump to.
  // A conversation anchored on a mark drawn on a reply has no place either: the
  // engine has never heard of that mark, and asking it to navigate names a page
  // that does not exist.
  const onPositionClick = useCallback(() => {
    const c = currentCall();
    if (!c || !c.annotationId) return;
    if (!isPageMark(annsRef.current.get(c.annotationId))) return;
    viewRef.current?.selectAnnotations([c.annotationId]);
    viewRef.current?.navigate({ annotationID: c.annotationId });
  }, [currentCall, annsRef, viewRef]);

  return {
    onSaveAnnotations,
    hasThread,
    onSetAnnotationPopup,
    drawChatMark,
    openChatMark,
    onTraceSelect,
    deleteTraceAnnotation,
    openThreadForAnnotation,
    onPositionClick,
  };
}
