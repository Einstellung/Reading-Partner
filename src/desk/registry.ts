// Who can open what (docs/61). The table of kinds is static (src/palace); what
// a kind can be opened into is registered at startup by the domain that owns
// the material, so this capability knows how to lay a desk without knowing what
// a book or a briefing is.
//
// Registration is by kind name and last one wins: a domain registering twice —
// two shells booting in one process, a test registering what the app already
// did — replaces the opener rather than throwing, because a duplicate here is a
// second boot and not a conflict.

import type { DeskEnv, DeskItem, DeskItemKind, DeskRef } from "./types";

const KINDS = new Map<string, DeskItemKind<never>>();

/** Register a kind's opener. Returns a function that removes it again. */
export function registerDeskItemKind<R>(kind: DeskItemKind<R>): () => void {
  const entry = kind as unknown as DeskItemKind<never>;
  KINDS.set(kind.kind, entry);
  return () => {
    if (KINDS.get(kind.kind) === entry) KINDS.delete(kind.kind);
  };
}

/** The kind names an opener has been registered for, in registration order. */
export function registeredDeskKinds(): readonly string[] {
  return [...KINDS.keys()];
}

/** Whether a kind can be opened. */
export function deskKindRegistered(kind: string): boolean {
  return KINDS.has(kind);
}

export interface OpenedDesk {
  // What actually opened, in the order it was asked for. An opener that
  // answered null contributes nothing and leaves no gap.
  items: DeskItem[];
  env: DeskEnv;
}

/**
 * Open everything on the desk, in order.
 *
 * Throws on a kind nothing has registered — a caller asking for a kind that was
 * never booted is a wiring mistake, and silently laying an empty desk would
 * turn it into a turn that answers about nothing. Throws too on two items
 * offering the same tool name, or on two items anchoring the retrieval or the
 * history: the model would be handed a name that means two things, and the
 * assembly would have to pick one behind everybody's back.
 */
export async function openDesk(
  refs: readonly DeskRef[],
  env: DeskEnv,
): Promise<OpenedDesk> {
  const items: DeskItem[] = [];
  for (const { kind, ref } of refs) {
    const entry = KINDS.get(kind);
    if (!entry) {
      throw new Error(
        `desk: nothing registered for kind "${kind}" — the domain that owns it has to register an opener at startup`,
      );
    }
    const item = await (entry.open as (r: unknown, e: DeskEnv) => Promise<DeskItem | null>)(
      ref,
      env,
    );
    if (item) items.push(item);
  }
  const seen = new Map<string, string>();
  for (const item of items) {
    for (const tool of item.tools) {
      const other = seen.get(tool.name);
      if (other) {
        throw new Error(
          `desk: "${item.kind}" and "${other}" both offer the tool "${tool.name}"`,
        );
      }
      seen.set(tool.name, item.kind);
    }
  }
  only(items, "memory");
  only(items, "history");
  return { items, env };
}

function only(items: readonly DeskItem[], field: "memory" | "history"): void {
  const carriers = items.filter((i) => i[field] !== undefined);
  if (carriers.length > 1) {
    throw new Error(
      `desk: ${carriers.map((i) => `"${i.kind}"`).join(" and ")} both carry the ${field}; only one item may`,
    );
  }
}
