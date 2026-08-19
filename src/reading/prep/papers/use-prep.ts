// The lesson-prep hub (docs/09), lifted out of App: the pipeline the panel is
// looking at, the snapshot and the selected paper. It renders nothing — the
// shell calls it and spreads `panel` into PrepPanel.
//
// What starts a run is not decided here. Both triggers — a mark landing, the
// lecture entry being pressed — are one decision across both kinds of prep and
// live in reading/session/use-prep-trigger.ts; this hook offers the `start` they
// call, plus the panel's own Start button for the reader who presses it
// directly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logEvent } from "../../../platform/app/events";
import type { ViewStats } from "../../../platform/app/reader-contract";
import type { Fulltext } from "../../../fulltext/types";
import { getPrepPipeline, hasPrepState, peekPrepPipeline } from "./live";
import { parseNote, stripModelAsides } from "./notes";
import type { PrepPipeline, PrepSnapshot } from "./pipeline";
import { chapterIndexForPage } from "./scheduler";
import { readPrepNote } from "./store";
import { prepProgress, type PrepProgress } from "../progress";

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
  // How far this document's papers have got, for the line above a conversation.
  // Null when no run is attached.
  progress: PrepProgress | null;
  panel: PrepPanelBindings;
  pipelineRef: HostRef<PrepPipeline | null>;
  // Start (or pick up) this document's paper run. Called by the trigger, which
  // has already decided that this is the kind of prep this document gets.
  // Idempotent: the pipeline is a module singleton per document.
  start(bookId: string, name: string, ft: Fulltext): void;
  // A clicked [paper-slug p.N] citation selects that paper in the panel.
  setSelectedSlug(slug: string | null): void;
  // Book open and book close: detach the panel from the previous book. The
  // pipeline keeps prepping in the background.
  reset(): void;
  // Book open, once the full text is in: resume a persisted or running pipeline.
  resume(bookId: string, name: string, ft: Fulltext): Promise<void>;
}

export function usePrep(host: PrepHost): PrepController {
  const { bookIdRef, ctxRef, currentFulltextRef, pushToast, stats } = host;

  // prepSnap mirrors the attached pipeline for the panel; it resets on
  // open/close.
  const [prepSnap, setPrepSnap] = useState<PrepSnapshot | null>(null);
  const [selectedPrepSlug, setSelectedPrepSlug] = useState<string | null>(null);

  // The lesson-prep pipeline attached to the open book (module singleton; this
  // ref only tracks which one the UI is looking at) and its unsubscribe.
  const pipelineRef = useRef<PrepPipeline | null>(null);
  const prepUnsubRef = useRef<(() => void) | null>(null);
  // Paper statuses already seen, so only transitions are logged (M8).
  const prepStatusesRef = useRef<Map<string, string>>(new Map());

  // Lazy prep follows the reader: on every page change, tell the scheduler
  // which chapter the user is in so its papers prep first.
  useEffect(() => {
    const chapters = prepSnap?.state?.chapters;
    if (!chapters || !stats) return;
    pipelineRef.current?.setCurrentChapter(chapterIndexForPage(chapters, stats.pageIndex + 1));
  }, [stats, prepSnap]);

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

  // The panel's Start button kicks off lesson prep.
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

  // The prep panel reads a note's body on expand (frontmatter stripped).
  const loadPrepNoteBody = useCallback(
    async (slug: string) => {
      const bookId = bookIdRef.current;
      if (!bookId) return null;
      const raw = await readPrepNote(bookId, slug);
      // Same cleaning read_note does: the writer's asides are noise here too —
      // expanding a note opened on "I have everything I need to write the
      // note." in all 17 notes of one survey. Page anchors are left bare: with
      // no citation host the panel renders them as text, and qualifying them
      // would only make that text longer.
      return raw ? stripModelAsides(parseNote(raw).body) : null;
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
  const resetPrep = useCallback(() => {
    setSelectedPrepSlug(null);
    prepUnsubRef.current?.();
    prepUnsubRef.current = null;
    pipelineRef.current = null;
    setPrepSnap(null);
  }, []);

  // Resume lesson prep from its persisted state (docs/09: restartable from the
  // breakpoint) or re-attach a pipeline already running. A book that was never
  // prepped stays detached until Start prep is pressed.
  const resumePrep = useCallback(
    async (bookId: string, name: string, ft: Fulltext) => {
      try {
        if (peekPrepPipeline(bookId) || (await hasPrepState(bookId))) {
          if (bookIdRef.current === bookId) attachPipeline(bookId, name, ft);
        }
      } catch (e) {
        console.warn("failed to resume lesson prep", e);
      }
    },
    [attachPipeline, bookIdRef],
  );

  // A paper is behind us once it has a note, has been given up on, or was
  // deliberately left out; the four working statuses are what is still ahead.
  const paperProgress = useMemo(() => {
    const papers = prepSnap?.state?.papers;
    if (!papers) return null;
    return prepProgress(
      papers,
      (p) => !["queued", "fetching", "digesting", "cooldown"].includes(p.status),
    );
  }, [prepSnap]);

  return {
    snapshot: prepSnap,
    progress: paperProgress,
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
    pipelineRef,
    start: attachPipeline,
    setSelectedSlug: setSelectedPrepSlug,
    reset: resetPrep,
    resume: resumePrep,
  };
}
