// The Memory Adapter narrow interface (docs/02 part 2): business code talks
// only to this, so the engine behind it can be swapped later without touching
// tools, distillation, or UI. First engine: the per-topic file store with BM25
// recall (reusing the M6 search implementation — each memory is one one-page
// document).

import { bm25Search } from "../fulltext/bm25";
import { FULLTEXT_VERSION, type SearchDoc } from "../fulltext/types";
import type { MemoryFileStore } from "./store";
import type { MemoryEntry, MemoryHit, MemoryPatch, RetainInput } from "./types";

export interface MemoryAdapter {
  // Write one fact (the write side curates: prefer correct() on an existing id
  // over retaining a near-duplicate).
  retain(input: RetainInput): Promise<MemoryEntry>;
  // Keyword recall over summaries + bodies, ranked.
  recall(query: string, limit?: number): Promise<MemoryHit[]>;
  // Everything remembered for this topic, newest first.
  listObservations(): Promise<MemoryEntry[]>;
  // Fix an existing memory; patch null deletes it (it turned out wrong).
  // Returns the corrected entry, or null when deleted / unknown id.
  correct(id: string, patch: MemoryPatch | null): Promise<MemoryEntry | null>;
  // Regenerate derived state (the index) from the memory files.
  rebuild(): Promise<void>;
}

const RECALL_LIMIT = 6;

export class FileMemoryAdapter implements MemoryAdapter {
  constructor(private store: MemoryFileStore) {}

  retain(input: RetainInput): Promise<MemoryEntry> {
    return this.store.create(input);
  }

  async recall(query: string, limit = RECALL_LIMIT): Promise<MemoryHit[]> {
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

  listObservations(): Promise<MemoryEntry[]> {
    return this.store.list();
  }

  async correct(id: string, patch: MemoryPatch | null): Promise<MemoryEntry | null> {
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
