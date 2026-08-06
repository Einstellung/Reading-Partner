// The Memory section of a topic (docs/31, "界面"). Memory has always been stored
// per topic (docs/02, src/observation), so this is where it belongs, and it is the
// only place it shows: the reader's sidebar used to carry a second copy keyed to
// whichever topic the open book was in, and two views of one thing is one too
// many.
//
// It loads its own entries rather than taking them from the shell: the topic is
// the only input, and the reader's copy is keyed to whichever topic the open
// book is in, which is not necessarily this one.

import { useCallback, useEffect, useState } from "react";
import {
  getLastDistillation,
  getMemoryAdapter,
  onMemoryChange,
  type MemoryEntry,
} from "../../../../observation";
import MemoryPanel from "../../reader/MemoryPanel";

export default function MemorySection({ topicId }: { topicId: string }) {
  // null while loading; [] when nothing has been distilled for this topic.
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [lastDistilledAt, setLastDistilledAt] = useState<number | null>(null);

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const [list, last] = await Promise.all([
          getMemoryAdapter(topicId).listObservations(),
          getLastDistillation(topicId),
        ]);
        setEntries(list);
        setLastDistilledAt(last);
      } catch (e) {
        console.warn("failed to load memory", e);
        setEntries([]);
      }
    })();
  }, [topicId]);

  useEffect(() => {
    setEntries(null);
    setLastDistilledAt(null);
    refresh();
  }, [refresh]);

  // A distillation or an in-chat memory write that lands while this is showing.
  useEffect(
    () =>
      onMemoryChange((changed) => {
        if (changed === topicId) refresh();
      }),
    [topicId, refresh],
  );

  return <MemoryPanel entries={entries} lastDistilledAt={lastDistilledAt} />;
}
