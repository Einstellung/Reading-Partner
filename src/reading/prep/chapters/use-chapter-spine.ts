// The chapter-spine hub (docs/09), lifted out of App: which pipeline the panel is
// looking at, and the panel's callbacks. It owns the snapshot state and renders
// nothing — the shell calls it and spreads `panel` into the Prep panel's chapter
// half.
//
// What it does not decide is when a run starts. Both triggers — a mark landing,
// the lecture entry being pressed — are one decision across both kinds of prep
// and live in reading/session/use-prep-trigger.ts; this hook only offers the
// `start` they call.
//
// Everything book-specific comes from the shell's refs rather than props: the
// open book's id, name, full text, figures, bytes and marks are all read at call
// time, so every callback here keeps the stable identity it had inside App and a
// spine run never re-renders the reader.

import { useCallback, useMemo, useRef, useState } from "react";
import { annotationPage, type Annotation } from "../../../platform/app/reader-contract";
import { logEvent } from "../../../platform/app/events";
import { loadThreads } from "../../../platform/app/threads";
import type { Fulltext } from "../../../fulltext/types";
import type { FiguresIndex } from "../../figures";
import { prepProgress, type PrepProgress } from "../progress";
import { getChapterSpinePipeline, hasChapterSpineState, peekChapterSpinePipeline, type ChapterSpineInputs } from "./live";
import type { ChapterSpinePipeline, ChapterSpineSnapshot } from "./pipeline";
import { readChapterSpine as readSpineChapter, readSpineOverview } from "./store";

// A ref the shell owns and this hook only reads.
type HostRef<T> = { readonly current: T };

// What the chapter-spine feature needs from the shell. Refs, because the callbacks below
// are stable and must see the book that is open when they run, not the one that
// was open when they were created.
export interface ChapterSpineHost {
  // The open book's id, null in the library. Re-read after every await: a book
  // switch mid-extraction abandons the run.
  bookIdRef: HostRef<string | null>;
  ctxRef: HostRef<{ topicId: string | null; fileName: string; pageIndex: number | null }>;
  currentFulltextRef: HostRef<Promise<Fulltext | null> | null>;
  currentFiguresRef: HostRef<Promise<FiguresIndex | null> | null>;
  bufferRef: HostRef<ArrayBuffer | null>;
  annsRef: HostRef<Map<string, Annotation>>;
  pushToast(kind: "warn" | "error", message: string): void;
}

