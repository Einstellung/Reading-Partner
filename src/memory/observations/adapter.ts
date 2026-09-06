// The Observation Adapter narrow interface (docs/02 part 2, the Memory Adapter
// of that document): business code talks only to this, so the engine behind it
// can be swapped later without touching tools, distillation, or UI. First
// engine: the flat file store with BM25 recall (reusing the M6 search
// implementation — each observation is one one-page document).
//
// An adapter is bound to one topic even though the store under it is not: what
// a reading session loads into its prompt is still the topic it is in, and a
// mount stamps that topic onto everything it writes.

import { rankObservations } from "./recall";
import type { ObservationFileStore } from "./store";
import type {
  EvidenceAnchors,
  EvidenceDates,
  Observation,
  ObservationHit,
  ObservationPatch,
  RetainInput,
} from "./types";

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
  // More evidence for an observation whose text already says it (docs/48: the
  // text is never rewritten, the anchors only grow). Null when there is no such
  // observation. Its own method rather than a correct() with anchors only,
  // because correct() re-cleans and rewrites the body it is given and this
  // caller has no body to give.
  anchor(
    id: string,
    anchors: Partial<EvidenceAnchors>,
    observed?: EvidenceDates,
  ): Promise<Observation | null>;
  // Regenerate derived state (the index) from the observation files.
  rebuild(): Promise<void>;
}

const RECALL_LIMIT = 6;

export class FileObservationAdapter implements ObservationAdapter {
  constructor(
    private store: ObservationFileStore,
    private topicId: string,
  ) {}

  // The topic is stamped here and nowhere else: it is a fact about the mount,
  // the same way bookId is a fact about the session (types.ts).
  retain(input: RetainInput): Promise<Observation> {
    return this.store.create({ ...input, topic: this.topicId });
  }

  // This topic only, and unchanged by the cross-topic widening: the tools rank
  // the other topics in a pass of their own (recall.ts) so that this ranking —
  // its corpus, its idf, its six slots — stays exactly what it was.
  async recall(query: string, limit = RECALL_LIMIT): Promise<ObservationHit[]> {
    return rankObservations(await this.store.list(this.topicId), query, limit);
  }

  listObservations(): Promise<Observation[]> {
    return this.store.list(this.topicId);
  }

  async correct(id: string, patch: ObservationPatch | null): Promise<Observation | null> {
    if (patch === null) {
      await this.store.delete(id);
      return null;
    }
    return this.store.update(id, patch);
  }

  anchor(
    id: string,
    anchors: Partial<EvidenceAnchors>,
    observed?: EvidenceDates,
  ): Promise<Observation | null> {
    return this.store.appendAnchors(id, anchors, observed);
  }

  rebuild(): Promise<void> {
    return this.store.rebuildIndex();
  }
}
