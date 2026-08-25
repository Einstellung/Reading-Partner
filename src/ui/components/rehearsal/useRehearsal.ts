// Loading for a rehearsal (docs/44): the outline a talk is given against, the
// rehearsal object it is given through, and the passes already recorded against
// it.
//
// Small hooks rather than one: the retell's header only needs to know whether
// there is anything on the outline to give, the panel needs the segments
// themselves, and the strip beside the conversation needs the history.

import { useEffect, useState } from "react";
import {
  listAllRehearsals,
  loadRehearsalRuns,
  loadRunPages,
  type Rehearsal,
  type RehearsalPage,
  type RehearsalRunEntry,
} from "../../../reading/rehearsal";
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

// The rehearsal this retell's deck is given through, or null before the first
// Rehearse creates it. Read rather than created: opening a retell must not put
// an object on disk for a deck the reader may never give.
export function useRetellRehearsal(retellId: string, reloadKey: number): Rehearsal | null {
  const [rehearsal, setRehearsal] = useState<Rehearsal | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAllRehearsals()
      .then((all) => {
        if (!cancelled) setRehearsal(all.find((r) => r.retellId === retellId) ?? null);
      })
      .catch((e: unknown) => console.warn("failed to look for the rehearsal", retellId, e));
    return () => {
      cancelled = true;
    };
  }, [retellId, reloadKey]);

  return rehearsal;
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

// This rehearsal's passes, newest first — the rows only. The transcripts are a
// file each and are read when a row is opened (useRunPages below), which is what
// keeps drawing the strip to one read however many passes there have been.
//
// `reloadKey` is bumped by the caller when a run ends, which is the only moment
// this device changes the list.
//
// A sync pull changes it too — another device's pass over the same deck — and
// this hook deliberately does not hear about it. The list is read when the
// rehearsal is opened, as the rehearsal itself is
// (tests/platform/sync/pull-coverage.test.ts registers both on that ground), so
// the two go stale together and reopening picks both up. Routing the pull here
// alone would refresh the history under a view still showing the copy it was
// opened with.
export function useRehearsalRuns(
  rehearsalId: string | null,
  reloadKey: number,
): RehearsalRunEntry[] {
  const [runs, setRuns] = useState<RehearsalRunEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!rehearsalId) {
      setRuns([]);
      return;
    }
    void loadRehearsalRuns(rehearsalId)
      .then((log) => {
        if (!cancelled) setRuns(log.runs.slice().reverse());
      })
      .catch((e: unknown) => {
        console.warn("failed to read the runs", rehearsalId, e);
      });
    return () => {
      cancelled = true;
    };
  }, [rehearsalId, reloadKey]);

  return runs;
}

// What was said on each page of one pass. Read when the row is opened, and only
// then: it is the one thing about a pass that is measured in tens of KB, and a
// history of ten passes is read shut.
//
// Null means it is still being read, which the row shows as such. `[]` is a real
// answer — a pass with nothing said on any page, and a pass whose transcript did
// not survive (store.ts says why that is not an error).
export function useRunPages(entry: RehearsalRunEntry | null): RehearsalPage[] | null {
  const [pages, setPages] = useState<RehearsalPage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!entry) {
      setPages(null);
      return;
    }
    setPages(null);
    void loadRunPages(entry)
      .then((read) => {
        if (!cancelled) setPages(read);
      })
      .catch((e: unknown) => {
        console.warn("failed to read the transcript", entry.id, e);
        if (!cancelled) setPages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  return pages;
}
