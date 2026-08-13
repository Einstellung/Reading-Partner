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
  readThreadImages,
  saveThreadImages,
  type ThreadMessage,
} from "../../platform/app/threads";
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
import type { FiguresIndex } from "../figures";
import { createLiveTurns, type LiveTurn } from "../live-turns";
import { RESEARCH_TOOL_NAME, researchStatusLabel } from "../papers/research-agent";
import { hangupPass } from "./hangup";
import { createPendingImages, type StagedImage } from "../pending-images";
import type { PrepPipeline } from "../prep/pipeline";
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
  // Classroom mode and the lesson-prep pipeline, both read live: a tool invoked
  // mid-turn sees the pipeline the reader is on now.
  classroomRef: HostRef<boolean>;
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
  // written, the images it stored, and the first turn when the thread is empty
  // and nothing is already answering it.
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
    classroomRef,
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
  // reply into the bubble, persist on done. Stable (reads refs). No-ops (leaving
  // the bubble empty for the guidance) when no provider is configured.
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
        classroom: classroomRef.current,
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
    classroomRef,
    ctxRef,
    currentFiguresRef,
    currentFulltextRef,
    distillAnnotations,
    pipelineRef,
    pushToast,
    settingsRef,
  ]);

  const openThread = useCallback(
    (opening: OpeningCall<M>, stored: ThreadMessage[]) => {
      const { threadId, annotationId } = opening;
      // Thread history the way an opening view shows it: what the file holds,
      // plus the reply still being written if that thread has a turn running.
      // Reopening a mark mid-answer joins the stream where it is, instead of
      // showing nothing until the answer lands.
      const messages = liveTurnsRef.current.withLive(threadId, shapes.current.toDisplay(stored));
      dispatch({ type: "opened", call: { ...opening, messages } });
      hydrateThreadImages(threadId, stored);
      // An empty thread nothing is already answering explains itself (docs/03).
      // If no provider is configured, runTurn no-ops and the empty bubble shows
      // the guidance.
      if (stored.length === 0 && !liveTurnsRef.current.has(threadId)) runTurn(threadId, annotationId);
    },
    [hydrateThreadImages, runTurn],
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
  // turn and runs when it lands. The event is logged now — it is the hangup that
  // happened now. The marks are read now too: a deferred pass can land after the
  // reader has moved to another book, and annsRef would by then hold that book's
  // marks — the wrong input, and it would push the silent-marks cursor past them.
  const captureHangup = useCallback(() => {
    const c = callRef.current;
    const bookId = bookIdRef.current;
    const { topicId, topicName, fileName, pageIndex } = ctxRef.current;
    if (!c || !bookId || !topicId) return;
    logEvent(topicId, "call-end", { threadId: c.threadId, book: c.isBook ?? false });
    const pass = hangupPass({
      call: c,
      context: { topicId, topicName, bookId, bookName: fileName, pageIndex },
      annotation: annsRef.current.get(c.annotationId),
      stored: getThread(bookId, c.threadId)?.messages ?? [],
      annotations: distillAnnotations(),
    });
    const distill = () => void distillThread(pass);
    if (!liveTurnsRef.current.whenSettled(c.threadId, distill)) distill();
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
