// Who else's conversations distillation reads (docs/58, docs/61).
//
// Distillation started with one shape of raw material: a reading thread and the
// marks around it, both addressed by a book id. Everything else the reader says
// to this app — a briefing conversation, a call about one article — sat on disk
// and was never looked at. The palace says which kinds are raw material (a row
// with `distill`), but the table is static and reading a kind's files means
// touching the domain that writes them, which a capability may not do.
//
// So a domain registers itself at startup: the kind it speaks for, and one
// function that lists what is on disk as units. Nothing here knows what an info
// briefing is; the sweep asks for units, applies the same cursor and the same
// threshold it applies to a book's threads, and runs the same pass.

import { rowOf, type PalaceKind } from "../../palace";
import type { SourceUnit } from "../observations/arrears";

export type { SourceUnit };

export interface DistillSource {
  // The palace row this source reads. It must be a row with `distill`, or the
  // registration is a promise about a kind the catalogue does not call material.
  kind: PalaceKind;
  // Every unit on disk, with the cursor NOT applied: the pass reads the cursor
  // for itself (runDistillPass), so a source that filtered would be a second
  // opinion about what is already distilled, and the two would drift.
  listUnits(): Promise<SourceUnit[]>;
  // The meta map the unit id keys. One value today; written down rather than
  // assumed so a mark-shaped source can be added without rereading every caller.
  cursor: "distilledMessages";
  // What becomes of a unit once the cursor has passed it (docs/58). Recorded
  // only: nothing here deletes or tails anything yet.
  afterEnd: "keep" | "delete" | "tail" | "cold";
}

// By kind, so a second registration of the same kind replaces the first rather
// than doubling the units. Two shells (App, PhoneApp) and a test that boots the
// domains itself all register through here.
const sources = new Map<string, DistillSource>();

/** Register a source, answering with the undo. */
export function registerDistillSource(source: DistillSource): () => void {
  const row = rowOf(source.kind);
  if (!row.distill) {
    throw new Error(`distill source: palace row "${source.kind}" is not raw material`);
  }
  sources.set(source.kind, source);
  return () => {
    if (sources.get(source.kind) === source) sources.delete(source.kind);
  };
}

/** Every registered source, in registration order. */
export function distillSources(): readonly DistillSource[] {
  return [...sources.values()];
}

/** The source registered for a kind, or null. */
export function distillSourceOf(kind: string): DistillSource | null {
  return sources.get(kind) ?? null;
}
