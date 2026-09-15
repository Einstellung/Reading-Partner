// The marks on the open book, lifted out of App: the map every callback reads,
// the trace list the drawer draws, the annotation popup, and the writes that
// keep the three in agreement. It renders nothing — the shell calls it and
// hands what it returns to the reader pane, the drawer and the popup.
//
// Everything book-specific comes from the shell's refs rather than from props,
// the same way useCall takes its: the open book's id and the engine's view are
// read at call time, so every callback here keeps a stable identity and a
// streaming reply never re-renders the reader.
//
// What a mark is a door into — the conversations it opens — is the other half
// (use-mark-doors.ts), which needs the call and so is called after it. This one
// is called before, because the call reads the map.

import { useCallback, useRef, useState } from "react";
import {
  deleteAnnotations,
  peekAnnotations,
  saveAnnotations,
} from "../../platform/app/annotations";
import { isPageMark, type Annotation, type ViewInstance } from "../../platform/app/reader-contract";
import type { Thread } from "../../platform/app/threads";
import { toDistillAnnotations, type DistillAnnotation } from "../../memory";
import { asideFraming } from "../aside";
import type { CallRow, CallState, CallView } from "../call-state";
import { orderTraceMarks } from "../chat-marks";
import { markExcerpt } from "../reopen";
import { marksOfDocument, withMark } from "./documents";

// A ref the shell owns and this hook only reads.
type HostRef<T> = { readonly current: T };

// The AI pen maps to the engine's underline tool in a fixed purple (the palette's
// Purple). Owning this one color for the AI pen is a v1 implementation
// convenience, not a semantic in the color palette; the host identifies AI-pen
// strokes by the active tool, not the color.
export const AI_PEN_COLOR = "#a28ae5";

export interface PopupState {
  annotation: Annotation;
  anchor: { x: number; y: number };
}

// The part of a thread record that says whether it is a side conversation and
// what of. Narrow, so a conversation being created can be framed before it has a
// record of its own.
export type AsideThread = Pick<Thread, "annotationId" | "book" | "parentThreadId" | "asideAnchor">;

export interface MarksHost {
  // The engine, once it is up: what draws a mark and jumps to one.
  viewRef: HostRef<ViewInstance | null>;
  // The open book's id, null in the library. Every write is keyed by it.
  docIdRef: HostRef<string | null>;
}

export interface MarkStore {
  // Annotations for the open document, keyed by id for merge-on-save.
  annsRef: HostRef<Map<string, Annotation>>;
  // Whether the active pen is the AI pen (host-owned; not inferred from color).
  // Written by use-mark-doors, which is where the tool reaches.
  aiPenRef: { current: boolean };
  // Last pen-lift position over the reader pane (viewport coordinates) — the
  // AI-pen bubble anchor, since drawing a pen stroke yields no popup coordinates.
  penUpRef: HostRef<{ x: number; y: number } | null>;

  // The drawer's list, the row it has selected, and the annotation editor.
  traceAnns: Annotation[];
  selectedAnnId: string | null;
  popup: PopupState | null;
  setSelectedAnnId(id: string | null): void;
  setPopup(popup: PopupState | null | ((prev: PopupState | null) => PopupState | null)): void;

  // Rebuild the drawer's list from the map, and write the map back to disk.
  syncTraceList(): void;
  persistAnnotations(): void;
  removeAnnotation(id: string): void;
  distillAnnotations(): DistillAnnotation[];
  asideFramingFor(
    thread: AsideThread | undefined,
    parentView?: CallView,
  ): Pick<CallState<CallRow>, "aside">;
  patchAnnotation(id: string, patch: Partial<Annotation>): void;
  // Write a mark drawn on a reply into the file of the conversation it is on,
  // which is not this document's when a supplement is on screen (docs/67).
  persistChatMark(mark: Annotation, home: string | null): void;
  onPanePointerUp(e: React.PointerEvent): void;
  onDeleteAnnotations(ids: string[]): void;
  // Every mark of the book that was just opened (session/open-book.ts).
  showMarks(marks: Annotation[]): void;
}

