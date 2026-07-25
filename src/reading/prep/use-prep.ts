// The lesson-prep hub (docs/09), lifted out of App: classroom mode, the pipeline
// the panel is looking at, and the panel's callbacks. It owns the classroom flag,
// the snapshot and the selected paper, and renders nothing — the shell calls it
// and spreads `panel` into PrepPanel.
//
// Two of its refs go back to the shell as they are: the sticky classroom flag
// rides along with the persisted reading position and with every AI turn, and
// the attached pipeline backs the turn's classroom tools.

import { useCallback, useEffect, useRef, useState } from "react";
import { logEvent } from "../../platform/app/events";
import type { ViewState, ViewStats } from "../../platform/app/reader-contract";
import { saveViewState, withClassroom } from "../../platform/app/storage";
import type { Fulltext } from "../../fulltext/types";
import { getPrepPipeline, hasPrepState, peekPrepPipeline } from "./live";
import { parseNote } from "./notes";
import type { PrepPipeline, PrepSnapshot } from "./pipeline";
import { chapterIndexForPage } from "./scheduler";
import { readPrepNote } from "./store";

// A ref the shell owns and this hook only reads.
type HostRef<T> = { readonly current: T };

// What the prep feature needs from the shell. Refs, because the callbacks below
// are stable and must see the book that is open when they run, not the one that
// was open when they were created.
export interface PrepHost {
  // The reader's live stats: lazy prep follows the page the user is on.
  stats: ViewStats | null;
  // The open book's id, null in the library. Re-read after every await: a book
  // switch mid-extraction abandons the run.
  bookIdRef: HostRef<string | null>;
  ctxRef: HostRef<{ topicId: string | null; fileName: string }>;
  currentFulltextRef: HostRef<Promise<Fulltext | null> | null>;
  // The shell's debounced-save base for the reading position; a classroom toggle
  // merges its flag into it and writes it out immediately.
  lastStateRef: { current: ViewState | null };
  pushToast(kind: "warn" | "error", message: string): void;
}

// Exactly the props PrepPanel takes, so the shell can spread them.
export interface PrepPanelBindings {
  snapshot: PrepSnapshot | null;
  loadNote(slug: string): Promise<string | null>;
  onSkip(slug: string): void;
  onRequeue(slug: string): void;
  onAdd(query: string): void;
  onStartPrep(): void;
  onRetryPlan(): void;
  onReplan(): void;
  selectedSlug?: string | null;
}

export interface PrepController {
  // Mirror of the attached pipeline, for the panel and the drawer's busy dot.
  snapshot: PrepSnapshot | null;
  panel: PrepPanelBindings;
  classroomOn: boolean;
  // Read by the shell from its own stable callbacks: the classroom flag when it
  // persists the reading position and when it assembles an AI turn, the pipeline
  // when that turn needs the classroom tools.
  classroomRef: HostRef<boolean>;
  pipelineRef: HostRef<PrepPipeline | null>;
  // A clicked [paper-slug p.N] citation selects that paper in the panel.
  setSelectedSlug(slug: string | null): void;
  toggleClassroom(): void;
  // Book open (with the book's restored flag) and book close (off): detach the
  // panel from the previous book. The pipeline keeps prepping in the background.
  reset(classroom: boolean): void;
  // Book open, once the full text is in: resume a persisted or running pipeline.
  resume(bookId: string, name: string, ft: Fulltext, restoreClassroom: boolean): Promise<void>;
}

