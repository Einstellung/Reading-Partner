// The AI observations section of a topic (docs/31, "界面"). They have always been
// stored per topic (docs/02, src/memory), so this is where they belong, and
// this is the only place they show: the reader's sidebar used to carry a second
// copy keyed to whichever topic the open book was in, and two views of one thing
// is one too many.
//
// It loads its own entries rather than taking them from the shell: the topic is
// the only input, and the reader's copy is keyed to whichever topic the open
// book is in, which is not necessarily this one.

import { useCallback, useEffect, useState } from "react";
import {
  getLastDistillation,
  getObservationAdapter,
  listObservationConflicts,
  listStatements,
  onObservationChange,
  type Observation,
  type ObservationConflict,
  type Statement,
} from "../../../../memory";
import ObservationPanel from "../../reader/ObservationPanel";

export default function ObservationSection({ topicId }: { topicId: string }) {
  // null while loading; [] when nothing has been distilled for this topic.
  const [entries, setEntries] = useState<Observation[] | null>(null);
  const [lastDistilledAt, setLastDistilledAt] = useState<number | null>(null);
  // Read on the same pass as the entries. A copy is written by sync rather than
  // by a distillation, so nothing notifies this view when one appears; opening
  // the section is when it is looked for, which is also when it can be seen.
  const [conflicts, setConflicts] = useState<ObservationConflict[]>([]);
  // Not keyed to the topic: a statement is about the reader (docs/48). Read on
  // the same pass all the same, since what writes one is a conversation, which
  // is also what writes an observation.
  const [statements, setStatements] = useState<Statement[]>([]);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const [list, last, forked, held] = await Promise.all([
          getObservationAdapter(topicId).listObservations(),
          getLastDistillation(topicId),
          // Caught on its own so an unreadable directory listing costs the
          // conflict line and not the observations beside it — and said out
          // loud, because a read that fails without a word is how the last one
          // of these went unnoticed (docs/pitfall/09).
          listObservationConflicts(topicId).catch((e): ObservationConflict[] => {
            console.warn("failed to read observation conflict copies", e);
            return [];
          }),
          // Caught on its own too: an unreadable statement file costs the
          // "About you" block, not the observations beside it.
          listStatements().catch((e): Statement[] => {
            console.warn("failed to read statements", e);
            return [];
          }),
        ]);
        setEntries(list);
        setLastDistilledAt(last);
        setConflicts(forked);
        setStatements(held);
      } catch (e) {
        console.warn("failed to load observations", e);
        setEntries([]);
      }
    })();
  }, [topicId]);

  useEffect(() => {
    setEntries(null);
    setLastDistilledAt(null);
    setConflicts([]);
    setStatements([]);
    refresh();
  }, [refresh]);

  // A distillation or an in-chat observation write that lands while this shows.
  useEffect(
    () =>
      onObservationChange((changed) => {
        if (changed === topicId) refresh();
      }),
    [topicId, refresh],
  );

  return (
    <ObservationPanel
      entries={entries}
      statements={statements}
      lastDistilledAt={lastDistilledAt}
      conflicts={conflicts}
    />
  );
}
