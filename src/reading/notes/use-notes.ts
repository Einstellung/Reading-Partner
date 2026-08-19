// The chapter-spine hub (docs/09), lifted out of App: which pipeline the panel is
// looking at, the unattended start, and the panel's callbacks. It owns
// the snapshot state and renders nothing — the shell calls it and spreads
// `panel` into NotesPanel.
//
// Everything book-specific comes from the shell's refs rather than props: the
// open book's id, name, full text, figures, bytes and marks are all read at call
// time, so every callback here keeps the stable identity it had inside App and a
// notes run never re-renders the reader.

import { useCallback, useRef, useState } from "react";
import { annotationPage, type Annotation } from "../../platform/app/reader-contract";
import { logEvent } from "../../platform/app/events";
import type { Settings } from "../../platform/app/settings";
import { loadThreads } from "../../platform/app/threads";
import type { Fulltext } from "../../fulltext/types";
import type { FiguresIndex } from "../figures";
import { getNotesPipeline, hasNotesState, peekNotesPipeline, type NotesInputs } from "./live";
import type { NotesPipeline, NotesSnapshot } from "./pipeline";
import { readChapterNote as readNotesChapter, readOverviewNote } from "./store";

// Coalesce bursts of annotation-created events before deciding whether to start
// the book's preparation.
const AUTO_NOTES_DEBOUNCE = 4000;

// A ref the shell owns and this hook only reads.
type HostRef<T> = { readonly current: T };

// What the notes feature needs from the shell. Refs, because the callbacks below
// are stable and must see the book that is open when they run, not the one that
// was open when they were created.
export interface NotesHost {
  // The open book's id, null in the library. Re-read after every await: a book
  // switch mid-extraction abandons the run.
  bookIdRef: HostRef<string | null>;
  ctxRef: HostRef<{ topicId: string | null; fileName: string; pageIndex: number | null }>;
  settingsRef: HostRef<Settings>;
  currentFulltextRef: HostRef<Promise<Fulltext | null> | null>;
  currentFiguresRef: HostRef<Promise<FiguresIndex | null> | null>;
  bufferRef: HostRef<ArrayBuffer | null>;
  annsRef: HostRef<Map<string, Annotation>>;
  pushToast(kind: "warn" | "error", message: string): void;
}

// Exactly the props NotesPanel takes, so the shell can spread them.
export interface NotesPanelBindings {
  snapshot: NotesSnapshot | null;
  loadOverview(): Promise<string | null>;
  loadChapter(index: number): Promise<string | null>;
  onGenerate(): void;
  onStop(): void;
  onRetryPlan(): void;
  onRetryChapter(index: number): void;
  onRegenerateChapter(index: number, instruction?: string): void;
  onGenerateChapter(index: number): void;
  onRegenerateOverview(): void;
}

export interface NotesController {
  // Mirror of the attached pipeline, for the panel and the drawer's busy dot.
  snapshot: NotesSnapshot | null;
  panel: NotesPanelBindings;
  // A fresh mark landed: start the book's preparation if it has not started,
  // debounced.
  scheduleAuto(): void;
  // Book open: detach the previous book's panel (its pipeline keeps running).
  reset(): void;
  // Book open, once the full text is in: resume a persisted or running pipeline.
  resume(bookId: string, name: string, ft: Fulltext): Promise<void>;
  // Book close: last chance to start or resume the run.
  finalPass(): void;
}

