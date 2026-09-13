// Placeholders, the one thing the model is asked to carry through untouched.
//
// A translated block is text, never markup: the model is never shown a tag and
// never asked to write one, because a model that writes markup eventually
// writes markup that does not close, and the document it lands in is the one
// the pagination measured. What cannot be translated but sits inside a
// sentence — an inline <code>, an inline <math> — therefore leaves the block as
// a numbered placeholder and is put back afterwards from the original nodes.
//
// The brackets are U+27E6/U+27E7, which no prose uses and no tokenizer splits
// into something ambiguous. A model that translates the digits, drops a
// placeholder or invents one is handled by the reader below rather than by a
// retry: an absent placeholder loses an inline fragment from the translation
// and nothing else, and the original block above it still has it.

/** The placeholder standing for the nth masked fragment of a block, 1-based. */
export function placeholder(n: number): string {
  return `⟦${n}⟧`;
}

const PLACEHOLDER = /⟦(\d+)⟧/g;

/** A run of a masked string: either literal text or the nth masked fragment. */
export type MaskedPart =
  | { kind: "text"; text: string }
  | { kind: "mask"; index: number };

/**
 * Split a masked string into its literal runs and its placeholders. Pure, and
 * total: anything that does not match the placeholder shape is text, so a model
 * that wrote `⟦one⟧` has simply written three characters of prose.
 */
export function splitMasked(s: string): MaskedPart[] {
  const parts: MaskedPart[] = [];
  let at = 0;
  PLACEHOLDER.lastIndex = 0;
  for (let m = PLACEHOLDER.exec(s); m !== null; m = PLACEHOLDER.exec(s)) {
    if (m.index > at) parts.push({ kind: "text", text: s.slice(at, m.index) });
    parts.push({ kind: "mask", index: Number(m[1]) });
    at = m.index + m[0].length;
  }
  if (at < s.length) parts.push({ kind: "text", text: s.slice(at) });
  return parts;
}

/** Every placeholder number a masked string carries, in order, without repeats. */
export function placeholdersIn(s: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of splitMasked(s)) {
    if (part.kind === "mask" && !seen.has(part.index)) {
      seen.add(part.index);
      out.push(part.index);
    }
  }
  return out;
}
