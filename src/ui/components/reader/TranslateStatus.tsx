// The one line a running translation gets on screen (docs/67): a count while it
// runs, its closing sentence when it is over, and nothing at all the rest of the
// time. No panel — the reader asked for this in a sentence and the answer comes
// back in the conversation; this is only so the minutes in between are not
// silent.
//
// It is also where the reader is moved onto the translated document, because the
// original is deleted the moment the translation lands and this component is the
// one thing already watching the run. What to do is decided by fileToReopen
// (run.ts), which is pure and tested; this binds it.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { fileToReopen, translateRun, type Replacement } from "../../../reading/translate/run";

const subscribe = (fn: () => void): (() => void) => translateRun.subscribe(fn);
const snapshot = (): ReturnType<typeof translateRun.snapshot>["state"] =>
  translateRun.snapshot().state;

export default function TranslateStatus({
  openBookId,
  onReopen,
}: {
  // Read at the moment the run finishes, not at render: the reader may have
  // turned a dozen pages since this mounted.
  openBookId: () => string | null;
  onReopen?: (replacement: Replacement) => void;
}) {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const reopened = useRef<string | null>(null);

  useEffect(() => {
    const replacement = fileToReopen(state, openBookId());
    if (!replacement || reopened.current === replacement.hash) return;
    reopened.current = replacement.hash;
    onReopen?.(replacement);
  }, [state, openBookId, onReopen]);

  if (state.phase === "idle") return null;
  const text =
    state.phase === "running"
      ? `Translating "${state.title}" — ${state.done}/${state.total} blocks`
      : state.message;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-sm text-card-foreground shadow-lg backdrop-blur">
        <span className="truncate">{text}</span>
        {state.phase !== "running" && (
          <button
            type="button"
            className="shrink-0 text-muted-foreground can-hover:hover:text-foreground"
            onClick={() => translateRun.clear()}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
