// The conversation with the AI about the book (docs/03), lifted out of App: the
// open call, the turns running on its threads, the images staged for its next
// send, and every way in and out of it. It renders nothing — the shell calls it
// and hands what it returns to CallBubble / CallView.
//
// Everything book-specific comes from the shell's refs rather than from props,
// the same way usePrep and useChapterSpine take theirs: the open book's id, marks,
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
  createAsideThread,
  deleteThreadTree,
  getThread,
  readThreadImages,
  saveThreadImages,
  setThreadFocusChapter,
  type AsideAnchor,
  type PersistedCardPayload,
  type Thread,
  type ThreadMessage,
} from "../../platform/app/threads";
import { asideReceipt, asideReturn, type AsideReturn } from "../aside";
import { hostMarkIds } from "../chat-marks";
import { markExcerpt, reopenCall } from "../reopen";
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
  // The card channel. A card *part* belongs to the render layer's protocol
  // (ui/components/chat/chatParts), which this layer may not import, so the
  // shell supplies the operation and the session decides when it happens — the
  // same split as newRow/toDisplay above. Absent on a surface with no cards.
  cards?: {
    // A fresh, process-unique card id.
    id(prefix: string): string;
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

// Where a door puts a conversation it reopens. `parentView` is the view the
// conversation this one came off was in, and only a door pressed while that one
// is on screen has it.
export interface ReopenAt {
  view: CallView;
  anchor: { x: number; y: number };
  parentView?: CallView;
}

export interface CallController<M extends CallRow, I extends StagedImage> {
  call: CallState<M> | null;
  // The open call and its view, for the handlers that cannot read React state —
  // the reader pane's capture-phase pointerdown is one.
  current(): CallState<M> | null;
  view(): CallView | "none";

  // Open a thread's conversation: its history plus the reply still being
  // written, and the images it stored. Opening sends nothing — an empty thread
  // waits for the reader to pick an opening intent or type.
  //
  // This is also every way out of an aside that is not a hangup, so it is where
  // the line an aside leaves on its parent is written.
  openThread(call: OpeningCall<M>, stored: ThreadMessage[]): void;
  // Open a conversation that already exists, as itself. The record says which
  // of the three kinds it is and what it is anchored on (reading/reopen.ts);
  // the door only says where on screen it opens.
  reopenThread(thread: Thread, at: ReopenAt): void;
  // Step out of the book-level conversation into a side one on a span of one of
  // its replies (docs/03). The aside replaces it in this one slot. No-op unless
  // the open call is the book-level one, which is what keeps asides one level
  // deep from this end.
  openChatAside(anchor: AsideAnchor, mark?: ChatAsideMark): void;
  // Back to the conversation this aside came off, reopened as itself. No-op when
  // the open call is not an aside.
  returnFromAside(): void;
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
  // A mark was deleted from the trace list, taking its conversation and every
  // aside off it: the threads go from the file, their turns and staging go, and
  // the call goes too if it was on any of them. The mark itself is the shell's,
  // which is mid-deletion when it calls this.
  dropThread(annotationId: string, threadId: string | undefined): void;

  // The chapter the open conversation is parked on (docs/09), resolved against
  // the book's chapter table. Null on a mark-anchored thread, always: a mark's
  // conversation can be asked to teach a chapter without becoming a
  // conversation about one.
  focusChapter: TableChapter | null;
  // Clear the chapter the open conversation is parked on, from the ✕ on the
  // status row. read_chapter is what writes one (docs/09).
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

// The mark an AI-pen stroke on a reply left behind, handed to openChatAside so
// the conversation it opens is anchored on it: the mark reopens it, and it is
// what the trace list and distillation see (docs/09).
export interface ChatAsideMark {
  annotationId: string;
  threadId: string;
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
  // The first thing the reader asked in a side conversation, recorded as they
  // press send rather than when it reaches the file. What the receipt names when
  // the file has not caught up yet (writeAsideReceipt); keyed by thread and
  // dropped with the thread.
  const firstAskRef = useRef(new Map<string, string>());

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
  // the table from the book's outline / spine state / prep plan, the focus from
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

  // The conversation an aside goes back to, with the record holding it. Null
  // when there is nowhere to go: no record under the parent link (deleted, here
  // or on another device), or a record that is itself an aside — which one level
  // deep says cannot happen and only a sync from a bad writer can produce.
  //
  // The receipt and the way back read this same answer, so a line is never left
  // on a conversation the reader is not returned to.
  const parentOf = useCallback(
    (c: CallState<M>): { parent: Thread; back: AsideReturn } | null => {
      const bookId = bookIdRef.current;
      if (!bookId || !c.aside) return null;
      const parent = getThread(bookId, c.aside.parentThreadId);
      if (!parent) return null;
      const back = asideReturn(parent);
      return back ? { parent, back } : null;
    },
    [bookIdRef],
  );

  // The line an aside leaves on the conversation it came off (docs/09): a chip
  // the reader sees in the lesson's transcript and a sentence the model reads on
  // its next turn, both taken from the aside's own first question. No second
  // model call, so closing an aside waits for nothing.
  //
  // Written to the parent's file, never to the screen: the reader either goes
  // back to the parent, which is reopened from that file a moment later, or they
  // hang up, and then there is no screen to write to. Idempotent — reopening an
  // aside from its chip and stepping back again must not restate it
  // (reading/aside.ts).
  const writeAsideReceipt = useCallback(
    (c: CallState<M>) => {
      const bookId = bookIdRef.current;
      if (!bookId || !c.aside) return;
      const to = parentOf(c);
      if (!to) return;
      // An aside with no record was never asked anything in and was never
      // written down (ensureAsideRecord). Nothing to report, and a chip would
      // point at a conversation that does not exist — which is also the answer
      // after the reader deletes the one they are in.
      const own = getThread(bookId, c.threadId);
      if (!own) return;
      // Normally the question comes off the file. But a send with an image
      // attached writes the image out before the message, and Back pressed
      // inside that window would leave a side conversation whose question is
      // real and whose parent says nothing was asked. What the reader pressed
      // send on is remembered as they press it, and stands in until the file
      // catches up.
      const remembered = firstAskRef.current.get(c.threadId);
      const asked = own.messages.some((m) => m.role === "user" && m.text.trim() !== "");
      const receipt = asideReceipt({
        threadId: c.threadId,
        span: c.aside.span,
        messages:
          asked || !remembered
            ? own.messages
            : [...own.messages, { role: "user" as const, text: remembered }],
        parent: to.parent.messages,
      });
      if (!receipt) return;
      appendMessage(bookId, to.parent.id, {
        role: "ai",
        text: receipt.text,
        ts: Date.now(),
        parts: [
          {
            type: "card",
            // The shell's card ids, like every other card this layer raises. The
            // fallback is for a surface with no card channel at all, where the
            // sentence still has to be written even though nothing will draw the
            // chip; one receipt per aside, so the aside's own id serves.
            id: shapes.current.cards?.id("aside") ?? `aside-${c.threadId}`,
            card: receipt.card as unknown as PersistedCardPayload,
          },
        ],
      });
    },
    [bookIdRef, parentOf],
  );

  const openThread = useCallback(
    (opening: OpeningCall<M>, stored: ThreadMessage[]) => {
      const { threadId } = opening;
      // Leaving an aside for another conversation — back to the lesson, the
      // top-bar button, a mark tapped on the page, the trace list. Every one of
      // them comes through here, so the receipt is written once, here, rather
      // than at each door (the ✕ and Escape are hangUp's).
      const leaving = callRef.current;
      if (leaving?.aside && leaving.threadId !== threadId) writeAsideReceipt(leaving);
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
    [hydrateThreadImages, writeAsideReceipt],
  );

  // Every door back into a conversation that already exists: a mark on the page,
  // a mark on a reply, a trace row, a receipt chip, the top bar's blackboard.
  // None of them decides what the conversation is — the record does.
  const reopenThread = useCallback(
    (thread: Thread, at: ReopenAt) => {
      const opening = reopenCall(thread, markExcerpt(annsRef.current.get(thread.annotationId)), at.parentView);
      openThread({ ...opening, view: at.view, anchor: at.anchor }, thread.messages);
    },
    [annsRef, openThread],
  );

  // Step out of the lesson onto a span of one of its replies (docs/03).
  //
  // Nothing is written down here. A conversation pulled out of a reply has no
  // mark and no place in the trace list, so one the reader asked nothing in
  // could never be reached again — and it would still be in the book's threads
  // file forever, enumerated by every later pass over it (getOrphanAsides, the
  // distillation arrears sweep). A tap on the control that was not meant, or was
  // thought better of, costs nothing at all; the record arrives with the first
  // question (ensureAsideRecord).
  const openChatAside = useCallback(
    (anchor: AsideAnchor, mark?: ChatAsideMark) => {
      const c = callRef.current;
      // Only off the lesson. An aside off an aside is the one thing this shape
      // does not do, and a mark's conversation is not what this opens from.
      if (!c || c.isBook !== true) return;
      const bookId = bookIdRef.current;
      // Drawn with the AI pen (docs/09), so it left a mark on the reply. The
      // record is written now rather than at the first question, because the
      // mark is a door into this conversation from the moment it exists — the
      // same reason one drawn on the page is written when it is drawn.
      if (mark && bookId) {
        createAsideThread(bookId, mark.threadId, {
          parentThreadId: c.threadId,
          annotationId: mark.annotationId,
          asideAnchor: anchor,
        });
      }
      openThread(
        {
          threadId: mark ? mark.threadId : crypto.randomUUID(),
          // A span selected with no pen leaves nothing behind; one the AI pen
          // drew is anchored on its mark as well as on the words.
          annotationId: mark ? mark.annotationId : "",
          aside: {
            parentThreadId: c.threadId,
            from: "chat",
            span: anchor.text,
            anchor,
            parentView: c.view,
          },
          view: "chat-main",
          anchor: { x: 0, y: 0 },
        },
        [],
      );
    },
    [openThread, bookIdRef],
  );

  // A side conversation is written down the first time the reader asks something
  // in it. One drawn on the page is written down when it is drawn instead
  // (App.tsx: onSaveAnnotations) — its mark is a door into it from that moment,
  // and the mark carries the thread id.
  const ensureAsideRecord = useCallback(
    (c: CallState<M>) => {
      const bookId = bookIdRef.current;
      if (!bookId || c.aside?.from !== "chat" || !c.aside.anchor) return;
      if (getThread(bookId, c.threadId)) return;
      createAsideThread(bookId, c.threadId, {
        parentThreadId: c.aside.parentThreadId,
        asideAnchor: c.aside.anchor,
      });
    },
    [bookIdRef],
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
      // Both before the await below, because both are what the reader just did:
      // the side conversation they are asking in becomes a record now, and what
      // they asked is remembered now, so a Back pressed while the images are
      // being written out still finds a conversation with a question in it.
      ensureAsideRecord(c);
      if (c.aside && trimmed && !firstAskRef.current.has(c.threadId)) {
        firstAskRef.current.set(c.threadId, trimmed);
      }
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
    [bookIdRef, ensureAsideRecord, pushToast, runTurn, showPending],
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
    if (!c || !bookId) return;
    // A side conversation ended rather than stepped out of still leaves its line
    // on the one it came off — the ✕, Escape, touching the book, closing the
    // reader, opening another book. Every one of those is this, and stepping out
    // is openThread's; between them there is no way to leave an aside that
    // writes nothing.
    //
    // Above the topic check, not below it: the line is part of the conversation,
    // where the log and the distillation below are things a topic owns, and a
    // book can be open without one (the vestibule opens it without entering it).
    if (c.aside) writeAsideReceipt(c);
    if (!topicId) return;
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
  }, [annsRef, bookIdRef, ctxRef, distillAnnotations, writeAsideReceipt]);

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

  // Reopen the conversation an aside came off, in the view it was left in: a
  // lesson the reader had shrunk to the corner card so they could read the page
  // comes back as the corner card, not as chat over the page they were reading.
  // False when there was nowhere to go.
  //
  // The parent's history is re-read here rather than taken from anything held
  // alongside, so a line just written to it is in what the reader lands on.
  const openParent = useCallback(
    (c: CallState<M>): boolean => {
      const to = parentOf(c);
      if (!to) return false;
      openThread(
        {
          threadId: to.back.threadId,
          annotationId: to.back.annotationId,
          ...(to.back.isBook ? { isBook: true } : {}),
          view: c.aside?.parentView ?? "chat-main",
          anchor: { x: 0, y: 0 },
        },
        to.parent.messages,
      );
      return true;
    },
    [openThread, parentOf],
  );

  // Back to the lesson.
  //
  // The line goes on first, before the parent is read: read first and the
  // receipt would only appear the next time the lesson was opened. openThread
  // writes it for every other way out and finds it already there, so this is not
  // a second one.
  const returnFromAside = useCallback(() => {
    const c = callRef.current;
    if (!c?.aside) return;
    writeAsideReceipt(c);
    if (openParent(c)) return;
    // The conversation this hangs off was deleted, here or on another device.
    // There is nowhere to go back to, so this becomes the ordinary way out.
    pushToast("warn", "The conversation this came off is gone.");
    hangUp();
  }, [hangUp, openParent, pushToast, writeAsideReceipt]);

  // Touching the book dismisses the bubble / chat corner card (docs/03).
  // chat-main is not dismissable this way (CallView covers the reader). AI-pen
  // draws and mark clicks fire this on pointerdown, then re-open on save/select.
  // A reply in flight is no reason to hold the bubble open: it keeps writing and
  // lands in the thread either way.
  //
  // This is a hangup, not a lesser dismissal: the conversation is over either
  // way, so it does the same bookkeeping the ✕ does. On a tablet it is the exit
  // that actually gets used.
  //
  // Except under the lesson (docs/09). With a book-level conversation live the
  // reader may read, scroll and mark the page without ending it, so the pen no
  // longer reaches its bubble through a hangup: what it draws becomes an aside
  // of the lesson, and the `opened` that carries it replaces the call directly
  // (App.tsx: onSaveAnnotations). A mark tapped while the lesson is up replaces
  // it the same way, which is what the trace list and the top-bar button have
  // always done.
  const dismissOnPaneTouch = useCallback(() => {
    if (callRef.current?.isBook) return;
    if (callViewRef.current === "bubble" || callViewRef.current === "chat-pip") hangUp();
  }, [hangUp]);

  // The AI-pen mark on the page hosting each of these conversations, where there
  // is one. A mark is its conversation's only door, so a mark left behind by a
  // deleted thread opens nothing — which is the same pairing, read from the
  // other end, that takes a thread with its mark. Which marks that pairing
  // reaches, and why a mark drawn on a reply is not one of them, is
  // reading/chat-marks.ts's.
  const marksOf = useCallback(
    (threadIds: readonly string[]): string[] => hostMarkIds(annsRef.current.values(), threadIds),
    [annsRef],
  );

  // Everything this hook keys by thread id, let go for a conversation that has
  // gone: the turn writing into it, the images staged for it, the question
  // remembered for its receipt. The delete itself is one call on the store,
  // which takes the asides off the thread with it (platform/app/threads.ts).
  // Answers with every id that went.
  //
  // The store names none when it never held the thread — the book's threads file
  // failed to load and the reader was told so (session/open-book.ts) — and a
  // turn started before that still has to be stopped, so the named thread is in
  // the answer either way. Both delete paths come through here, so neither can
  // have that guard while the other does not.
  const releaseThreads = useCallback(
    (bookId: string, threadId: string): string[] => {
      const removed = deleteThreadTree(bookId, threadId);
      const gone = removed.length > 0 ? removed : [threadId];
      const topicId = ctxRef.current.topicId;
      for (const id of gone) {
        // The one close that does stop the turn: the conversation it would land
        // in is being thrown away.
        liveTurnsRef.current.stop(id);
        // Nothing is left to send them to, and nothing left to report about
        // them: a remembered question would otherwise leave a chip pointing at a
        // conversation that has just gone.
        pendingRef.current.clear(id);
        firstAskRef.current.delete(id);
        if (topicId) logEvent(topicId, "thread-delete", { threadId: id, book: false });
      }
      return gone;
    },
    [ctxRef],
  );

  // Where the reader lands when the conversation on screen has been deleted: back
  // in the one it came off, if it was a side conversation and that one survived —
  // that one was never what they threw away — and otherwise out of the call. No
  // receipt: the talk is being discarded, and there is nothing left to report.
  const closeAfterDelete = useCallback(
    (c: CallState<M>) => {
      if (c.aside && openParent(c)) return;
      dispatch({ type: "closed" });
    },
    [openParent],
  );

  // Delete the open conversation and the asides off it. Destructive and confirmed
  // at the button (DeleteThreadButton's two-step). Removes the threads from the
  // book's threads file and, for each that a mark on the page hosts, that mark
  // too (the highlight and its trace-list entry disappear); the book-level
  // thread has no mark of its own, but an aside drawn on the page while it ran
  // does. Marks drawn on the replies stay: they are the reader's on the book,
  // not the conversation's (reading/chat-marks.ts: hostMarkIds). Both
  // removals are in-file rewrites, so per-file LWW sync carries them to other
  // devices. Unlike a hangup this does not distill — the talk is being thrown
  // away — and anything already distilled from it stays.
  const deleteOpenThread = useCallback(() => {
    const c = callRef.current;
    const bookId = bookIdRef.current;
    if (!c || !bookId) return;
    for (const mark of marksOf(releaseThreads(bookId, c.threadId))) removeMark(mark);
    closeAfterDelete(c);
  }, [bookIdRef, closeAfterDelete, marksOf, releaseThreads, removeMark]);

  // The other end of the same pairing: the mark is being deleted from the trace
  // list, so its conversation goes with it, and so do the asides off that
  // conversation. A conversation open on any of them goes too — leaving the
  // bubble on screen over a mark that is gone reads as a bug even when it is
  // not, and one left open on a record that has been deleted has nowhere to
  // write.
  //
  // The mark that started this is the shell's to remove, being mid-deletion
  // there; a mark on any other thread this took is left pointing at nothing, so
  // it goes from here.
  const dropThread = useCallback(
    (annotationId: string, threadId: string | undefined) => {
      const bookId = bookIdRef.current;
      const gone = bookId && threadId ? releaseThreads(bookId, threadId) : [];
      const open = callRef.current;
      // Matched by id, not only by mark: a side conversation pulled out of a
      // reply carries no mark of its own and the mark test would not reach it.
      if (open && gone.includes(open.threadId)) closeAfterDelete(open);
      else dispatch({ type: "closed-with-mark", annotationId });
      for (const mark of marksOf(gone)) if (mark !== annotationId) removeMark(mark);
    },
    [bookIdRef, closeAfterDelete, marksOf, releaseThreads, removeMark],
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
    reopenThread,
    openChatAside,
    returnFromAside,
    isAnswering,
    send,
    retry,
    stop,
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
