// The lesson, as live state (docs/74): the paper opened, the book-level thread
// found, and one turn at a time streaming into it.
//
// Small on purpose. A lesson is a book-level conversation with no reader under
// it, so none of what makes the desk's use-call.ts long is here — no marks, no
// page images, no prep, no pip cards, no supplement plumbing. What is left is
// the shape the info call has: assemble, stream, persist.
//
// Nothing here writes the chapter focus. read_chapter writes it into the thread
// (reading/desk.ts onFocus) and this hook reads it back, which is why a tap on
// the chapter sheet sends a sentence rather than setting a number.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProviderId } from "../../../ai";
import { runAgentTurn } from "../../../legion/execute/turn";
import {
  appendMessage,
  getBookThread,
  getThread,
  loadThreads,
} from "../../../platform/app/threads";
import { loadSettings, toReasoning, type Settings } from "../../../platform/app/settings";
import type { Fulltext } from "../../../fulltext/types";
import type { TableChapter } from "../../../reading/chapters";
import { lessonOpening } from "../../../reading/lesson/opening";
import { LessonOpenError, openPhonePdf, phonePdfIo } from "../../../reading/lesson/open-pdf";
import { noTextStatus } from "../../../reading/lesson/status";
import {
  lastCitedPage,
  lessonResumed,
  taughtChapters,
} from "../../../reading/lesson/thread-state";
import { chapterOfReadChapterLabel } from "../../../reading/lecture/tools";
import { resolveBookThread } from "../../../reading/session/book-thread";
import { buildReadingTurn } from "../../../reading/turn/turn";
import { soulHarness } from "../../../soul";
import { rehydrateMessage } from "../chat/chatParts";
import type { ThreadMessage } from "../chat/types";
import { useStreamingTurn } from "../chat/useStreamingTurn";
import type { LessonFocus } from "./lesson-view";

const NO_CHAPTERS: ReadonlySet<number> = new Set<number>();

// Said where the focus line goes, like every other thing that has gone wrong on
// the way into a lesson (reading/lesson/status.ts).
const NO_PROVIDER = "Configure a provider in Settings and this paper can be taught.";
const NO_THREAD = "This paper's conversation could not be read on this device.";

export interface LessonBook {
  bookId: string;
  // What the top bar calls it, and what the prompt calls the file.
  title: string;
  topicId: string;
  topicName: string;
  // The conversation to run, when it is not the book's own: an aside off the
  // lesson (use-lesson-aside.ts). Absent = the lesson itself, which is the
  // book-level thread.
  threadId?: string;
  // How that conversation is written down, for one that is not yet: an aside is
  // a view before it is a record, and the record arrives with its first question
  // (use-lesson-aside.ts ensure). Called here because this is where the first
  // question is, and before the line is appended — the desk reads what kind of
  // conversation this is off the record, and without one it would read the aside
  // as the lesson itself and answer with the lesson's prompt.
  // Absent = the record exists already.
  ensureThread?: () => void;
}

export interface LessonCall {
  messages: ThreadMessage[];
  streaming: boolean;
  status: string | null;
  chapters: TableChapter[] | null;
  focus: LessonFocus | null;
  taught: ReadonlySet<number>;
  send: (text: string) => void;
  stop: () => void;
  // Re-read the rows off the thread file. What this view missed while it was
  // not on screen: the line an aside left on the lesson (use-lesson-aside.ts).
  // The paper, the chapters and the focus are already held and are not touched.
  reload: () => void;
  // The conversation this lesson is: what an aside off it branches from
  // (reading/aside.ts). Empty until the thread has been resolved.
  threadId: string;
}

