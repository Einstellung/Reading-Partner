// The lesson, as live state (docs/74): the paper opened, the book-level thread
// found, and one turn at a time streaming into it.
//
// Small on purpose. A lesson is a book-level conversation with no reader under
// it, so none of what makes the desk's use-call.ts long is here — no marks, no
// page images, no prep, no pip cards, no supplement plumbing. The turn runs on
// the durable runtime the desk's turns run on (docs/soul/87): the reader's line
// is written first, every view of the turn replaces the rows after it, and
// what landed — the trace the taught chapters are read back from included — is
// written into the thread file by the runtime (reading/turn/durable-book.ts).
//
// Nothing here writes the chapter focus. read_chapter writes it into the thread
// (reading/desk.ts onFocus) and this hook reads it back, which is why a tap on
// the chapter sheet sends a sentence rather than setting a number.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { t } from "../../../../i18n";
import { applyRowChange } from "../../../../ai/turn-view/turn-rows";
import { toolLabel } from "../../../../legion/execute/tool-result";
import {
  appendMessage,
  getBookThread,
  getThread,
  loadThreads,
} from "../../../../platform/app/threads";
import { loadSettings, toReasoning, type Settings } from "../../../../platform/app/settings";
import type { Fulltext } from "../../../../fulltext/types";
import type { TableChapter } from "../../../../reading/chapters";
import { lessonOpening } from "../../../../reading/lesson/opening";
import { LessonOpenError, openPhonePdf, phonePdfIo } from "../../../../reading/lesson/open-pdf";
import { noTextStatus } from "../../../../reading/lesson/status";
import {
  lastCitedPage,
  lessonResumed,
  taughtChapters,
} from "../../../../reading/lesson/thread-state";
import { chapterOfReadChapterLabel } from "../../../../reading/lecture/tools";
import { resolveBookThread } from "../../../../reading/session/book-thread";
import {
  afterStall,
  driveBookTurn,
  type BookTurnEnd,
  type DrivenBookTurn,
} from "../../../../reading/turn/book-turn-rows";
import { withTurnRows } from "../../../../reading/turn/call-state";
import { splitAssembled, type BookOrigin } from "../../../../reading/turn/durable-book";
import { readingDurable, setBookWatching } from "../../../../reading/turn/durable-runtime";
import { buildReadingTurn } from "../../../../reading/turn/turn";
import { rehydrateMessage } from "../../chat/chatParts";
import type { ThreadMessage } from "../../chat/types";
import type { LessonFocus } from "./lesson-view";

const NO_CHAPTERS: ReadonlySet<number> = new Set<number>();

// The turn in flight.
interface LessonTurn {
  threadId: string;
  controller: AbortController;
  // The streaming row drawn before the runtime projects the turn's first one.
  placeholder: number;
  // The runtime's handle on the turn; absent while it is being assembled.
  driven?: DrivenBookTurn;
  // What the reader said into the turn that no run has taken yet, drawn queued
  // under it. Filed when the turn ends, never dropped.
  unsent: ThreadMessage[];
  // Its ending has been dealt with: by the ending itself, or by a stop or a
  // leave that came while it was still being assembled.
  settled: boolean;
  // The screen went away: the ending files what the reader said and draws
  // nothing.
  gone: boolean;
}

// A line into the running turn. It stays among the unsent lines until a run
// takes it.
function steerIn(live: LessonTurn, row: ThreadMessage): void {
  void live.driven?.steer(row.text, row.ts).then(
    (taken) => {
      if (taken) live.unsent = live.unsent.filter((u) => u !== row);
    },
    () => {},
  );
}

