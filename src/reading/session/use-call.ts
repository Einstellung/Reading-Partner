// The conversation with the AI about the book (docs/03), lifted out of App: the
// open call, the turns running on its threads, the images staged for its next
// send, and every way in and out of it. It renders nothing — the shell calls it
// and hands what it returns to CallBubble / CallView.
//
// Everything book-specific comes from the shell's refs rather than from props,
// the same way usePrep and useNotes take theirs: the open book's id, marks,
// text, figures and bytes are read at call time, so every callback here keeps a
// stable identity and a streaming reply never re-renders the reader.
//
// Two shapes stay the shell's, and are parameters here: a chat row, which the
// render layer's parts protocol owns, and a staged image, which is a loading
// placeholder or a ready preview. The session reads only what it wrote itself,
// so it is handed the constructors rather than the types.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { runAgentTurn, type ProviderId } from "../../ai/aiClient";
import type { CompressedImage } from "../../ai/image-utils";
import type { SubagentProgress } from "../../ai/subagent";
import { logEvent } from "../../platform/app/events";
import type { Annotation } from "../../platform/app/reader-contract";
import { toReasoning, type Settings } from "../../platform/app/settings";
import {
  appendMessage,
  deleteThread,
  getThread,
  patchThreadMessage,
  readThreadImages,
  saveThreadImages,
  setThreadFocusChapter,
  type PersistedCardPayload,
  type ThreadMessage,
} from "../../platform/app/threads";
import type { DiagramCardData } from "../diagrams/cards";
import type { Diagram } from "../diagrams/types";
import type { Fulltext } from "../../fulltext";
import { distillThread, type DistillAnnotation } from "../../observation";
import {
  applyRowChange,
  callReducer,
  type CallRow,
  type CallState,
  type CallView,
  type RowChange,
} from "../call-state";
import { toolStatusLabel } from "../context";
import { chapterByNumber, type TableChapter } from "../chapters";
import { loadChapterTable } from "../lecture";
import type { FiguresIndex } from "../figures";
import { createLiveTurns, type LiveTurn } from "../live-turns";
import { RESEARCH_TOOL_NAME, researchStatusLabel } from "../papers/research-agent";
import { deferHangup } from "./hangup";
import { createPendingImages, type StagedImage } from "../pending-images";
import type { PrepPipeline } from "../prep/papers/pipeline";
import {
  backgroundFailureToast,
  buildReadingTurn,
  turnFailureView,
  type ReadingTurnContext,
  type TurnFailure,
} from "../turn";

// A ref the shell owns and this hook only reads.
type HostRef<T> = { readonly current: T };

// What the composer renders with no call open. A constant, so hanging up twice
// does not hand React a second empty array.
const NO_IMAGES: never[] = [];

// How the shell builds the two shapes it owns. Each is one line there; the
// session never inspects either, it only puts them where they go.
export interface CallShapes<M extends CallRow, I extends StagedImage> {
  // Stored rows in display form. Image bytes are loaded separately, and stored
  // card parts come back as render parts.
  toDisplay(stored: ThreadMessage[]): M[];
  // A row the session wrote itself, widened to the surface's row type.
  newRow(row: CallRow): M;
  // How many images one conversation may stage, and what to say when a paste
  // goes over — the wording is UI copy.
  maxImages: number;
  imageLimitHint: string;
  // A staged image before and after its compression finishes.
  loadingImage(id: string): I;
  readyImage(id: string, image: CompressedImage): I;
  // The staged list as the send needs it, and null while any of them is still
  // compressing — the composer disables the button then too.
  sendableImages(staged: I[]): CompressedImage[] | null;
  // The card channel, for the tools that put a picture in the conversation
  // (docs/40). A card *part* belongs to the render layer's protocol
  // (ui/components/chat/chatParts), which this layer may not import, so the
  // shell supplies the three operations and the session decides when they
  // happen — the same split as newRow/toDisplay above. Absent on a surface with
  // no cards, and then the drawing tools are not mounted at all.
  cards?: {
    // A fresh, process-unique card id.
    id(prefix: string): string;
    // A standalone AI row carrying one diagram card.
    row(cardId: string, card: DiagramCardData, ts: number): M;
    // That row with the card's payload replaced.
    write(row: M, cardId: string, card: DiagramCardData): M;
  };
}