// Exactly the Prep panel's chapter bindings, so the shell can hand them over
// whole (ui/components/reader/PrepPanel.tsx, ChapterPrepBindings).
export interface ChapterSpinePanelBindings {
  snapshot: ChapterSpineSnapshot | null;
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

export interface ChapterSpineController {
  // Mirror of the attached pipeline, for the panel and the drawer's busy dot.
  snapshot: ChapterSpineSnapshot | null;
  // How far this book's spines have got, for the line above a conversation.
  // Null when no run is attached.
  progress: PrepProgress | null;
  panel: ChapterSpinePanelBindings;
  // Start (or pick up) this book's spine run. Called by the trigger, which has
  // already decided that this is the kind of prep this document gets.
  // Idempotent: the pipeline is a module singleton per book and never re-runs a
  // finished chapter.
  start(bookId: string, name: string, ft: Fulltext): Promise<void>;
  // Book open: detach the previous book's panel (its pipeline keeps running).
  reset(): void;
  // Book open, once the full text is in: resume a persisted or running pipeline.
  resume(bookId: string, name: string, ft: Fulltext): Promise<void>;
}

export function useChapterSpine(host: ChapterSpineHost): ChapterSpineController {
  const {
    annsRef,
    bookIdRef,
    bufferRef,
    ctxRef,
    currentFiguresRef,
    currentFulltextRef,
    pushToast,
  } = host;

  const [spineSnap, setSpineSnap] = useState<ChapterSpineSnapshot | null>(null);
  // The spine pipeline attached to the open book, its unsubscribe,
  // and the last-seen plan/overview phases so run start/done/failed log as
  // transitions.
  const spineRef = useRef<ChapterSpinePipeline | null>(null);
  const spineUnsubRef = useRef<(() => void) | null>(null);
  const spinePhaseRef = useRef<{ plan: string; overview: string }>({ plan: "pending", overview: "pending" });

  // Attach the open book's spine pipeline to the UI: subscribe the
  // panel to the book's pipeline. Book-specific inputs (buffer, figure index,
  // annotations) are captured now so a background run reads this book's data, not
  // whatever book is open later. Idempotent — the pipeline is a module singleton
  // per book. It does not kick generation — the caller decides — and returns the
  // pipeline.
  const attachSpine = useCallback(
    (bookId: string, name: string, ft: Fulltext): ChapterSpinePipeline => {
      const buffer = bufferRef.current;
      const figuresPromise = currentFiguresRef.current;
      const annMap = annsRef.current;
      const inputs: ChapterSpineInputs = {
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
        //
        // Which takes an aside with it, or leaves it in, by the same rule and on
        // purpose. One drawn on the page has a mark and rides, like any mark
        // thread. A chat-span aside has none: what it is about is a sentence of
        // a reply, and the spine pass writes per chapter from page-anchored
        // evidence, so there is no page to file it under. It is not lost — that
        // conversation is distilled into its parent's memory unit
        // (observation/distill/arrears.ts).
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
      const pipeline = getChapterSpinePipeline(bookId, name, inputs);
      spineRef.current = pipeline;
      spineUnsubRef.current?.();
      spinePhaseRef.current = { plan: "pending", overview: "pending" };
      const sync = () => {
        const snap = pipeline.snapshot();
        const topicId = ctxRef.current.topicId;
        const st = snap.state;
        if (st && topicId) {
          const prev = spinePhaseRef.current;
          if (st.overviewStatus === "done" && prev.overview !== "done") {
            logEvent(topicId, "notes-run", { phase: "done" });
          }
          if (st.planStatus === "failed" && prev.plan !== "failed") {
            logEvent(topicId, "notes-run", { phase: "failed" });
          }
          spinePhaseRef.current = { plan: st.planStatus, overview: st.overviewStatus };
        }
        setSpineSnap(snap);
      };
      spineUnsubRef.current = pipeline.subscribe(sync);
      sync();
      return pipeline;
    },
    [annsRef, bufferRef, ctxRef, currentFiguresRef],
  );

  // Start this book's spine run and let it go. The trigger has already checked
  // everything that gates it (reading/prep/trigger.ts); what is left here is
  // attaching the panel and kicking the pipeline.
  const startSpine = useCallback(
    async (bookId: string, name: string, ft: Fulltext) => {
      const pipeline = attachSpine(bookId, name, ft);
      await pipeline.ensureStarted();
    },
    [attachSpine],
  );

  // The Prep panel's Generate / Resume button: the manual whole-book run.
  const generateSpine = useCallback(async () => {
    const bookId = bookIdRef.current;
    const name = ctxRef.current.fileName;
    if (!bookId) return;
    const ft = await currentFulltextRef.current;
    if (bookIdRef.current !== bookId) return; // switched books while extracting
    if (!ft || ft.status !== "ok") {
      pushToast("warn", "This book has no readable text layer, so its chapter spine can't be prepared.");
      return;
    }
    const topicId = ctxRef.current.topicId;
    if (topicId) logEvent(topicId, "notes-run", { phase: "start" });
    const pipeline = attachSpine(bookId, name, ft);
    void pipeline.ensureStarted();
  }, [attachSpine, pushToast, bookIdRef, ctxRef, currentFulltextRef]);

  const spineGenerate = useCallback(() => void generateSpine(), [generateSpine]);
  const spineStop = useCallback(() => spineRef.current?.stop(), []);
  const spineRetryPlan = useCallback(() => spineRef.current?.retryPlan(), []);
  const spineRetryChapter = useCallback((index: number) => spineRef.current?.retryChapter(index), []);
  const spineRegenerateChapter = useCallback(
    (index: number, instruction?: string) => {
      const topicId = ctxRef.current.topicId;
      if (topicId) logEvent(topicId, "notes-chapter-regenerate", { index });
      spineRef.current?.regenerateChapter(index, instruction);
    },
    [ctxRef],
  );
  // Generate a single chapter left pending by a stop or a failure.
  const spineGenerateChapter = useCallback((index: number) => spineRef.current?.generateChapter(index), []);
  const spineRegenerateOverview = useCallback(() => spineRef.current?.regenerateOverview(), []);
  const loadSpineOverview = useCallback(() => {
    const bookId = bookIdRef.current;
    return bookId ? readSpineOverview(bookId) : Promise.resolve(null);
  }, [bookIdRef]);
  const loadSpineChapter = useCallback(
    (index: number) => {
      const bookId = bookIdRef.current;
      return bookId ? readSpineChapter(bookId, index) : Promise.resolve(null);
    },
    [bookIdRef],
  );

  // Spines are per book; detach the previous book's panel (the pipeline keeps
  // running in the background as a module singleton).
  const resetChapterSpine = useCallback(() => {
    spineUnsubRef.current?.();
    spineUnsubRef.current = null;
    spineRef.current = null;
    spinePhaseRef.current = { plan: "pending", overview: "pending" };
    setSpineSnap(null);
  }, []);

  // Resume a book's spines from persisted state: subscribe the panel, then pick
  // up wherever the last run stopped. A run that already exists is always
  // resumed — the spend was already agreed to, and half a book's spines are
  // worth less than none.
  const resumeChapterSpine = useCallback(
    async (bookId: string, name: string, ft: Fulltext) => {
      try {
        if (peekChapterSpinePipeline(bookId) || (await hasChapterSpineState(bookId))) {
          if (bookIdRef.current === bookId) {
            const pipeline = attachSpine(bookId, name, ft);
            void pipeline.ensureStarted();
          }
        }
      } catch (e) {
        console.warn("failed to resume the book's chapter spine", e);
      }
    },
    [attachSpine, bookIdRef],
  );

  // A chapter is behind us once it is written or given up on; the graph pass
  // that follows is not counted, so the line reads in chapters, which is what
  // the reader can see in the panel.
  const spineProgress = useMemo(() => {
    const chapters = spineSnap?.state?.chapters;
    if (!chapters) return null;
    return prepProgress(chapters, (c) => c.status === "done" || c.status === "failed");
  }, [spineSnap]);

  return {
    snapshot: spineSnap,
    progress: spineProgress,
    panel: {
      snapshot: spineSnap,
      loadOverview: loadSpineOverview,
      loadChapter: loadSpineChapter,
      onGenerate: spineGenerate,
      onStop: spineStop,
      onRetryPlan: spineRetryPlan,
      onRetryChapter: spineRetryChapter,
      onRegenerateChapter: spineRegenerateChapter,
      onGenerateChapter: spineGenerateChapter,
      onRegenerateOverview: spineRegenerateOverview,
    },
    start: startSpine,
    reset: resetChapterSpine,
    resume: resumeChapterSpine,
  };
}