export function useMarks({ viewRef, docIdRef }: MarksHost): MarkStore {
  const annsRef = useRef<Map<string, Annotation>>(new Map());
  // Marks in the map above that belong in another document's file: a mark drawn
  // on a reply of the book's lesson while a supplement is on screen. Id to the
  // file it was written to, so a delete reaches the same one. Emptied whenever a
  // document is opened, which is when the map itself is replaced.
  const elsewhereRef = useRef<Map<string, string>>(new Map());
  const aiPenRef = useRef(false);
  const penUpRef = useRef<{ x: number; y: number } | null>(null);

  const [popup, setPopup] = useState<PopupState | null>(null);
  const [traceAnns, setTraceAnns] = useState<Annotation[]>([]);
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);

  // Page marks first, classroom marks after (reading/chat-marks.ts).
  const syncTraceList = useCallback(() => {
    setTraceAnns(orderTraceMarks([...annsRef.current.values()]));
  }, []);

  const persistAnnotations = useCallback(() => {
    const docId = docIdRef.current;
    if (docId) {
      saveAnnotations(docId, marksOfDocument([...annsRef.current.values()], elsewhereRef.current));
    }
  }, [docIdRef]);

  // A mark on a reply goes to the file of the conversation it was drawn in, not
  // to the file of the page underneath it: come back to the book and the marks
  // on its lesson are still there, whichever document was on screen when they
  // were drawn. The file being written to is one this session does not hold, so
  // what it already has is read back and the mark merged into it.
  const persistChatMark = useCallback(
    (mark: Annotation, home: string | null) => {
      const docId = docIdRef.current;
      annsRef.current.set(mark.id, mark);
      if (!home || home === docId) {
        persistAnnotations();
        return;
      }
      elsewhereRef.current.set(mark.id, home);
      persistAnnotations();
      void peekAnnotations(home)
        .then((existing) => saveAnnotations(home, withMark(existing, mark)))
        .catch((e) => console.error("failed to save a mark on a reply", e));
    },
    [docIdRef, persistAnnotations],
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      viewRef.current?.unsetAnnotations([id]);
      annsRef.current.delete(id);
      const docId = elsewhereRef.current.get(id) ?? docIdRef.current;
      elsewhereRef.current.delete(id);
      if (docId) deleteAnnotations(docId, [id]);
      syncTraceList();
      setPopup(null);
    },
    [syncTraceList, viewRef, docIdRef],
  );

  // The open book's marks for distillation's silent-marks input (docs/02 part 2):
  // id, page, selected text, note, and creation time (from the engine's ISO
  // dateCreated) so the "since last distillation" filter can work.
  const distillAnnotations = useCallback((): DistillAnnotation[] => {
    return toDistillAnnotations([...annsRef.current.values()]);
  }, []);

  // How a thread opens as a call when it is a side conversation (docs/03): the
  // way back and the span it was opened on. Undefined for every other thread,
  // which spreads into the call as nothing at all. A drawn aside's span is its
  // mark's text, which lives on the annotation and not on the record, so it is
  // read here.
  //
  // `parentView` is the view the conversation it came off is in, where that is
  // known — drawing a mark mid-lesson knows it. Reopening one from its chip or
  // from its mark days later does not, and the default puts the reader back in
  // the full window.
  const asideFramingFor = useCallback(
    (thread: AsideThread | undefined, parentView?: CallView): Pick<CallState<CallRow>, "aside"> => {
      if (!thread) return {};
      const framing = asideFraming(thread, markExcerpt(annsRef.current.get(thread.annotationId)));
      return framing ? { aside: { ...framing, ...(parentView ? { parentView } : {}) } } : {};
    },
    [],
  );

  // Host-side edit of an existing annotation: patch, re-render, persist.
  const patchAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      const prev = annsRef.current.get(id);
      if (!prev) return;
      const updated: Annotation = { ...prev, ...patch, dateModified: new Date().toISOString() };
      annsRef.current.set(id, updated);
      if (isPageMark(updated)) viewRef.current?.setAnnotations([updated]);
      persistAnnotations();
      syncTraceList();
      setPopup((p) => (p && p.annotation.id === id ? { ...p, annotation: updated } : p));
    },
    [persistAnnotations, syncTraceList, viewRef],
  );

  // The pen stroke gives the host no coordinates, so track the last pen-lift
  // over the reader pane as the AI-pen bubble anchor (capture phase, so nothing
  // inside the engine can swallow it).
  const onPanePointerUp = useCallback((e: React.PointerEvent) => {
    penUpRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onDeleteAnnotations = useCallback(
    (ids: string[]) => {
      for (const id of ids) annsRef.current.delete(id);
      // Each one from the file it was written to: a mark on a reply of the
      // book's lesson is in the book's, whatever is on screen (docs/67).
      const here: string[] = [];
      for (const id of ids) {
        const home = elsewhereRef.current.get(id);
        if (home === undefined) here.push(id);
        else {
          elsewhereRef.current.delete(id);
          deleteAnnotations(home, [id]);
        }
      }
      const docId = docIdRef.current;
      if (docId && here.length > 0) deleteAnnotations(docId, here);
      syncTraceList();
    },
    [syncTraceList, docIdRef],
  );

  const showMarks = useCallback((marks: Annotation[]) => {
    // Every mark of the book, both kinds: the map is what gets written back
    // and what the trace list is built from. Only the engine's copy is
    // filtered, and that happens where the reader is mounted (open-book.ts).
    annsRef.current = new Map(marks.map((a) => [a.id, a]));
    elsewhereRef.current = new Map();
    setTraceAnns(orderTraceMarks(marks));
  }, []);

  return {
    annsRef,
    aiPenRef,
    penUpRef,
    traceAnns,
    selectedAnnId,
    popup,
    setSelectedAnnId,
    setPopup,
    syncTraceList,
    persistAnnotations,
    persistChatMark,
    removeAnnotation,
    distillAnnotations,
    asideFramingFor,
    patchAnnotation,
    onPanePointerUp,
    onDeleteAnnotations,
    showMarks,
  };
}
