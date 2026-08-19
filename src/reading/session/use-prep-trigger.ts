// The one place preparation is started from (docs/09). Two triggers, no switch:
// a mark landing in the document, and the lecture entry in the top bar being
// pressed. Which of the two kinds of prep runs is reading/prep/kind.ts's answer,
// so a book gets chapter spines and a paper gets notes on the works it leans on,
// whichever trigger fired.
//
// It sits in session/ rather than in prep/ because it reaches into both halves
// of prep, and prep's root is imported by prep/papers — putting it there would
// close a directory cycle. session already owns the book's lifecycle and both
// pipelines, so this is the one place that can see all of it.
//
// Every gate is in reading/prep/trigger.ts, which is pure and tested. What is
// here is the reading of it: the refs, the extraction the entry may have to wait
// for, and the probe for a run that already exists.

import { useCallback, useRef } from "react";
import { documentShape } from "../../fulltext";
import type { Fulltext } from "../../fulltext/types";
import { annotationPage, type Annotation } from "../../platform/app/reader-contract";
import { prepTriggerDecision, type PrepTrigger } from "../prep";
import { hasChapterSpineState, peekChapterSpinePipeline } from "../prep/chapters/live";
import { hasPrepState, peekPrepPipeline } from "../prep/papers/live";

// Marks land in bursts — one stroke can save several annotations — so coalesce
// them and decide at most once every few seconds.
export const MARK_DEBOUNCE = 4000;

// A ref the shell owns and this hook only reads.
type HostRef<T> = { readonly current: T };

export interface PrepTriggerHost {
  // The open document's id, null in the library. Re-read after every await: a
  // switch mid-extraction abandons the run.
  bookIdRef: HostRef<string | null>;
  ctxRef: HostRef<{ fileName: string }>;
  currentFulltextRef: HostRef<Promise<Fulltext | null> | null>;
  annsRef: HostRef<Map<string, Annotation>>;
  // The two runs this can start, from the hubs that own them.
  startChapters(bookId: string, name: string, ft: Fulltext): Promise<void>;
  startPapers(bookId: string, name: string, ft: Fulltext): void;
}

export interface PrepTriggerController {
  // A fresh mark landed. Debounced.
  onMark(): void;
  // The reader pressed the lecture entry. Immediate, and not gated on marks.
  onEntry(): void;
  // The document is closing: the last moment this session's marks are all in.
  onClose(): void;
}

// debounceMs is the coalescing window; the tests shorten it so they do not have
// to spend four real seconds proving the window exists.
export function usePrepTrigger(
  host: PrepTriggerHost,
  debounceMs: number = MARK_DEBOUNCE,
): PrepTriggerController {
  const { annsRef, bookIdRef, ctxRef, currentFulltextRef, startChapters, startPapers } = host;

  const fire = useCallback(
    async (trigger: PrepTrigger) => {
      // Read everything the decision needs before the first await: the marks in
      // particular, because by the time an extraction finishes the reader may
      // have moved on and the map is another document's.
      const bookId = bookIdRef.current;
      const name = ctxRef.current.fileName;
      const ftPromise = currentFulltextRef.current;
      let marked = false;
      for (const a of annsRef.current.values()) {
        if (annotationPage(a as { position?: { pageIndex?: number } })) {
          marked = true;
          break;
        }
      }
      if (!bookId) return;

      // The entry can be pressed while the text is still being extracted, which
      // is exactly when the reader most needs this to have started; awaiting the
      // promise is what makes the press wait rather than fail.
      const ft = (await ftPromise) ?? null;
      const presence = {
        papers: !!peekPrepPipeline(bookId) || (await hasPrepState(bookId).catch(() => false)),
        chapters: !!peekChapterSpinePipeline(bookId) || (await hasChapterSpineState(bookId).catch(() => false)),
        shape: ft && ft.status === "ok" ? documentShape(ft) : ("unknown" as const),
      };
      if (bookIdRef.current !== bookId) return; // switched documents while extracting

      const decision = prepTriggerDecision({
        trigger,
        textReady: !!ft && ft.status === "ok",
        marked,
        presence,
      });
      if (!decision.start || !ft) return;
      if (decision.kind === "papers") startPapers(bookId, name, ft);
      else await startChapters(bookId, name, ft);
    },
    [annsRef, bookIdRef, ctxRef, currentFulltextRef, startChapters, startPapers],
  );

  const markTimer = useRef<number | null>(null);
  const onMark = useCallback(() => {
    if (markTimer.current) window.clearTimeout(markTimer.current);
    markTimer.current = window.setTimeout(() => {
      markTimer.current = null;
      void fire("mark");
    }, debounceMs);
  }, [debounceMs, fire]);

  // Pressing the entry answers the debounce too: whatever the pending mark was
  // going to start, this starts now, and leaving the timer armed would only make
  // the same idempotent call again four seconds later.
  const onEntry = useCallback(() => {
    if (markTimer.current) {
      window.clearTimeout(markTimer.current);
      markTimer.current = null;
    }
    void fire("entry");
  }, [fire]);

  // Closing the document, called with the refs about to be torn down. A run that
  // already exists is picked up here and now, synchronously, because
  // ensureStarted needs nothing from those refs; anything else goes down the
  // ordinary path and gives up if the reader has already opened something else.
  const onClose = useCallback(() => {
    if (markTimer.current) {
      window.clearTimeout(markTimer.current);
      markTimer.current = null;
    }
    const bookId = bookIdRef.current;
    if (!bookId) return;
    const running = peekChapterSpinePipeline(bookId) ?? peekPrepPipeline(bookId);
    if (running) {
      running.ensureStarted().catch(() => {});
      return;
    }
    void fire("mark");
  }, [bookIdRef, fire]);

  return { onMark, onEntry, onClose };
}
