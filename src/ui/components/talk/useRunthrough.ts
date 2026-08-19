// Loading for the run-through: which deck this talk has, that deck's HTML, and
// the runs already recorded against it (docs/31).
//
// Three small hooks rather than one: the talk header only needs to know whether a
// deck exists, the run-through needs the megabytes, and the list beside the
// outline needs the history. Keeping them apart is what stops opening a talk from
// reading a 20 MB file to decide whether a button is enabled.

import { useEffect, useState } from "react";
import { listDecks, readDeckHtml } from "../../../reading/slides";
import { loadRunthroughs, type RunthroughRun } from "../../../reading/runthrough";

// The deck registered for this talk, or null when it has none yet. `reloadKey`
// is bumped by the caller when the deck dialog closes: a deck generated in this
// sitting has to enable the button in this sitting.
export function useTalkDeckFile(
  talkId: string,
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
        setFile(decks.find((d) => d.talkId === talkId)?.file ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [talkId, reloadKey]);

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
      setError("This talk has no deck yet.");
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

// This talk's run-throughs, newest first. `reloadKey` is bumped by the caller
// when a run ends, which is the only moment the list can have changed.
export function useRunthroughs(talkId: string, reloadKey: number): RunthroughRun[] {
  const [runs, setRuns] = useState<RunthroughRun[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadRunthroughs(talkId)
      .then((log) => {
        if (!cancelled) setRuns(log.runs.slice().reverse());
      })
      .catch((e: unknown) => {
        console.warn("failed to read the run-throughs", talkId, e);
      });
    return () => {
      cancelled = true;
    };
  }, [talkId, reloadKey]);

  return runs;
}