export interface CallHost<M extends CallRow, I extends StagedImage> extends CallShapes<M, I> {
  // The open book's id, null in the library. Re-read after every await.
  bookIdRef: HostRef<string | null>;
  ctxRef: HostRef<ReadingTurnContext>;
  settingsRef: HostRef<Settings>;
  annsRef: HostRef<Map<string, Annotation>>;
  currentFulltextRef: HostRef<Promise<Fulltext | null> | null>;
  currentFiguresRef: HostRef<Promise<FiguresIndex | null> | null>;
  bufferRef: HostRef<ArrayBuffer | null>;
  // The lesson-prep pipeline, read live: a tool invoked mid-turn sees the
  // pipeline the reader is on now.
  pipelineRef: HostRef<PrepPipeline | null>;
  pushToast(kind: "warn" | "error", message: string): void;
  // The open book's marks as distillation's silent-marks input (docs/02).
  distillAnnotations(): DistillAnnotation[];
  // Deleting a conversation takes its anchoring AI-pen mark with it, through the
  // shell's one deletion path so the file, the map and sync stay in agreement.
  removeMark(annotationId: string): void;
}

// A conversation about to be opened: everything but the rows, which come from
// the thread file.
export type OpeningCall<M extends CallRow> = Omit<CallState<M>, "messages">;

export interface CallController<M extends CallRow, I extends StagedImage> {
  call: CallState<M> | null;
  // The open call and its view, for the handlers that cannot read React state —
  // the reader pane's capture-phase pointerdown is one.
  current(): CallState<M> | null;
  view(): CallView | "none";

  // Open a thread's conversation: its history plus the reply still being
  // written, and the images it stored. Opening sends nothing — an empty thread
  // waits for the reader to pick an opening intent or type.
  openThread(call: OpeningCall<M>, stored: ThreadMessage[]): void;
  // Whether a reply is still being written on that thread. The observation
  // sweeps ask before they read a transcript.
  isAnswering(threadId: string): boolean;
  // Send what the composer holds, then answer it.
  send(text: string): void;
  // Ask again after a turn that failed.
  retry(): void;
  stop(): void;

  showChat(): void;
  showReading(): void;
  // The ✕, Escape: the view goes away, the thread stays on its mark.
  hangUp(): void;
  // Touching the book, which is the same thing on a tablet.
  dismissOnPaneTouch(): void;
  // The conversation is thrown away, mark and all.
  deleteOpenThread(): void;
  // A mark was deleted from the trace list: its thread's turn and staging go,
  // and the call goes too if it was the one open.
  dropThread(annotationId: string, threadId: string | undefined): void;

  // The reader stepped a staged diagram card to another step.
  stepDiagram(cardId: string, stage: number): void;

  // The open book's chapter table, or null when it has none worth using
  // (reading/lecture). The chapter chip is built from it, and it is what a
  // chapter number is resolved against.
  chapters: TableChapter[] | null;
  // The chapter the open conversation is parked on (docs/09), resolved. Null on
  // a mark-anchored thread, always: a mark's conversation can be asked to teach
  // a chapter without becoming a conversation about one.
  focusChapter: TableChapter | null;
  // Park the open conversation on a chapter, or clear it. The chip presses this
  // with the chapter the reader was scrolled into, which is the one moment the
  // scroll position decides anything (docs/09).
  setFocusChapter(chapter: number | null): void;

  // What opening and closing a book need (session/open-book.ts).
  captureHangup(): void;
  close(): void;
  discardStagedImages(): void;
  endBookTurns(bookId: string): void;

  // The composer's staging, for the conversation on screen.
  pendingImages: I[];
  imageHint: string;
  stageImage(threadId: string, produce: () => Promise<CompressedImage>): void;
  noteImageHint(threadId: string, hint: string): void;
  removePendingImage(id: string): void;
}

