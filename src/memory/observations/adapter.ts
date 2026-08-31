// The Observation Adapter narrow interface (docs/02 part 2, the Memory Adapter
// of that document): business code talks only to this, so the engine behind it
// can be swapped later without touching tools, distillation, or UI. First
// engine: the per-topic file store with BM25 recall (reusing the M6 search
// implementation — each observation is one one-page document).

import { rankObservations } from "./recall";
import type { ObservationFileStore } from "./store";
import type { Observation, ObservationHit, ObservationPatch, RetainInput } from "./types";

export interface ObservationAdapter {
  // Write one fact (the write side curates: prefer correct() on an existing id
  // over retaining a near-duplicate).
  retain(input: RetainInput): Promise<Observation>;
  // Keyword recall over summaries + bodies, ranked. This topic only — reaching
  // past it is the tools' business (recall.ts), because only the mount knows
  // which other topics the reader has.
  recall(query: string, limit?: number): Promise<ObservationHit[]>;
  // Everything observed for this topic, newest first.
  listObservations(): Promise<Observation[]>;
  // Fix an existing observation; patch null deletes it (it turned out wrong).
  // Returns the corrected entry, or null when deleted / unknown id.
  correct(id: string, patch: ObservationPatch | null): Promise<Observation | null>;
  // Regenerate derived state (the index) from the observation files.
  rebuild(): Promise<void>;
}

const RECALL_LIMIT = 6;

export class FileObservationAdapter implements ObservationAdapter {
  constructor(private store: ObservationFileStore) {}

  retain(input: RetainInput): Promise<Observation> {
    return this.store.create(input);
  }

  // This topic only, and unchanged by the cross-topic widening: the tools rank
  // the other topics in a pass of their own (recall.ts) so that this ranking —
  // its corpus, its idf, its six slots — stays exactly what it was.
  async recall(query: string, limit = RECALL_LIMIT): Promise<ObservationHit[]> {
    return rankObservations(await this.store.list(), query, limit);
  }

  listObservations(): Promise<Observation[]> {
    return this.store.list();
  }

  async correct(id: string, patch: ObservationPatch | null): Promise<Observation | null> {
    if (patch === null) {
      await this.store.delete(id);
      return null;
    }
    return this.store.update(id, patch);
  }

  rebuild(): Promise<void> {
    return this.store.rebuildIndex();
  }
}