export function useNotes(host: NotesHost): NotesController {
  const {
    annsRef,
    bookIdRef,
    bufferRef,
    ctxRef,
    currentFiguresRef,
    currentFulltextRef,
    pushToast,
    settingsRef,
  } = host;

  const [notesSnap, setNotesSnap] = useState<NotesSnapshot | null>(null);
  // The spine pipeline attached to the open book, its unsubscribe,
  // and the last-seen plan/overview phases so run start/done/failed log as
  // transitions.
  const notesRef = useRef<NotesPipeline | null>(null);
  const notesUnsubRef = useRef<(() => void) | null>(null);
  const notesPhaseRef = useRef<{ plan: string; overview: string }>({ plan: "pending", overview: "pending" });

  // Attach the open book's spine pipeline to the UI: subscribe the
  // panel to the book's pipeline. Book-specific inputs (buffer, figure index,
  // annotations) are captured now so a background run reads this book's data, not
  // whatever book is open later. Idempotent — the pipeline is a module singleton
  // per book. It does not kick generation — the caller decides — and returns the
  // pipeline.
  const attachNotes = useCallback(
    (bookId: string, name: string, ft: Fulltext): NotesPipeline => {
      const buffer = bufferRef.current;
      const figuresPromise = currentFiguresRef.current;
      const annMap = annsRef.current;
      const inputs: NotesInputs = {
        fulltext: ft,
        getBuffer: () => buffer,
        getFigures: async () => (await figuresPromise)?.figures ?? [],
        getEmphasisSignals: () =>
          [...annMap.values()]
            .map((a) => ({
              page: annotationPage(a as { position?: { pageIndex?: number } }) ?? 0,
              text: typeof a.text === "string" ? a.text : "",
              comment: typeof a.comment === "string" ? a.comment : undefined,
              discussed: !!a.aiThreadId,
            }))
            .filter((s) => s.page > 0 && s.text.trim() !== ""),
        // Chat threads carried into chapter generation: anchor each mark-anchored
        // thread to its annotation's page; book-level threads have no anchor and
        // are dropped.
        getChatThreads: async () => {
          const threadMap = await loadThreads(bookId);
          return Object.values(threadMap)
            .map((t) => {
              const ann = t.annotationId ? annMap.get(t.annotationId) : undefined;
              const page = annotationPage(ann as { position?: { pageIndex?: number } } | undefined);
              if (!page) return null;
              return {
                page,
                createdAt: t.createdAt,
                messages: t.messages.map((m) => ({ role: m.role, text: m.text })),
              };
            })
            .filter((t): t is NonNullable<typeof t> => t !== null);
        },
      };
      const pipeline = getNotesPipeline(bookId, name, inputs);
      notesRef.current = pipeline;
      notesUnsubRef.current?.();
      notesPhaseRef.current = { plan: "pending", overview: "pending" };
      const sync = () => {
        const snap = pipeline.snapshot();
        const topicId = ctxRef.current.topicId;
        const st = snap.state;
        if (st && topicId) {
          const prev = notesPhaseRef.current;
          if (st.overviewStatus === "done" && prev.overview !== "done") {
            logEvent(topicId, "notes-run", { phase: "done" });
          }
          if (st.planStatus === "failed" && prev.plan !== "failed") {
            logEvent(topicId, "notes-run", { phase: "failed" });
          }
          notesPhaseRef.current = { plan: st.planStatus, overview: st.overviewStatus };
        }
        setNotesSnap(snap);
      };
      notesUnsubRef.current = pipeline.subscribe(sync);
      sync();
      return pipeline;
    },
    [annsRef, bufferRef, ctxRef, currentFiguresRef],
  );

  // Whether the reader has marked anything in the open book. Preparation is
  // whole-book, so marks no longer decide which chapters run (docs/09) — a mark
  // is only the sign that this book is being worked with rather than glanced at,
  // which is what the autoNotes setting is about.
  const bookHasMarks = useCallback((): boolean => {
    for (const a of annsRef.current.values()) {
      if (annotationPage(a as { position?: { pageIndex?: number } })) return true;
    }
    return false;
  }, [annsRef]);

  // Unattended start (docs/09): prepare the whole book in the background. Gated
  // on the autoNotes setting and on the reader having marked something, so a book
  // that was opened and closed does not spend anything. Fire-and-forget; the
  // pipeline serializes its own runs and never re-runs a finished chapter.
  const autoStartNotes = useCallback(
    async (force?: boolean) => {
      if (!settingsRef.current.autoNotes) return;
      const bookId = bookIdRef.current;
      const name = ctxRef.current.fileName;
      if (!bookId) return;
      const ft = await currentFulltextRef.current;
      if (bookIdRef.current !== bookId) return; // switched books while extracting
      if (!ft || ft.status !== "ok") return;
      if (!force && !bookHasMarks()) return;
      const pipeline = attachNotes(bookId, name, ft);
      await pipeline.ensureStarted();
    },
    [attachNotes, bookHasMarks, bookIdRef, ctxRef, currentFulltextRef, settingsRef],
  );

  // Debounced: annotation-created events fire in bursts, so coalesce them and
  // check at most once every few seconds.
  const autoNotesTimer = useRef<number | null>(null);
  const scheduleAutoNotes = useCallback(() => {
    if (!settingsRef.current.autoNotes) return;
    if (autoNotesTimer.current) window.clearTimeout(autoNotesTimer.current);
    autoNotesTimer.current = window.setTimeout(() => {
      autoNotesTimer.current = null;
      void autoStartNotes();
    }, AUTO_NOTES_DEBOUNCE);
  }, [autoStartNotes, settingsRef]);

  // The Notes tab's Generate / Resume button: the manual whole-book run, always
  // available regardless of the autoNotes setting.
  const generateNotes = useCallback(async () => {
    const bookId = bookIdRef.current;
    const name = ctxRef.current.fileName;
    if (!bookId) return;
    const ft = await currentFulltextRef.current;
    if (bookIdRef.current !== bookId) return; // switched books while extracting
    if (!ft || ft.status !== "ok") {
      pushToast("warn", "This book has no readable text layer, so notes can't be generated.");
      return;
    }
    const topicId = ctxRef.current.topicId;
    if (topicId) logEvent(topicId, "notes-run", { phase: "start" });
    const pipeline = attachNotes(bookId, name, ft);
    void pipeline.ensureStarted();
  }, [attachNotes, pushToast, bookIdRef, ctxRef, currentFulltextRef]);

  const notesGenerate = useCallback(() => void generateNotes(), [generateNotes]);
  const notesStop = useCallback(() => notesRef.current?.stop(), []);
  const notesRetryPlan = useCallback(() => notesRef.current?.retryPlan(), []);
  const notesRetryChapter = useCallback((index: number) => notesRef.current?.retryChapter(index), []);
  const notesRegenerateChapter = useCallback(
    (index: number, instruction?: string) => {
      const topicId = ctxRef.current.topicId;
      if (topicId) logEvent(topicId, "notes-chapter-regenerate", { index });
      notesRef.current?.regenerateChapter(index, instruction);
    },
    [ctxRef],
  );
  // Generate a single chapter left pending by a stop or a failure.
  const notesGenerateChapter = useCallback((index: number) => notesRef.current?.generateChapter(index), []);
  const notesRegenerateOverview = useCallback(() => notesRef.current?.regenerateOverview(), []);
  const loadNotesOverview = useCallback(() => {
    const bookId = bookIdRef.current;
    return bookId ? readOverviewNote(bookId) : Promise.resolve(null);
  }, [bookIdRef]);
  const loadNotesChapter = useCallback(
    (index: number) => {
      const bookId = bookIdRef.current;
      return bookId ? readNotesChapter(bookId, index) : Promise.resolve(null);
    },
    [bookIdRef],
  );

  // Notes are per book; detach the previous book's panel (the pipeline keeps
  // running in the background as a module singleton).
  const resetNotes = useCallback(() => {
    notesUnsubRef.current?.();
    notesUnsubRef.current = null;
    notesRef.current = null;
    notesPhaseRef.current = { plan: "pending", overview: "pending" };
    setNotesSnap(null);
  }, []);

  // Resume a book's spines from persisted state: subscribe the panel, then pick
  // up wherever the last run stopped. A run that already exists is resumed
  // whatever the autoNotes setting says — the spend was already agreed to, and
  // half a book's spines are worth less than none.
  const resumeNotes = useCallback(
    async (bookId: string, name: string, ft: Fulltext) => {
      try {
        if (peekNotesPipeline(bookId) || (await hasNotesState(bookId))) {
          if (bookIdRef.current === bookId) {
            const pipeline = attachNotes(bookId, name, ft);
            void pipeline.ensureStarted();
          }
        }
      } catch (e) {
        console.warn("failed to resume book notes", e);
      }
    },
    [attachNotes, bookIdRef],
  );

  // Book close: one more chance to start (or resume) the run for a book the
  // reader worked in. Nothing about the last chapter is special any more — the
  // whole book is prepared in one go — but the close is still the moment a
  // session's marks are all in. Only when a pipeline already exists or the
  // reader marked something; otherwise the manual button is the fallback. Fire
  // before the shell tears its refs down.
  const finalPassNotes = useCallback(() => {
    if (!settingsRef.current.autoNotes) return;
    const bookId = bookIdRef.current;
    if (!bookId) return;
    const existing = peekNotesPipeline(bookId);
    if (existing) {
      existing.ensureStarted().catch(() => {});
      return;
    }
    void autoStartNotes();
  }, [autoStartNotes, bookIdRef, settingsRef]);

  return {
    snapshot: notesSnap,
    panel: {
      snapshot: notesSnap,
      loadOverview: loadNotesOverview,
      loadChapter: loadNotesChapter,
      onGenerate: notesGenerate,
      onStop: notesStop,
      onRetryPlan: notesRetryPlan,
      onRetryChapter: notesRetryChapter,
      onRegenerateChapter: notesRegenerateChapter,
      onGenerateChapter: notesGenerateChapter,
      onRegenerateOverview: notesRegenerateOverview,
    },
    scheduleAuto: scheduleAutoNotes,
    reset: resetNotes,
    resume: resumeNotes,
    finalPass: finalPassNotes,
  };
}
