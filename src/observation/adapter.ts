// The Observation Adapter narrow interface (docs/02 part 2, the Memory Adapter
// of that document): business code talks only to this, so the engine behind it
// can be swapped later without touching tools, distillation, or UI. First
// engine: the per-topic file store with BM25 recall (reusing the M6 search
// implementation — each observation is one one-page document).

import { bm25Search } from "../fulltext/bm25";
import { FULLTEXT_VERSION, type SearchDoc } from "../fulltext/types";
import type { ObservationFileStore } from "./store";
import type { Observation, ObservationHit, ObservationPatch, RetainInput } from "./types";

export interface ObservationAdapter {
  // Write one fact (the write side curates: prefer correct() on an existing id
  // over retaining a near-duplicate).
  retain(input: RetainInput): Promise<Observation>;
  // Keyword recall over summaries + bodies, ranked.
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

  async recall(query: string, limit = RECALL_LIMIT): Promise<ObservationHit[]> {
    const entries = await this.store.list();
    const byId = new Map(entries.map((e) => [e.id, e]));
    const docs: SearchDoc[] = entries.map((e) => ({
      label: e.id,
      fulltext: {
        version: FULLTEXT_VERSION,
        status: "ok",
        pages: [`${e.summary}\n${e.body}`],
        outline: [],
      },
    }));
    return bm25Search(query, docs, limit).flatMap((h) => {
      const entry = byId.get(h.label);
      return entry ? [{ entry, score: h.score, snippet: h.snippet }] : [];
    });
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