// Said where the focus line goes, like every other thing that has gone wrong on
// the way into a lesson (reading/lesson/status.ts). Read at call time rather
// than hoisted into a constant, so it is in the language the reader has now.
function noProviderLine(): string {
  return t("phone.lessonCall.noProvider");
}
function noThreadLine(): string {
  return t("phone.lessonCall.noThread");
}

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

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const liveRef = useRef<LessonTurn | null>(null);

  // Rows are keyed by when they were said, and two lines in one millisecond
  // would be one row.
  const lastTsRef = useRef(0);
  const stamp = useCallback(() => {
    const at = Math.max(Date.now(), lastTsRef.current + 1);
    lastTsRef.current = at;
    return at;
  }, []);

  // What the reader said that no run took goes into the thread file at the
  // moment it was said. True when there was any.
  const fileLines = useCallback(
    (id: string, lines: readonly { text: string; ts: number }[]) => {
      for (const line of lines) appendMessage(bookId, id, { role: "user", text: line.text, ts: line.ts });
      return lines.length > 0;
    },
    [bookId],
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

  // runTurn calls itself: lines the reader said that no run took open the
  // turn that answers them, and a stalled turn is asked again. Through a ref
  // rather than the binding, which does not exist yet inside its own body.
  const runTurnRef = useRef<((attempt?: number) => void) | null>(null);

  // One turn on the thread as it stands. The history is not passed: the desk
  // reads it out of the thread file (reading/desk.ts), which is why the
  // reader's line is appended before this is called.
  const runTurn = useCallback(
    (attempt = 0) => {
      const s = settingsRef.current;
      const ft = fulltextRef.current;
      const id = threadIdRef.current;
      if (!s || !ft || !id) return;
      const providerId = s.defaultProviderId;
      const modelId = s.defaultModelId;
      if (!providerId || !modelId) {
        setStatus(noProviderLine());
        return;
      }

      // The reader's line this turn answers is the last one in the file, and
      // every row the turn draws comes after it.
      const stored = getThread(bookId, id)?.messages ?? [];
      let said: { text: string; ts: number } | undefined;
      for (const m of stored) if (m.role === "user") said = m;
      const after = said?.ts ?? 0;
      const placeholder: ThreadMessage = {
        role: "ai",
        text: "",
        ts: Math.max(Date.now(), ...stored.map((m) => m.ts + 1)),
        streaming: true,
      };
      const controller = new AbortController();
      const live: LessonTurn = {
        threadId: id,
        controller,
        placeholder: placeholder.ts,
        unsent: [],
        settled: false,
        gone: false,
      };
      liveRef.current = live;
      setStreaming(true);
      // Rides the answering row on screen only: persisted, it would replay next
      // turn as if the model had written it.
      let notice = "";

      const draw = (rows: ThreadMessage[]) => setMessages((prev) => withTurnRows(prev, after, rows));
      // The turn's rows as the runtime last projected them, then the reader's
      // lines no run has taken yet.
      const withUnsent = (rows: ThreadMessage[]): ThreadMessage[] => [
        ...rows,
        ...live.unsent.filter((u) => !rows.some((r) => r.role === "user" && r.ts === u.ts)),
      ];
      draw([placeholder]);

      // read_chapter ticks its chapter on the sheet as it starts, and has moved
      // the focus once it has run.
      let ran = 0;
      const follow = (rows: readonly ThreadMessage[]) => {
        let n = 0;
        for (const row of rows) {
          for (const tool of row.tools ?? []) {
            if (tool.name === "read_chapter") noteTaught(tool.label);
            if (tool.state !== "running") n += 1;
          }
        }
        if (n > ran) {
          ran = n;
          readFocus();
        }
      };

      // A turn that ends without a reply leaves a row of its own under what it
      // wrote.
      const failureRow = (
        kind: "refusal" | "error",
        message: string,
        above: readonly ThreadMessage[],
      ): ThreadMessage => {
        const row: ThreadMessage = {
          role: "ai",
          text: "",
          ts: Math.max(placeholder.ts, ...above.map((r) => r.ts + 1)),
        };
        return applyRowChange(
          row,
          kind === "refusal"
            ? { kind: "refusal", text: message }
            : { kind: "error", text: `⚠️ Couldn't reach the model. ${message}` },
        );
      };

      // How the turn ended, drawn and filed.
      const finish = (end: BookTurnEnd) => {
        if (live.settled) return;
        live.settled = true;
        const withdrawn = end.kind === "stopped" || end.kind === "stalled" ? end.steers : [];
        const steers = withdrawn.map((steer) => ({ text: steer.text, ts: steer.ts ?? Date.now() }));
        // Everything the reader said that no run took, in the order it was said.
        const owed = [...steers, ...live.unsent.filter((u) => !steers.some((steer) => steer.ts === u.ts))].sort(
          (a, b) => a.ts - b.ts,
        );
        const filed = fileLines(id, owed);
        if (live.gone) return;
        liveRef.current = null;
        setStreaming(false);
        readFocus();
        const lines = owed.map((line): ThreadMessage => ({ role: "user", text: line.text, ts: line.ts }));

        if (end.kind === "stalled") {
          // The stream went silent and the watch cut it (legion/execute/stall.ts):
          // the app was switched away mid-answer and the connection did not
          // survive being frozen. Nothing landed; the half-written rows go and
          // the question is asked again — once (docs/pitfall/390). A second
          // stall is shown like any other failure.
          const next = afterStall(attempt);
          if (next.askAgain) {
            draw(lines);
            runTurnRef.current?.(attempt + 1);
          } else {
            draw([...lines, failureRow("error", next.message, lines)]);
          }
          return;
        }

        const rows: ThreadMessage[] = [...end.rows];
        // The owed lines the last view did not carry go under the turn's rows.
        const tail = lines.filter((line) => !rows.some((r) => r.role === "user" && r.ts === line.ts));
        if (end.kind === "answered") {
          let last = -1;
          rows.forEach((row, i) => {
            if (row.role === "ai") last = i;
          });
          if (notice && last >= 0) rows[last] = { ...rows[last]!, notice };
          draw([...rows, ...tail]);
          // The model finished before a run took what the reader said: it is
          // still owed an answer, and it opens the next turn.
          if (filed) runTurnRef.current?.();
          return;
        }
        // What a stopped or failed turn produced stays as finished rows; a row
        // that produced nothing is not a row.
        const kept = rows.filter((r) => r.role === "user" || r.text !== "" || (r.tools?.length ?? 0) > 0);
        if (end.kind === "stopped") {
          draw([...kept, ...tail]);
          // Stopping cuts off the answer, not the reader (docs/72).
          if (filed) runTurnRef.current?.();
          return;
        }
        if (end.kind === "failed") console.error("lesson turn failed", end.message);
        // Retry and asking again are for the turn that just failed, so nothing
        // is started on what the reader said into it.
        draw([...kept, failureRow(end.kind === "refused" ? "refusal" : "error", end.message, kept), ...tail]);
      };

      // No box card for a lesson's reply (reading/turn/durable-book.ts): the
      // lesson is on screen while its turn runs, and leaving it stops the turn.
      // Held for the turn rather than the screen, so what a stop on the way
      // out lands is not taken for a reply nobody saw.
      const unwatch = setBookWatching((origin) => origin.bookId === bookId && origin.threadId === id);

      void (async () => {
        try {
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
            signal: controller.signal,
          });
          // Stopped, or the reader left, while the desk was being laid.
          if (!turn || controller.signal.aborted) {
            if (liveRef.current === live) {
              liveRef.current = null;
              setStreaming(false);
            }
            return;
          }
          // Declined before sending: the same inputs assemble the same call, so a
          // second press changes nothing (docs/pitfall/65).
          if (turn.refusal) {
            finish({ kind: "refused", rows: [], message: turn.refusal });
            return;
          }
          notice = turn.notice;
          const durable = await readingDurable();
          if (!durable) throw new Error("the turn runtime has not started");
          const { history } = splitAssembled(turn.messages);
          const byName = new Map(turn.tools.map((tool) => [tool.name, tool]));
          const thinkingLevel = toReasoning(s.chatThinking);
          const origin: BookOrigin = {
            ...(turn.origin?.place === "book" ? turn.origin : { place: "book" as const, bookId, threadId: id }),
            home: bookId,
          };
          const driven = await driveBookTurn(
            durable,
            {
              origin,
              line: { text: said?.text ?? "", ts: after },
              systemPrompt: turn.systemPrompt,
              history,
              tools: turn.tools,
              model: { provider: providerId, modelId },
              ...(thinkingLevel ? { thinkingLevel } : {}),
              describe: (name, args) => {
                const tool = byName.get(name);
                if (!tool) return { label: name };
                return {
                  label: toolLabel(tool, args as Record<string, unknown>),
                  ...(tool.quiet ? { quiet: true as const } : {}),
                };
              },
            },
            (projected) => {
              if (liveRef.current !== live) return;
              draw(withUnsent(projected.length > 0 ? projected : [placeholder]));
              follow(projected);
            },
          );
          if (liveRef.current !== live) {
            // Stopped, or the reader left, while the turn was starting.
            driven.stop();
          } else {
            live.driven = driven;
            // Lines said while the turn was being assembled go in now.
            for (const row of live.unsent) steerIn(live, row);
          }
          finish(await driven.ended);
        } catch (e) {
          finish({ kind: "failed", rows: [], message: e instanceof Error ? e.message : String(e) });
        } finally {
          unwatch();
        }
      })();
    },
    [bookId, fileLines, noteTaught, readFocus, title, topicId, topicName],
  );
  runTurnRef.current = runTurn;

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const id = threadIdRef.current;
      if (!trimmed || !id || !fulltextRef.current) return;
      // Said while the answer is still being written: not a second turn but a
      // line into this one, drawn queued under it until a run takes it
      // (docs/72).
      const live = liveRef.current;
      if (live) {
        const row: ThreadMessage = { role: "user", text: trimmed, ts: stamp(), queued: true };
        live.unsent = [...live.unsent, row];
        setMessages((rows) => [...rows, row]);
        steerIn(live, row);
        return;
      }
      // The first question is what writes an aside down (LessonBook).
      ensureRef.current?.();
      const ts = stamp();
      appendMessage(bookId, id, { role: "user", text: trimmed, ts });
      setMessages((rows) => [...rows, { role: "user", text: trimmed, ts }]);
      // A lesson being resumed stops being one the moment it moves.
      setResumed(false);
      runTurnRef.current?.();
    },
    [bookId, stamp],
  );
  const sendRef = useRef(send);
  sendRef.current = send;

  // The stop button. The runtime keeps the half sentence and the receipts and
  // lands them; the turn's ending draws them, and until then the turn is still
  // the one running.
  const stop = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    if (live.driven) {
      live.driven.stop();
      return;
    }
    // Still being assembled: nothing was asked, so nothing is kept.
    live.settled = true;
    live.controller.abort();
    liveRef.current = null;
    setStreaming(false);
    setMessages((rows) =>
      rows
        .filter((r) => !(r.role === "ai" && r.ts === live.placeholder))
        .map((r) => (r.queued ? { ...r, queued: undefined } : r)),
    );
    // Stopping cuts off the answer, not the reader: what they said opens the
    // next turn (docs/72).
    if (fileLines(live.threadId, live.unsent)) runTurnRef.current?.();
  }, [fileLines]);

  // The view is going away. The turn is stopped — the runtime lands what it
  // had said — and what the reader said into it still goes into the thread
  // file; nothing is left on screen to answer it in.
  const abort = useCallback(() => {
    const live = liveRef.current;
    if (!live) return;
    live.gone = true;
    liveRef.current = null;
    live.controller.abort();
    if (live.driven) {
      live.driven.stop();
      return;
    }
    live.settled = true;
    fileLines(live.threadId, live.unsent);
  }, [fileLines]);

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
          setStatus(noThreadLine());
          return;
        }
      } else {
        const found = await resolveBookThread(bookId, () => cancelled);
        if (cancelled) return;
        if (found.status === "cancelled") return;
        if (found.status !== "ok") {
          setStatus(noThreadLine());
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
        setStatus(e instanceof LessonOpenError ? e.message : t("phone.lessonCall.openFailed"));
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
