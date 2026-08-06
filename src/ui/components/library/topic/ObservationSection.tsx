// The AI observations section of a topic (docs/31, "界面"). They have always been
// stored per topic (docs/02, src/observation), so this is where they belong, and
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
  onObservationChange,
  type Observation,
} from "../../../../observation";
import ObservationPanel from "../../reader/ObservationPanel";

export default function ObservationSection({ topicId }: { topicId: string }) {
  // null while loading; [] when nothing has been distilled for this topic.
  const [entries, setEntries] = useState<Observation[] | null>(null);
  const [lastDistilledAt, setLastDistilledAt] = useState<number | null>(null);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const [list, last] = await Promise.all([
          getObservationAdapter(topicId).listObservations(),
          getLastDistillation(topicId),
        ]);
        setEntries(list);
        setLastDistilledAt(last);
      } catch (e) {
        console.warn("failed to load observations", e);
        setEntries([]);
      }
    })();
  }, [topicId]);

  useEffect(() => {
    setEntries(null);
    setLastDistilledAt(null);
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

  return <ObservationPanel entries={entries} lastDistilledAt={lastDistilledAt} />;
}