export function useLessonCall(book: LessonBook): LessonCall {
  const { bookId, title, topicId, topicName, threadId: asideThreadId } = book;
  // Read rather than closed over: it is rebuilt on every render of the screen
  // that owns the aside, and the effect below must not re-run for it.
  const ensureRef = useRef(book.ensureThread);
  ensureRef.current = book.ensureThread;

  const [threadId, setThreadId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [chapters, setChapters] = useState<TableChapter[] | null>(null);
  const [focusChapter, setFocusChapter] = useState<number | null>(null);
  const [taught, setTaught] = useState<ReadonlySet<number>>(NO_CHAPTERS);
  const [resumed, setResumed] = useState(false);

  // The paper. Null until it has been read, which is also what says no turn may
  // be taken yet: a lesson with no text is a lesson about nothing.
  const fulltextRef = useRef<Fulltext | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const threadIdRef = useRef("");
  // The chapters read in this screen's lifetime, unioned with the ones the
  // thread already held. Kept beside the state so a turn can add to it without
  // reading a render-old copy.
  const taughtRef = useRef<Set<number>>(new Set());

  const { messages, setMessages, streaming, begin, running, stop, abort } = useStreamingTurn(
    bookId,
    threadId,
  );

  // The focus as the thread now has it. read_chapter writes it mid-turn, so this
  // is asked after a tool settles and again when the turn does.
  const readFocus = useCallback(() => {
    setFocusChapter(getBookThread(bookId)?.focusChapter ?? null);
  }, [bookId]);

  const noteTaught = useCallback((label: string) => {
    const n = chapterOfReadChapterLabel(label);
    if (n === null || taughtRef.current.has(n)) return;
    taughtRef.current = new Set(taughtRef.current).add(n);
    setTaught(taughtRef.current);
  }, []);

  // One turn on the thread as it stands. The history is not passed: the desk
  // reads it out of the thread file (reading/desk.ts), which is why the
  // reader's line is appended before this is called.
  const runTurn = useCallback(() => {
    const s = settingsRef.current;
    const ft = fulltextRef.current;
    const id = threadIdRef.current;
    if (!s || !ft || !id) return;
    if (!s.defaultProviderId || !s.defaultModelId) {
      setStatus(NO_PROVIDER);
      return;
    }
    begin((run) => {
      void (async () => {
        const turn = await buildReadingTurn({
          bookId,
          threadId: id,
          // The lesson is the book-level thread: no mark under it, and no marks
          // on this shell at all (docs/74).
          annotationId: "",
          annotation: undefined,
          annotations: [],
          fulltext: ft,
          // No figures and no bytes: the phone never rasterizes a page, so the
          // tools that would need a canvas are not mounted (reading/desk.ts).
          figures: [],
          buffer: null,
          form: "phone",
          context: {
            topicId,
            topicName,
            fileName: title,
            // No page is open, because no page is drawn. The prompt's position
            // block says so rather than naming one the reader cannot see.
            pageLabel: null,
            pageIndex: null,
            files: [],
          },
          settings: s,
          getPipeline: () => null,
          distillAnnotations: () => [],
          signal: run.signal,
        });
        // The reader left while the desk was being laid.
        if (!turn) return;
        // Declined before sending: the same inputs assemble the same call, so a
        // second press changes nothing (docs/pitfall/65).
        if (turn.refusal) {
          run.decline(turn.refusal);
          return;
        }
        const h = run.handlers(turn.notice);
        void runAgentTurn({
          providerId: s.defaultProviderId as ProviderId,
          modelId: s.defaultModelId as string,
          systemPrompt: turn.systemPrompt,
          messages: turn.messages,
          tools: turn.tools,
          signal: run.signal,
          reasoning: toReasoning(s.chatThinking),
          // The same surface the desk's reading turns are logged under: what
          // differs is the form, and that is the prompt's business (docs/74).
          telemetry: { surface: "reading", inline: turn.inline, thread: id },
          about: { bookId },
          harness: soulHarness(),
          ...(turn.origin ? { deliverTo: turn.origin } : {}),
          ...h,
          onToolStart: (info) => {
            if (info.name === "read_chapter") noteTaught(info.label);
            h.onToolStart(info);
          },
          onToolEnd: (info) => {
            h.onToolEnd(info);
            readFocus();
          },
          // The hook stores the settled trace with the reply: it is the record of
          // which chapters this lesson has taught, and without it a reopened sheet
          // forgets every tick.
          onDone: (finalText, assistant, turnText) => {
            h.onDone(finalText, assistant, turnText);
            if (run.signal.aborted) return;
            readFocus();
          },
          onError: (message, assistant, thrown) => {
            h.onError(message, assistant, thrown);
            readFocus();
          },
          onRefusal: (message) => {
            h.onRefusal?.(message);
            readFocus();
          },
        });
      })();
    });
  }, [begin, bookId, noteTaught, readFocus, title, topicId, topicName]);

  // Read rather than closed over: the opening line is sent from inside the
  // effect that opens the paper, and that effect must not re-run when the turn
  // callback is rebuilt.
  const runTurnRef = useRef(runTurn);
  runTurnRef.current = runTurn;

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const id = threadIdRef.current;
      if (!trimmed || !id || !fulltextRef.current || running()) return;
      // The first question is what writes an aside down (LessonBook).
      ensureRef.current?.();
      const ts = Date.now();
      appendMessage(bookId, id, { role: "user", text: trimmed, ts });
      setMessages((rows) => [...rows, { role: "user", text: trimmed, ts }]);
      // A lesson being resumed stops being one the moment it moves.
      setResumed(false);
      runTurnRef.current();
    },
    [bookId, running, setMessages],
  );
  const sendRef = useRef(send);
  sendRef.current = send;

  // Open the paper and the conversation about it. The thread comes first so a
  // lesson already under way is on screen while the PDF is still being read.
  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setChapters(null);
    setFocusChapter(null);
    setTaught(NO_CHAPTERS);
    setResumed(false);
    fulltextRef.current = null;
    taughtRef.current = new Set();
    threadIdRef.current = "";
    setThreadId("");

    void (async () => {
      settingsRef.current = await loadSettings().catch(() => null);
      // An aside names its own conversation; the lesson has to find the book's.
      // Either way the file is read first, because the store's cache answers
      // "not here" for a book nobody has opened yet just as convincingly as for
      // one that has no such thread (reading/session/book-thread.ts).
      let thread;
      if (asideThreadId) {
        await loadThreads(bookId).catch(() => {});
        if (cancelled) return;
        thread = getThread(bookId, asideThreadId);
        // Not written down yet: an aside the reader has asked nothing in, which
        // is a conversation with an id and no rows until they do (LessonBook).
        // Without an ensureThread there is no such state, and a named thread
        // that is not there is one this device cannot read.
        if (!thread && !ensureRef.current) {
          setStatus(NO_THREAD);
          return;
        }
      } else {
        const found = await resolveBookThread(bookId, () => cancelled);
        if (cancelled) return;
        if (found.status === "cancelled") return;
        if (found.status !== "ok") {
          setStatus(NO_THREAD);
          return;
        }
        thread = found.thread;
      }
      const id = thread?.id ?? (asideThreadId as string);
      threadIdRef.current = id;
      setThreadId(id);
      setMessages(thread ? thread.messages.map(rehydrateMessage) : []);
      // The lecture state is the lesson's. An aside reads its parent's focus at
      // turn time (reading/desk.ts) and draws neither the focus line nor the
      // chapter sheet, so there is nothing here for it to hold.
      if (!asideThreadId && thread) {
        taughtRef.current = taughtChapters(thread);
        setTaught(taughtRef.current);
        setFocusChapter(thread.focusChapter ?? null);
        setResumed(lessonResumed(thread, 0));
      }

      let opened;
      try {
        opened = await openPhonePdf(bookId, phonePdfIo, (line) => {
          if (!cancelled) setStatus(line);
        });
      } catch (e) {
        if (cancelled) return;
        console.error("failed to open the lesson", e);
        setStatus(e instanceof LessonOpenError ? e.message : "This paper could not be opened.");
        return;
      }
      if (cancelled) return;
      setChapters(opened.chapters);
      // A scan is a real paper with nothing to teach from. The line stays where
      // the focus would be and no turn is ever taken.
      if (opened.fulltext.status !== "ok") {
        setStatus(noTextStatus());
        return;
      }
      fulltextRef.current = opened.fulltext;
      setStatus(null);
      // A paper nobody has been taught yet opens itself: the reader's first
      // message is written for them (reading/lesson/opening.ts). An aside opens
      // on nothing and waits — the reader already said what it is about by
      // holding the words.
      if (!asideThreadId && thread && thread.messages.length === 0) {
        sendRef.current(lessonOpening());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asideThreadId, bookId, setMessages]);

  // Leaving stops the turn. Nothing is distilled on the way out: what a lesson
  // leaves behind has not been decided (docs/74).
  useEffect(() => () => abort(), [bookId, abort]);

  const reload = useCallback(() => {
    const id = threadIdRef.current;
    if (!id) return;
    const thread = getThread(bookId, id);
    if (thread) setMessages(thread.messages.map(rehydrateMessage));
  }, [bookId, setMessages]);

  const page = useMemo(() => lastCitedPage(messages), [messages]);
  const focus: LessonFocus | null =
    focusChapter === null ? null : { chapter: focusChapter, page, resumed };

  return {
    messages,
    streaming,
    status,
    chapters,
    focus,
    taught,
    send,
    stop,
    reload,
    threadId,
  };
}
