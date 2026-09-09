// A precise position in a document, in the one shape both formats can be
// addressed by (docs/39 §1). Page numbers stay what they were — Fulltext.pages
// is a list of position blocks and [p.N] counts them — and this is the layer
// underneath, used by the two things a block number is too coarse for: where the
// reader is, and where a mark sits.
//
// The PDF branch is what reading/engine/convert.ts already stores, restated here
// so the two branches are one type. Nothing about the PDF path changes: this
// release defines the union and the EPUB codec, and the engine keeps writing
// what it writes.

import { parseEpubCfi } from "./epub/cfi";

export type Locator =
  | { kind: "pdf"; pageIndex: number; pageX?: number; pageY?: number }
  | { kind: "epub"; cfi: string };

/** Whether a value is a locator this app wrote. */
export function isLocator(value: unknown): value is Locator {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown; pageIndex?: unknown; cfi?: unknown };
  if (v.kind === "pdf") return typeof v.pageIndex === "number";
  if (v.kind === "epub") return typeof v.cfi === "string";
  return false;
}

/**
 * An EPUB locator's string form: the CFI itself. Kept as a named codec rather
 * than as a field read directly, because the string that goes on disk is the
 * boundary — a mark's `position.value` (docs/39 §5) and a ViewState's `cfi` both
 * hold this and nothing else.
 */
export function encodeEpubLocator(locator: { kind: "epub"; cfi: string }): string {
  return locator.cfi;
}

/**
 * Read one back. Null when the string is not a CFI this app can act on, which
 * the caller treats as "no saved position" rather than guessing at one.
 */
export function decodeEpubLocator(value: string): { kind: "epub"; cfi: string } | null {
  if (!parseEpubCfi(value)) return null;
  return { kind: "epub", cfi: value };
}
