// The one line a running translation gets on screen (docs/67): what the run
// says it is doing while it runs, its closing sentence when it is over, and
// nothing at all the rest of the time. No panel — the reader asked for this in a
// sentence and the answer comes back in the conversation; this is only so the
// minutes in between are not silent.
//
// The line is the run's own (docs/55 step 11): the worker writes one and the
// runner puts it on the record, at most one every thirty seconds, so what moves
// here moves by the half minute rather than by the block.
//
// It is also where the reader is moved onto the translated document, because the
// original is deleted the moment the translation lands and this component is the
// one thing already watching the run. What to do is decided by fileToReopen
// (book-run.ts), which is pure and tested; this binds it.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { fileToReopen, type Replacement, type TranslateView } from "../../../reading/translate/book-run";
import { translateWatch } from "../../../reading/translate/watch";

const subscribe = (fn: () => void): (() => void) => translateWatch().subscribe(fn);
const snapshot = (): TranslateView | null => translateWatch().snapshot();

export default function TranslateStatus({
  openDocId,
  onReopen,
}: {
  // The document on screen, read at the moment the run finishes rather than at
  // render: the reader may have turned a dozen pages since this mounted. The
  // document rather than the book, because a supplement is one too (docs/67).
  openDocId: () => string | null;
  onReopen?: (replacement: Replacement) => void;
}) {
  const view = useSyncExternalStore(subscribe, snapshot, snapshot);
  const reopened = useRef<string | null>(null);

  useEffect(() => {
    const replacement = fileToReopen(view, openDocId());
    if (!replacement || reopened.current === replacement.hash) return;
    reopened.current = replacement.hash;
    onReopen?.(replacement);
  }, [view, openDocId, onReopen]);

  if (!view) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-sm text-card-foreground shadow-lg backdrop-blur">
        <span className="truncate">{view.text}</span>
        {view.phase !== "running" && (
          <button
            type="button"
            className="shrink-0 text-muted-foreground can-hover:hover:text-foreground"
            onClick={() => translateWatch().dismiss(view.runId)}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
