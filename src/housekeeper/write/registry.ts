// What a domain says about a kind the AI may change (docs/platform/687 登记).
// The palace row carries `ai: { write: true }`; the domain registers the entry
// below at boot under the same kind name, and edit_data only lets through the
// kinds where both halves are there.

import type { PalaceRow } from "../../palace";

/** Who asked for a write: the conversation, the run, the place. Stored on versions and pending records. */
export interface Initiator {
  threadId?: string;
  runId?: string;
  place?: string;
}

/** What a domain's check, land and restore are told about the write in hand. */
export interface WriteContext {
  kind: string;
  id: string | null;
  /** The user's reason, in their words. */
  why: string;
  initiator: Initiator;
  now: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One thing wrong with a write, said so the model can fix its program: a field path and a sentence. */
export interface Problem {
  path: string;
  message: string;
}

/** A field the program computes, and which input to change instead. */
export interface ComputedField {
  path: string;
  input: string;
}

/** Why a write waits for the reader to confirm it. */
export type Gate = "replace" | "delete" | "send";

/** What landing a write came to: lines for the model, or why nothing was written. */
export type Landed = { ok: true; notes: readonly string[] } | { ok: false; reason: string };

export interface WritableEntry<T = unknown> {
  /** The palace row's kind name; the row must carry `ai.write`. */
  kind: string;
  /** The copy the sandbox gets and the base it was read at (textBase of the file text). Null when there is no such data. */
  open(id: string | null): Promise<{ value: T; base: string } | null>;
  /** A TypeScript declaration of the copy, each field marked input, computed (from what) or locked. */
  shape: string;
  /** Guard 1: whether the returned value reads as this kind. */
  parse(value: unknown): Parsed<T>;
  /** Guard 2: computed fields, by path pattern (`a.*.b`). */
  computed: readonly ComputedField[];
  /** Guard 2: fields nobody writes, by path pattern. */
  locked: readonly string[];
  /** Guard 3: the domain's own rules. */
  check(before: T, after: T, ctx: WriteContext): readonly Problem[] | Promise<readonly Problem[]>;
  /** Guard 4: whether the reader has to confirm this change. */
  gate(before: T, after: T): Gate | null;
  /** Recompute, write through the domain's own store, set off what follows. */
  land(before: T, after: T, ctx: WriteContext): Promise<Landed>;
  /** Put an earlier file text back. Without one, the text is parsed and landed. */
  restore?(beforeText: string, ctx: WriteContext): Promise<Landed>;
  /** What changed, one line each in the user's terms. */
  describe(before: T, after: T): readonly string[];
}

const entries = new Map<string, WritableEntry<never>>();

/** Register a domain's entry. The same kind again replaces it. Returns the undo. */
export function registerWritable<T>(entry: WritableEntry<T>): () => void {
  const held = entry as unknown as WritableEntry<never>;
  entries.set(entry.kind, held);
  return () => {
    if (entries.get(entry.kind) === held) entries.delete(entry.kind);
  };
}

export function writableEntry(kind: string): WritableEntry<unknown> | null {
  return (entries.get(kind) as WritableEntry<unknown> | undefined) ?? null;
}

export function registeredWritables(): WritableEntry<unknown>[] {
  return [...entries.values()] as WritableEntry<unknown>[];
}

/** The rows edit_data can change: marked in the palace and registered by a domain. */
export function editableRows(
  rows: readonly PalaceRow[],
  entryOf: (kind: string) => WritableEntry<unknown> | null = writableEntry,
): PalaceRow[] {
  return rows.filter((row) => row.ai?.write === true && entryOf(row.kind) !== null);
}

/**
 * Where one piece of a kind's data sits: the row's own path for the id, or the
 * row's one name for a fixed kind.
 */
export function dataPath(row: PalaceRow, id: string | null): string {
  if (id !== null && row.pathFor) return row.pathFor(id);
  if (id === null && row.id === "fixed" && row.samples.length > 0) return row.samples[0]!;
  throw new Error(`housekeeper: no path for ${row.kind}${id === null ? "" : ` "${id}"`}`);
}

/**
 * What the write guard holds the two halves to (tests/housekeeper/write-guard.test.ts):
 * every marked row has an entry, every entry a marked row, and none of them is
 * a file this device only publishes.
 */
export function writeGuardProblems(rows: readonly PalaceRow[], registered: readonly { kind: string }[]): string[] {
  const out: string[] = [];
  const kinds = new Set(registered.map((e) => e.kind));
  for (const row of rows) {
    if (row.ai?.write !== true) continue;
    if (!kinds.has(row.kind)) out.push(`${row.kind}: marked ai.write but no entry is registered`);
    if (row.sync === "remote-only") out.push(`${row.kind}: marked ai.write but its sync is remote-only`);
    if (!row.pathFor && row.id !== "fixed") out.push(`${row.kind}: marked ai.write but has no path for an id`);
  }
  for (const kind of kinds) {
    const row = rows.find((r) => r.kind === kind);
    if (!row) out.push(`${kind}: an entry is registered but the palace has no such kind`);
    else if (row.ai?.write !== true) out.push(`${kind}: an entry is registered but the row is not marked ai.write`);
  }
  return out;
}