export function usePrep(host: PrepHost): PrepController {
  const { bookIdRef, ctxRef, currentFulltextRef, lastStateRef, pushToast, stats } = host;

  // Classroom mode + lesson prep (docs/09). classroomOn is per open book and
  // resets on open/close; prepSnap mirrors the pipeline for the panel.
  const [classroomOn, setClassroomOn] = useState(false);
  const [prepSnap, setPrepSnap] = useState<PrepSnapshot | null>(null);
  const [selectedPrepSlug, setSelectedPrepSlug] = useState<string | null>(null);

  // Classroom mode (docs/09), mirrored for the shell's stable runTurn callback.
  const classroomRef = useRef(false);
  // The lesson-prep pipeline attached to the open book (module singleton; this
  // ref only tracks which one the UI is looking at) and its unsubscribe.
  const pipelineRef = useRef<PrepPipeline | null>(null);
  const prepUnsubRef = useRef<(() => void) | null>(null);
  // Paper statuses already seen, so only transitions are logged (M8).
  const prepStatusesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    classroomRef.current = classroomOn;
  }, [classroomOn]);

  // Lazy prep follows the reader: on every page change, tell the scheduler
  // which chapter the user is in so its papers prep first.
  useEffect(() => {
    const chapters = prepSnap?.state?.chapters;
    if (!chapters || !stats) return;
    pipelineRef.current?.setCurrentChapter(chapterIndexForPage(chapters, stats.pageIndex + 1));
  }, [stats, prepSnap]);

  // Persist the sticky classroom flag immediately on toggle, so it survives even
  // if the reader emits no further position change before the app closes.
  const persistClassroom = useCallback(
    (on: boolean) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      const merged = withClassroom(lastStateRef.current, on);
      lastStateRef.current = merged;
      saveViewState(bookId, merged).catch((e) => {
        console.error("failed to persist classroom mode", e);
      });
    },
    [bookIdRef, lastStateRef],
  );

  // Attach the open book's prep pipeline to the UI: subscribe the panel and
  // (re)start the background run. Idempotent — the pipeline is a module
  // singleton per survey, so re-attaching never restarts finished work.
  const attachPipeline = useCallback(
    (bookId: string, name: string, ft: Fulltext) => {
      const pipeline = getPrepPipeline(bookId, name, ft);
      pipelineRef.current = pipeline;
      prepUnsubRef.current?.();
      prepStatusesRef.current = new Map();
      const sync = () => {
        const snap = pipeline.snapshot();
        // Log paper status transitions (not the initial statuses on attach).
        const topicId = ctxRef.current.topicId;
        for (const p of snap.state?.papers ?? []) {
          const prev = prepStatusesRef.current.get(p.slug);
          if (prev === p.status) continue;
          prepStatusesRef.current.set(p.slug, p.status);
          if (prev !== undefined && topicId) {
            logEvent(topicId, "prep-status", { slug: p.slug, status: p.status });
          }
        }
        setPrepSnap(snap);
      };
      prepUnsubRef.current = pipeline.subscribe(sync);
      sync();
      void pipeline.ensureStarted();
    },
    [ctxRef],
  );

  // First classroom press (or the panel's Start button) kicks off lesson prep.
  const startPrep = useCallback(async () => {
    const bookId = bookIdRef.current;
    const name = ctxRef.current.fileName;
    if (!bookId) return;
    const ft = await currentFulltextRef.current;
    if (bookIdRef.current !== bookId) return; // switched books while extracting
    if (!ft || ft.status !== "ok") {
      pushToast("warn", "This book has no readable text layer, so prep can't run.");
      return;
    }
    attachPipeline(bookId, name, ft);
  }, [attachPipeline, pushToast, bookIdRef, ctxRef, currentFulltextRef]);

  const toggleClassroom = useCallback(() => {
    // Outside the state updater: StrictMode double-invokes updaters, which
    // would double-log the event.
    const next = !classroomRef.current;
    const topicId = ctxRef.current.topicId;
    if (topicId) logEvent(topicId, "classroom-toggle", { on: next });
    if (next) void startPrep();
    setClassroomOn(next);
    persistClassroom(next);
  }, [startPrep, persistClassroom, ctxRef]);

  // The prep panel reads a note's body on expand (frontmatter stripped).
  const loadPrepNoteBody = useCallback(
    async (slug: string) => {
      const bookId = bookIdRef.current;
      if (!bookId) return null;
      const raw = await readPrepNote(bookId, slug);
      return raw ? parseNote(raw).body : null;
    },
    [bookIdRef],
  );

  const prepSkip = useCallback((slug: string) => pipelineRef.current?.skip(slug), []);
  const prepRequeue = useCallback((slug: string) => pipelineRef.current?.requeue(slug), []);
  const prepAdd = useCallback((query: string) => pipelineRef.current?.addPaper(query), []);
  const prepStart = useCallback(() => void startPrep(), [startPrep]);
  const prepRetryPlan = useCallback(() => pipelineRef.current?.retryPlan(), []);
  const prepReplan = useCallback(() => pipelineRef.current?.replan(), []);

  // Detach the prep UI; the pipeline keeps prepping in the background.
  const resetPrep = useCallback((classroom: boolean) => {
    setClassroomOn(classroom);
    setSelectedPrepSlug(null);
    prepUnsubRef.current?.();
    prepUnsubRef.current = null;
    pipelineRef.current = null;
    setPrepSnap(null);
  }, []);

  // Resume lesson prep from its persisted state (docs/09: restartable
  // from the breakpoint) or re-attach a pipeline already running. A
  // restored classroom flag also kicks a fresh pipeline when none exists
  // yet (e.g. the book moved devices) — the same path a manual toggle-on
  // takes via startPrep.
  const resumePrep = useCallback(
    async (bookId: string, name: string, ft: Fulltext, restoreClassroom: boolean) => {
      try {
        if (restoreClassroom || peekPrepPipeline(bookId) || (await hasPrepState(bookId))) {
          if (bookIdRef.current === bookId) attachPipeline(bookId, name, ft);
        }
      } catch (e) {
        console.warn("failed to resume lesson prep", e);
      }
    },
    [attachPipeline, bookIdRef],
  );

  return {
    snapshot: prepSnap,
    panel: {
      snapshot: prepSnap,
      loadNote: loadPrepNoteBody,
      onSkip: prepSkip,
      onRequeue: prepRequeue,
      onAdd: prepAdd,
      onStartPrep: prepStart,
      onRetryPlan: prepRetryPlan,
      onReplan: prepReplan,
      selectedSlug: selectedPrepSlug,
    },
    classroomOn,
    classroomRef,
    pipelineRef,
    setSelectedSlug: setSelectedPrepSlug,
    toggleClassroom,
    reset: resetPrep,
    resume: resumePrep,
  };
}