export function useCall<M extends CallRow, I extends StagedImage>(
  host: CallHost<M, I>,
): CallController<M, I> {
  const {
    annsRef,
    bookIdRef,
    bufferRef,
    ctxRef,
    currentFiguresRef,
    currentFulltextRef,
    distillAnnotations,
    pipelineRef,
    pushToast,
    removeMark,
    settingsRef,
  } = host;
  // The shapes the shell owns. It writes them as lambdas in the call, so they are
  // new objects on every render; the callbacks below read them through this ref
  // rather than depending on them, because a callback whose identity changed
  // every render would re-render the memoized reader pane on every keystroke.
  const shapes = useRef(host);
  shapes.current = host;

  // Which of the ways the call can change are allowed, and what each leaves
  // behind, are the reducer's (reading/call-state.ts).
  const [call, dispatch] = useReducer(callReducer<M>, null);
  const callRef = useRef<CallState<M> | null>(null);
  const callViewRef = useRef<CallView | "none">("none");

  // Turns still streaming, one per thread. Closing a bubble leaves its turn
  // running; only a deleted thread or a closed book cuts one off.
  const liveTurnsRef = useRef(createLiveTurns<M>());
  // Images pasted into the composer, awaiting send, keyed by thread so an unsent
  // image stays on its own conversation. The two states below are only what the
  // open thread renders.
  const pendingRef = useRef(createPendingImages<I>(host.maxImages));
  const [pendingImages, setPendingImages] = useState<I[]>(NO_IMAGES);
  const [imageHint, setImageHint] = useState("");

  useEffect(() => {
    callViewRef.current = call?.view ?? "none";
    callRef.current = call;
    // The composer shows the open conversation's own staging, and nothing when
    // no call is open. This runs on every call change, so switching threads and
    // hanging up both land here; the store hands back the same list identity
    // when nothing moved, so a streamed token does not re-render the composer.
    setPendingImages(call ? pendingRef.current.images(call.threadId) : NO_IMAGES);
    setImageHint(call ? pendingRef.current.hint(call.threadId) : "");
  }, [call]);

  // Push a thread's staging into what the composer renders. Every write goes
  // through here, and a write to a thread that is not the one on screen (a
  // compression landing after the user moved on) only updates the store.
  const showPending = useCallback((threadId: string) => {
    if (callRef.current?.threadId !== threadId) return;
    setPendingImages(pendingRef.current.images(threadId));
    setImageHint(pendingRef.current.hint(threadId));
  }, []);

  // The open book's chapters and the chapter this conversation is parked on
  // (docs/09). Held here rather than read at render because both come off disk:
  // the table from the book's outline / notes state / prep plan, the focus from
  // the thread file — which read_chapter also writes to, mid-turn, so the focus
  // is re-read whenever a turn settles as well as when a chip sets it.
  const [chapters, setChapters] = useState<TableChapter[] | null>(null);
  const chaptersRef = useRef<TableChapter[] | null>(null);
  chaptersRef.current = chapters;
  const [focusChapter, setFocusChapterState] = useState<TableChapter | null>(null);

  const syncFocusChapter = useCallback(() => {
    const bookId = bookIdRef.current;
    const c = callRef.current;
    if (!bookId || !c || c.isBook !== true) {
      setFocusChapterState(null);
      return;
    }
    const n = getThread(bookId, c.threadId)?.focusChapter ?? null;
    const table = chaptersRef.current;
    setFocusChapterState(n === null || !table ? null : chapterByNumber(table, n));
  }, [bookIdRef]);

  const openThreadId = call?.threadId ?? null;
  const openIsBook = call?.isBook === true;
  useEffect(() => {
    if (!openIsBook) {
      setChapters(null);
      setFocusChapterState(null);
      return;
    }
    let alive = true;
    void (async () => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const ft = (await currentFulltextRef.current) ?? null;
      const table = await loadChapterTable(
        bookId,
        ft,
        pipelineRef.current?.snapshot().state?.chapters ?? [],
      ).catch(() => null);
      if (!alive) return;
      chaptersRef.current = table;
      setChapters(table);
      syncFocusChapter();
    })();
    return () => {
      alive = false;
    };
  }, [openIsBook, openThreadId, bookIdRef, currentFulltextRef, pipelineRef, syncFocusChapter]);

  const setFocusChapter = useCallback(
    (chapter: number | null) => {
      const bookId = bookIdRef.current;
      const c = callRef.current;
      if (!bookId || !c || c.isBook !== true) return;
      setThreadFocusChapter(bookId, c.threadId, chapter);
      syncFocusChapter();
    },
    [bookIdRef, syncFocusChapter],
  );

  const noteImageHint = useCallback(
    (threadId: string, hint: string) => {
      pendingRef.current.setHint(threadId, hint);
      showPending(threadId);
    },
    [showPending],
  );

  // Stage an image for the next send on one thread: a placeholder shows
  // immediately, the async compression runs, then the ready preview swaps in (or
  // it is dropped, with a hint, on failure). Capped per conversation.
  const stageImage = useCallback(
    (threadId: string, produce: () => Promise<CompressedImage>) => {
      const pending = pendingRef.current;
      const id = crypto.randomUUID();
      if (!pending.add(threadId, shapes.current.loadingImage(id))) {
        noteImageHint(threadId, shapes.current.imageLimitHint);
        return;
      }
      showPending(threadId);
      produce().then(
        (img) => {
          pending.replace(threadId, id, shapes.current.readyImage(id, img));
          showPending(threadId);
        },
        (e) => {
          console.error("failed to process pasted image", e);
          pending.remove(threadId, id);
          noteImageHint(threadId, e instanceof Error ? e.message : "Couldn't process that image");
        },
      );
    },
    [showPending, noteImageHint],
  );

  const removePendingImage = useCallback(
    (id: string) => {
      const threadId = callRef.current?.threadId;
      if (!threadId) return;
      pendingRef.current.remove(threadId, id);
      showPending(threadId);
    },
    [showPending],
  );

  // Load a thread's stored images (filenames -> base64) and patch them into the
  // open call so the bubbles show them. Async so opening a thread stays instant.
  const hydrateThreadImages = useCallback((threadId: string, msgs: ThreadMessage[]) => {
    const withImages = msgs.filter((m) => m.images && m.images.length > 0);
    if (withImages.length === 0) return;
    void (async () => {
      const loaded = new Map<number, CompressedImage[]>();
      for (const m of withImages) {
        loaded.set(m.ts, await readThreadImages(threadId, m.images as string[]));
      }
      dispatch({ type: "images-loaded", threadId, images: loaded });
    })();
  }, []);

  // --- drawn diagrams (docs/40) ---------------------------------------------
  //
  // A diagram lives in the thread file and nowhere else. Every read goes back to
  // it rather than to a map kept alongside, and that is what makes the two cases
  // that matter work: update_diagram called in the turn *after* the one that
  // drew — which is every case it exists for, since "I still don't follow"
  // always arrives a turn later — and a thread reopened after a restart, where
  // the card comes back carrying the same id it was given.
  const findDiagramCard = useCallback(
    (bookId: string, threadId: string, cardId: string): { ts: number; card: DiagramCardData } | null => {
      for (const m of getThread(bookId, threadId)?.messages ?? []) {
        for (const part of m.parts ?? []) {
          if (part.type !== "card" || part.id !== cardId) continue;
          if (part.card.kind !== "diagram") continue;
          return { ts: m.ts, card: part.card as unknown as DiagramCardData };
        }
      }
      return null;
    },
    [],
  );

  // Put a diagram card on a thread: a new row when `at` is null, otherwise the
  // row at that timestamp rewritten. Both mirrors are written — the stored one
  // always, the one on screen only while that conversation is the open one, so a
  // diagram edited after the reader walked away is still right when they return.
  const writeDiagramCard = useCallback(
    (bookId: string, threadId: string, cardId: string, card: DiagramCardData, at: number | null) => {
      const cards = shapes.current.cards;
      if (!cards) return;
      const part = {
        type: "card" as const,
        id: cardId,
        card: card as unknown as PersistedCardPayload,
      };
      if (at === null) {
        const ts = Date.now();
        dispatch({ type: "row-inserted-before-last", threadId, row: cards.row(cardId, card, ts) });
        appendMessage(bookId, threadId, { role: "ai", text: "", ts, parts: [part] });
        return;
      }
      const row =
        callRef.current?.threadId === threadId
          ? callRef.current.messages.find((m) => m.ts === at && m.role === "ai")
          : undefined;
      if (row) dispatch({ type: "row-replaced", threadId, ts: at, row: cards.write(row, cardId, card) });
      patchThreadMessage(bookId, threadId, at, { parts: [part] });
    },
    [],
  );

  // The reader stepped a staged diagram. Persisted rather than held in the
  // component, so reopening the thread comes back to the step they had reached
  // instead of rewinding the build-up to its first frame.
  const stepDiagram = useCallback(
    (cardId: string, stage: number) => {
      const bookId = bookIdRef.current;
      const threadId = callRef.current?.threadId;
      if (!bookId || !threadId) return;
      const found = findDiagramCard(bookId, threadId, cardId);
      if (!found) return;
      const stages = found.card.diagram.stages?.length ?? 0;
      if (stages === 0) return;
      const next = Math.min(Math.max(Math.round(stage), 0), stages - 1);
      if (next === (found.card.stage ?? 0)) return;
      writeDiagramCard(bookId, threadId, cardId, { ...found.card, stage: next }, found.ts);
    },
    [bookIdRef, findDiagramCard, writeDiagramCard],
  );

  // Run one assistant turn for a thread: assemble the reading context, stream the
  // reply into the bubble, persist on done. Stable (reads refs). No-ops when no
  // provider is configured — the shell puts the Settings guidance where the
  // conversation would be, so nothing reaches this anyway.
  //
  // The turn belongs to its thread, not to the view: closing the bubble leaves it
  // running (docs/03) and every callback below writes through liveTurns, so the
  // row survives a bubble that stopped re-rendering.
  const runTurn = useCallback((threadId: string, annotationId: string) => {
    const bookId = bookIdRef.current;
    const s = settingsRef.current;
    if (!bookId || !s.defaultProviderId || !s.defaultModelId) return;
    const liveTurns = liveTurnsRef.current;
    const controller = new AbortController();

    // One change to the row, applied to both mirrors of it: the registry's copy,
    // which goes on being written after the bubble is closed, and the one on
    // screen, which is only there while the conversation is open.
    const write = (change: RowChange, ts: number, error?: boolean) => {
      liveTurns.patch(threadId, ts, (m) => applyRowChange(m, change));
      dispatch({ type: "row-changed", threadId, ts, change, error });
    };

    const onToolStart = (info: { name: string; args: Record<string, any> }, ts: number) =>
      write({ kind: "tool-start", name: info.name, label: toolStatusLabel(info.name, info.args) }, ts);
    const onToolEnd = (info: { name: string; isError: boolean }, ts: number) =>
      write({ kind: "tool-end", name: info.name, isError: info.isError }, ts);

    // A research sub-agent run, in the row the reader already has for the tool call
    // that started it (docs/25). One line, rewritten in place: not the sub-agent's
    // own tool calls, not its queries, not what it read.
    const onSubagentProgress = (progress: SubagentProgress, ts: number) =>
      write(
        { kind: "tool-label", name: RESEARCH_TOOL_NAME, label: researchStatusLabel(progress) },
        ts,
      );

    // A turn that ends without a reply. The row it leaves behind, whether a
    // toast goes up and whether Retry is offered all follow from which kind it
    // was (reading/turn.ts), so the refusal paths cannot pick up the error
    // path's red banner or its "couldn't reach the model".
    //
    // With the conversation closed there is no row to leave behind and no Retry
    // to press: the toast carries the whole failure, for every kind. The turn is
    // then gone — reopening the mark shows the thread as it was, and asking
    // again is the way back.
    const showFailure = (kind: TurnFailure, message: string, ts: number) => {
      const live = liveTurns.settle(threadId, controller);
      if (controller.signal.aborted) return; // deleted thread / closed book, not a failure
      const view = turnFailureView(kind, message);
      if (callRef.current?.threadId === threadId) {
        if (view.toast) pushToast("error", view.toast);
        write(
          view.as === "notice"
            ? { kind: "refusal", text: view.text }
            : { kind: "error", text: view.text },
          ts,
          view.retry,
        );
      } else {
        const marked = annsRef.current.get(annotationId)?.text;
        pushToast("error", backgroundFailureToast(kind, typeof marked === "string" ? marked : ""));
      }
      live?.onSettled?.();
    };

    const ann = annsRef.current.get(annotationId);
    const ts = Date.now();
    // Drawing (docs/40). The tools describe a diagram; putting it on screen and
    // keeping it there is this side's job — see writeDiagramCard above for why
    // the thread file, and not a map beside it, is where a diagram lives.
    const diagrams = shapes.current.cards
      ? {
          draw: (diagram: Diagram): string => {
            const cardId = shapes.current.cards!.id("diagram");
            writeDiagramCard(bookId, threadId, cardId, { kind: "diagram", diagram }, null);
            return cardId;
          },
          read: (id: string): Diagram | null =>
            findDiagramCard(bookId, threadId, id)?.card.diagram ?? null,
          update: (id: string, diagram: Diagram) => {
            const found = findDiagramCard(bookId, threadId, id);
            if (!found) return;
            // The step the reader had reached survives the edit, clamped: an
            // edit that cut the stages down must not leave the card pointing
            // past the end of the stepper.
            const stages = diagram.stages?.length ?? 0;
            const stage = stages > 0 ? Math.min(found.card.stage ?? 0, stages - 1) : undefined;
            writeDiagramCard(
              bookId,
              threadId,
              id,
              { kind: "diagram", diagram, ...(stage === undefined ? {} : { stage }) },
              found.ts,
            );
          },
        }
      : undefined;

    const streamingRow = shapes.current.newRow({ role: "ai", text: "", ts, streaming: true });
    liveTurns.start({ threadId, bookId, controller, message: streamingRow });
    dispatch({ type: "turn-started", threadId, row: streamingRow });

    void (async () => {
      // Assemble the live reading context and topic-scoped tools (M6). The
      // current book's extraction may still be running; await it so the AI can
      // see the page. Thread images (stored as filenames) are read back too.
      const currentFulltext = (await currentFulltextRef.current) ?? null;
      const figures = (await currentFiguresRef.current)?.figures ?? [];
      const turn = await buildReadingTurn({
        bookId,
        threadId,
        annotationId,
        annotation: ann,
        annotations: [...annsRef.current.values()],
        fulltext: currentFulltext,
        figures,
        buffer: bufferRef.current,
        context: ctxRef.current,
        settings: s,
        getPipeline: () => pipelineRef.current,
        distillAnnotations,
        signal: controller.signal,
        onSubagentProgress: (progress) => onSubagentProgress(progress, ts),
        diagrams,
      });
      if (!turn) {
        liveTurns.settle(threadId, controller); // aborted while reading history
        return;
      }
      // The turn could not be assembled small enough to leave the model room to
      // answer. Say so instead of sending it: an over-full request comes back one
      // token long with a normal `done` and no error (docs/pitfall/65), which
      // reads as a one-word reply. No Retry offered — the same inputs assemble
      // the same call, so there is nothing for a second press to change.
      if (turn.refusal) {
        showFailure("refusal", turn.refusal, ts);
        return;
      }

      void runAgentTurn({
        providerId: s.defaultProviderId as ProviderId,
        modelId: s.defaultModelId as string,
        systemPrompt: turn.systemPrompt,
        messages: turn.messages,
        tools: turn.tools,
        signal: controller.signal,
        reasoning: toReasoning(s.chatThinking),
        // Which prompt this turn was actually assembled with, not which mode the
        // toggle is in: the two diverge while a book is still being extracted.
        // One surface for every reading turn, whatever it was loaded with:
        // "classroom" was a surface and retiring it would have broken the
        // comparison with every line logged before today. How much of the book
        // went in is the second axis (docs/09).
        telemetry: { surface: "reading", inline: turn.inline, thread: threadId },
        onDelta: (chunk) => write({ kind: "delta", chunk }, ts),
        onToolStart: (info) => onToolStart(info, ts),
        onToolEnd: (info) => onToolEnd(info, ts),
        onDone: (full) => {
          const live = liveTurns.settle(threadId, controller);
          if (controller.signal.aborted) return; // stopTurn already kept the partial
          // The notice rides the displayed row only. Persisting it would replay it
          // next turn as if the model had written it, and it would then describe a
          // turn whose assembly no longer applies.
          write({ kind: "answer", text: full, ...(turn.notice ? { notice: turn.notice } : {}) }, ts);
          appendMessage(bookId, threadId, { role: "ai", text: full, ts });
          // read_chapter may have parked the conversation on a chapter while the
          // turn ran (docs/09); the status row is how the reader finds out.
          syncFocusChapter();
          // A hangup that happened mid-answer waited for this (see captureHangup):
          // distillation reads the thread file, which only now holds the reply.
          live?.onSettled?.();
        },
        onError: (message: string) => {
          if (!controller.signal.aborted) console.error("agent turn failed", message);
          showFailure("error", message, ts);
        },
        // The loop gave up mid-turn: the call outgrew the window, or it spent the
        // round cap fetching without answering. Shown like the refusal above,
        // because that is what it is.
        onRefusal: (message: string) => showFailure("refusal", message, ts),
      });
    })();
  }, [
    annsRef,
    bookIdRef,
    bufferRef,
    ctxRef,
    currentFiguresRef,
    currentFulltextRef,
    distillAnnotations,
    pipelineRef,
    pushToast,
    settingsRef,
    syncFocusChapter,
  ]);

  const openThread = useCallback(
    (opening: OpeningCall<M>, stored: ThreadMessage[]) => {
      const { threadId } = opening;
      // Thread history the way an opening view shows it: what the file holds,
      // plus the reply still being written if that thread has a turn running.
      // Reopening a mark mid-answer joins the stream where it is, instead of
      // showing nothing until the answer lands.
      const messages = liveTurnsRef.current.withLive(threadId, shapes.current.toDisplay(stored));
      dispatch({ type: "opened", call: { ...opening, messages } });
      hydrateThreadImages(threadId, stored);
      // An empty thread sends nothing (docs/03). Marking a passage says the
      // reader wants something here, not which thing, so the empty conversation
      // offers the opening intents (reading/intents.ts) and waits — one press is
      // an ordinary send from there on.
    },
    [hydrateThreadImages],
  );

  // Sending appends the user line (with any ready staged images, persisted to
  // disk) then streams the reply. Empty text with images is allowed; images
  // still compressing block the send (the composer disables it too).
  const send = useCallback(
    (text: string) => {
      const c = callRef.current;
      const bookId = bookIdRef.current;
      if (!c || !bookId) return;
      const pending = pendingRef.current;
      const staged = pending.images(c.threadId);
      const trimmed = text.trim();
      const images = shapes.current.sendableImages(staged);
      if (!images) return; // wait for compression
      if (!trimmed && images.length === 0) return;
      const ts = Date.now();
      // Only this conversation's staging goes; another thread's images are still
      // waiting for their own send.
      pending.take(c.threadId);
      showPending(c.threadId);
      void (async () => {
        let imageNames: string[] = [];
        if (images.length > 0) {
          try {
            imageNames = await saveThreadImages(c.threadId, images);
          } catch (e) {
            console.error("failed to persist pasted images", e);
            pushToast("warn", "Pasted image could not be saved");
            pending.restore(c.threadId, staged); // give them back so the send can be retried
            showPending(c.threadId);
            return;
          }
        }
        // Persist filenames; display the base64 we already have in hand.
        const persistMsg: ThreadMessage = {
          role: "user",
          text: trimmed,
          ts,
          ...(imageNames.length ? { images: imageNames } : {}),
        };
        appendMessage(bookId, c.threadId, persistMsg);
        const row = shapes.current.newRow({
          role: "user",
          text: trimmed,
          ts,
          ...(images.length ? { images } : {}),
        });
        dispatch({ type: "row-appended", threadId: c.threadId, row });
        runTurn(c.threadId, c.annotationId);
      })();
    },
    [bookIdRef, pushToast, runTurn, showPending],
  );

  const retry = useCallback(() => {
    const c = callRef.current;
    if (c) runTurn(c.threadId, c.annotationId);
  }, [runTurn]);

  // Keep what a cut-short turn wrote: the abort silences the agent (no
  // onDone/onError follows), so persisting the partial here is the only way it
  // survives. Nothing generated yet → nothing to keep. Returns the kept text.
  const keepPartial = useCallback((live: LiveTurn<M>) => {
    const partial = live.message.text.trim();
    if (partial) {
      appendMessage(live.bookId, live.threadId, { role: "ai", text: partial, ts: live.message.ts });
    }
    live.onSettled?.();
    return partial;
  }, []);

  // The stop button: end the open thread's turn, keeping the half sentence.
  const stop = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    const live = liveTurnsRef.current.stop(c.threadId);
    if (!live) return;
    const { ts } = live.message;
    const partial = keepPartial(live);
    // What it wrote stays as a finished row; a turn that wrote nothing leaves no
    // row behind at all.
    dispatch(
      partial
        ? { type: "row-changed", threadId: c.threadId, ts, change: { kind: "stopped", text: partial } }
        : { type: "row-dropped", threadId: c.threadId, ts },
    );
  }, [keepPartial]);

  const endBookTurns = useCallback(
    (bookId: string) => {
      for (const live of liveTurnsRef.current.stopBook(bookId)) keepPartial(live);
    },
    [keepPartial],
  );

  // Hangup bookkeeping (docs/02, docs/03): log the end of the conversation and
  // kick the silent observation distillation over its persisted transcript. Reads
  // refs so it is stable; no-ops when nothing is open. Distillation runs in the
  // background with no UI — the observations panel shows when it last ran.
  //
  // Hanging up mid-answer waits: the reply is still being written and the
  // transcript would be a half sentence, so the distillation is handed to the
  // turn and runs when it lands — and reads the thread file then (deferHangup).
  // The event is logged now — it is the hangup that happened now. The marks are
  // read now too: a deferred pass can land after the reader has moved to another
  // book, and annsRef would by then hold that book's marks — the wrong input,
  // and it would push the silent-marks cursor past them.
  const captureHangup = useCallback(() => {
    const c = callRef.current;
    const bookId = bookIdRef.current;
    const { topicId, topicName, fileName, pageIndex } = ctxRef.current;
    if (!c || !bookId || !topicId) return;
    logEvent(topicId, "call-end", { threadId: c.threadId, book: c.isBook ?? false });
    deferHangup({
      call: c,
      context: { topicId, topicName, bookId, bookName: fileName, pageIndex },
      annotation: annsRef.current.get(c.annotationId),
      annotations: distillAnnotations(),
      readStored: () => getThread(bookId, c.threadId)?.messages ?? [],
      whenSettled: (threadId, run) => liveTurnsRef.current.whenSettled(threadId, run),
      distill: (pass) => void distillThread(pass),
    });
  }, [annsRef, bookIdRef, ctxRef, distillAnnotations]);

  const close = useCallback(() => dispatch({ type: "closed" }), []);

  // The ✕ is one of several ways out (touching the book, opening another book,
  // closing the reader, Esc): the view goes away, the thread stays on its mark
  // (docs/03). An answer still being written is not interrupted — it finishes
  // into the thread file, and the mark shows it whole when it is next opened.
  // Images pasted but not sent stay on the thread, like the talk itself: this is
  // a way out of the view, not a way to throw the conversation away.
  const hangUp = useCallback(() => {
    captureHangup();
    dispatch({ type: "closed" });
  }, [captureHangup]);

  // Touching the book dismisses the bubble / chat corner card (docs/03).
  // chat-main is not dismissable this way (CallView covers the reader). AI-pen
  // draws and mark clicks fire this on pointerdown, then re-open on save/select.
  // A reply in flight is no reason to hold the bubble open: it keeps writing and
  // lands in the thread either way.
  //
  // This is a hangup, not a lesser dismissal: the conversation is over either
  // way, so it does the same bookkeeping the ✕ does. On a tablet it is the exit
  // that actually gets used.
  const dismissOnPaneTouch = useCallback(() => {
    if (callViewRef.current === "bubble" || callViewRef.current === "chat-pip") hangUp();
  }, [hangUp]);

  // Delete the open conversation. Destructive and confirmed at the button
  // (DeleteThreadButton's two-step). Removes the thread from its threads file and,
  // for a mark-anchored thread, its anchoring AI-pen mark too (the highlight and
  // its trace-list entry disappear); the book-level thread has no mark, so only
  // the thread goes. Both removals are in-file rewrites, so per-file LWW sync
  // carries them to other devices. Unlike a hangup this does not distill — the
  // talk is being thrown away — and anything already distilled from it stays.
  const deleteOpenThread = useCallback(() => {
    const c = callRef.current;
    const bookId = bookIdRef.current;
    if (!c || !bookId) return;
    // The one close that does stop the turn: the conversation it would land in
    // is being thrown away.
    liveTurnsRef.current.stop(c.threadId);
    deleteThread(bookId, c.threadId);
    if (!c.isBook && c.annotationId) removeMark(c.annotationId);
    const topicId = ctxRef.current.topicId;
    if (topicId) logEvent(topicId, "thread-delete", { threadId: c.threadId, book: c.isBook ?? false });
    // Nothing is left to send them to.
    pendingRef.current.clear(c.threadId);
    dispatch({ type: "closed" });
  }, [bookIdRef, ctxRef, removeMark]);

  // The other end of the same pairing: the mark is being deleted, so its thread
  // goes with it. A conversation open on that mark goes too — leaving the bubble
  // on screen over a mark that is gone reads as a bug even when it is not.
  const dropThread = useCallback(
    (annotationId: string, threadId: string | undefined) => {
      dispatch({ type: "closed-with-mark", annotationId });
      // The turn and the unsent images go with the thread wherever it was
      // started from.
      if (!threadId) return;
      liveTurnsRef.current.stop(threadId);
      pendingRef.current.clear(threadId);
    },
    [],
  );

  const discardStagedImages = useCallback(() => pendingRef.current.clearAll(), []);
  const showChat = useCallback(() => dispatch({ type: "chat-opened" }), []);
  const showReading = useCallback(() => dispatch({ type: "reading-uncovered" }), []);
  const current = useCallback(() => callRef.current, []);
  const isAnswering = useCallback((threadId: string) => liveTurnsRef.current.has(threadId), []);
  const view = useCallback(() => callViewRef.current, []);

  return {
    call,
    current,
    view,
    openThread,
    isAnswering,
    send,
    retry,
    stop,
    stepDiagram,
    chapters,
    focusChapter,
    setFocusChapter,
    showChat,
    showReading,
    hangUp,
    dismissOnPaneTouch,
    deleteOpenThread,
    dropThread,
    captureHangup,
    close,
    discardStagedImages,
    endBookTurns,
    pendingImages,
    imageHint,
    stageImage,
    noteImageHint,
    removePendingImage,
  };
}
