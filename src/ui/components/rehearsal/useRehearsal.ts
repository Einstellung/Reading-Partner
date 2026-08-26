// Loading for a rehearsal (docs/44): the outline a talk is given against.
//
// Two hooks rather than one: the retell's header only needs to know whether
// there is anything on the outline to give, the panel needs the segments
// themselves.
//
// The passes are not read here. They are recorded and they are counted in the
// topic's Rehearsal section, but the retell does not show a history — there is
// no view in it for one to be read into.

import { useEffect, useState } from "react";
import {
  loadTalkOutline,
  talkOutlineOfRetell,
  type TalkOutline,
} from "../../../reading/talk";

// The outline of this retell's talk, or null when the conversation has not
// arranged one yet. Read and never created: opening a retell must not put an
// outline on disk for a talk nobody has arranged. `reloadKey` is bumped by the
// caller when something that could have written one is done with.
//
// It is what the Rehearse button is gated on (rehearsal.ts): a talk with no
// segments has nothing to put on the panel.
export function useRetellOutline(
  retellId: string,
  reloadKey: number,
): { outline: TalkOutline | null; loading: boolean } {
  const [outline, setOutline] = useState<TalkOutline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void talkOutlineOfRetell(retellId)
      .catch((e: unknown) => {
        console.warn("failed to look for the outline of", retellId, e);
        return null;
      })
      .then((found) => {
        if (cancelled) return;
        setOutline(found);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retellId, reloadKey]);

  return { outline, loading };
}

// The talk a rehearsal is given against. Null with a null error means it is
// still being read; an error is an outline this build cannot open, which is the
// one case where the panel has nothing to show and says so instead of showing an
// empty talk.
export function useTalkOutline(outlineId: string): {
  outline: TalkOutline | null;
  error: string | null;
} {
  const [outline, setOutline] = useState<TalkOutline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOutline(null);
    setError(null);
    void loadTalkOutline(outlineId)
      .then((read) => {
        if (cancelled) return;
        if (read) setOutline(read);
        else setError("The outline for this talk is not on this device.");
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read the outline");
      });
    return () => {
      cancelled = true;
    };
  }, [outlineId]);

  return { outline, error };
}
