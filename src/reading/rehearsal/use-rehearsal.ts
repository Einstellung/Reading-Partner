// Rehearsal mode's shell state (docs/31), the counterpart of prep/use-prep.ts's
// classroom flag: whether the button is on for the open book, mirrored into a
// ref so the shell's stable runTurn callback can read it.
//
// It owns nothing else. The decisions live on disk and are read fresh by each
// turn, so there is no snapshot to keep here and nothing to invalidate — a
// rehearsal spread over several sittings is the same thing as a rehearsal
// resumed after a reload.

import { useCallback, useEffect, useRef, useState } from "react";
import { logEvent } from "../../platform/app/events";

type HostRef<T> = { readonly current: T };

export interface RehearsalHost {
  ctxRef: HostRef<{ topicId: string | null }>;
}

export interface RehearsalController {
  rehearsalOn: boolean;
  // Read by the shell's stable callbacks when a turn is assembled.
  rehearsalRef: HostRef<boolean>;
  // Set the flag and log the transition. Persistence is the shell's: the two
  // mode flags are written together so a switch cannot leave both on disk.
  setRehearsal(on: boolean): void;
  // Book open (with the book's restored flag) and book close (off).
  reset(on: boolean): void;
}

export function useRehearsal(host: RehearsalHost): RehearsalController {
  const { ctxRef } = host;
  const [rehearsalOn, setOn] = useState(false);
  const rehearsalRef = useRef(false);

  useEffect(() => {
    rehearsalRef.current = rehearsalOn;
  }, [rehearsalOn]);

  const setRehearsal = useCallback(
    (on: boolean) => {
      // Outside the state updater: StrictMode double-invokes updaters, which
      // would double-log the event.
      if (on === rehearsalRef.current) return;
      const topicId = ctxRef.current.topicId;
      if (topicId) logEvent(topicId, "rehearsal-toggle", { on });
      setOn(on);
    },
    [ctxRef],
  );

  // A book open is not a toggle: it restores what the previous session left, so
  // it writes the ref directly and logs nothing.
  const reset = useCallback((on: boolean) => {
    rehearsalRef.current = on;
    setOn(on);
  }, []);

  return { rehearsalOn, rehearsalRef, setRehearsal, reset };
}
