// Binding a running turn's tools to the item they belong to. An anchor
// describes a desk from what is already read off disk; the tools are the
// turn's, bound to its card sinks, so the runner attaches them to the ref here
// rather than the anchor carrying a closure. Bindings for different kinds
// compose: each one only touches refs of its own kind.

import type { DeskRef } from "./types";

/** Every ref of `kind` gets `tools` on it; every other ref is passed through. */
export function bindItemTools(refs: readonly DeskRef[], kind: string, tools: unknown): DeskRef[] {
  return refs.map((r) =>
    r.kind === kind
      ? { kind: r.kind, ref: { ...(r.ref as object), tools } }
      : { kind: r.kind, ref: r.ref },
  );
}
