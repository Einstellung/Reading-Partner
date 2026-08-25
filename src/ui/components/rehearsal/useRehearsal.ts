// Loading for the rehearsal: which deck this retell has, that deck's HTML, and
// the runs already recorded against it (docs/31).
//
// Three small hooks rather than one: the retell header only needs to know whether a
// deck exists, the rehearsal needs the megabytes, and the list beside the
// outline needs the history. Keeping them apart is what stops opening a retell from
// reading a 20 MB file to decide whether a button is enabled.

import { useEffect, useState } from "react";
import { listDecks, readDeckHtml } from "../../../reading/slides";
import { loadRehearsals, type RehearsalRun } from "../../../reading/rehearsal";

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

// The deck itself. Null html with a null error means it is still being read.
export function useDeckHtml(file: string | null): { html: string | null; error: string | null } {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    if (!file) {
      setError("This retell has no deck yet.");
      return;
    }
    void readDeckHtml(file)
      .then((text) => {
        if (cancelled) return;
        if (text === null) setError(`The deck file is missing: ${file}`);
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

// This retell's rehearsals, newest first. `reloadKey` is bumped by the caller
// when a run ends, which is the only moment this device changes the list.
//
// A sync pull changes it too — another device's pass through the same retell —
// and this hook deliberately does not hear about it. The list is read when the
// retell opens, as the retell itself is (tests/platform/sync/pull-coverage.test.ts
// registers both on that ground), so the two go stale together and reopening
// the retell picks both up. Routing the pull here alone would refresh the history
// under a retell still showing the copy it was opened with.
export function useRehearsals(retellId: string, reloadKey: number): RehearsalRun[] {
  const [runs, setRuns] = useState<RehearsalRun[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadRehearsals(retellId)
      .then((log) => {
        if (!cancelled) setRuns(log.runs.slice().reverse());
      })
      .catch((e: unknown) => {
        console.warn("failed to read the rehearsals", retellId, e);
      });
    return () => {
      cancelled = true;
    };
  }, [retellId, reloadKey]);

  return runs;
}
