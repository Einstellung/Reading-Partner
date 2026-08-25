// Loading for a rehearsal (docs/43): the deck a retell has built, the rehearsal
// object that deck is given through, that deck's HTML, and the passes already
// recorded against it.
//
// Small hooks rather than one: the retell header only needs to know whether a
// deck exists, the rehearsal needs the megabytes, and the list beside the
// outline needs the history. Keeping them apart is what stops opening a retell
// from reading a 20 MB file to decide whether a button is enabled.

import { useEffect, useState } from "react";
import { listDecks } from "../../../reading/slides";
import {
  listAllRehearsals,
  loadRehearsalRuns,
  readRehearsalDeck,
  type Rehearsal,
  type RehearsalRun,
} from "../../../reading/rehearsal";

// The deck registered for this retell, or null when it has none yet. `reloadKey`
// is bumped by the caller when the deck dialog closes: a deck generated in this
// sitting has to enable the button in this sitting.
export function useRetellDeckFile(
  retellId: string,
  reloadKey: number,
): { file: string | null; loading: boolean } {
  const [file, setFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listDecks()
      .catch(() => [])
      .then((decks) => {
        if (cancelled) return;
        setFile(decks.find((d) => d.retellId === retellId)?.file ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retellId, reloadKey]);

  return { file, loading };
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

// The deck itself. Null html with a null error means it is still being read.
export function useDeckHtml(file: string | null): { html: string | null; error: string | null } {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    if (!file) {
      setError("There is no deck for this rehearsal.");
      return;
    }
    void readRehearsalDeck(file)
      .then((text) => {
        if (cancelled) return;
        // The one case that is not a fault: the rehearsal came from another
        // device and the deck did not (the deck is out of the sync range, see
        // reading/rehearsal/store.ts), so the file named here was never here.
        if (text === null) setError(`The deck file is not on this device: ${file}`);
        else setHtml(text);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read the deck");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  return { html, error };
}

// This rehearsal's runs, newest first. `reloadKey` is bumped by the caller
// when a run ends, which is the only moment this device changes the list.
//
// A sync pull changes it too — another device's pass over the same deck — and
// this hook deliberately does not hear about it. The list is read when the
// rehearsal is opened, as the rehearsal itself is
// (tests/platform/sync/pull-coverage.test.ts registers both on that ground), so
// the two go stale together and reopening picks both up. Routing the pull here
// alone would refresh the history under a view still showing the copy it was
// opened with.
export function useRehearsalRuns(rehearsalId: string | null, reloadKey: number): RehearsalRun[] {
  const [runs, setRuns] = useState<RehearsalRun[]>([]);

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
