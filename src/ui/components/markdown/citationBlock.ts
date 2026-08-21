// Deciding whether one rendered paragraph is a pulled quote from the book,
// pure. A citation carrying a verbatim quote ([p.72 "the book's own words"])
// used to be a chip reading "p.72" and nothing else — the quote went into the
// href as highlight payload and was never shown. In a lesson the reader may not
// have opened the book at all, so those quotes are the only lines of the book
// they ever see: a citation that stands alone as its own paragraph is promoted
// to a block that prints the quote. One that sits inside a sentence stays a
// chip, because a block in the middle of a line would break the sentence in
// half.
//
// The rule reads the hast node react-markdown hands the paragraph component,
// not the React children it also hands over. Children arrive already turned
// into elements by our own overrides, so asking them what they are means
// comparing component identities and digging through props — a check that would
// keep passing while quietly matching nothing after any refactor of the anchor
// component. The hast node is the parse itself and says plainly what the
// paragraph holds.

import { parseCitationHref, type Citation } from "../../../reading/prep/anchors";

// The slice of hast this rule reads. Structurally typed rather than imported
// from the hast/react-markdown packages: it keeps this module a plain function
// over plain objects, so its tests build the two or three node shapes that
// matter by hand instead of running a markdown parse to get at them.
export interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown> | null;
  children?: HastNode[];
}

export interface QuotedCitation {
  // Handed to the citation handler on click — the same object the inline chip
  // would have passed, quote included, so the jump and highlight downstream are
  // untouched by which of the two forms was drawn.
  citation: Citation;
  quote: string;
  // The chip's visible text ("p.72", "p.72-73", "smith-2024 p.3"), which the
  // block shows as its source marker. Taken from the anchor rather than rebuilt
  // from the citation: page ranges and lists live only in the label, and a
  // second opinion about how to write one would drift from anchors.ts.
  label: string;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

// The paragraph's children minus the whitespace-only text nodes. Markdown leaves
// those around a lone link — a trailing newline before the paragraph closes is
// the common one — and they are not content the reader can see.
function meaningfulChildren(children: HastNode[]): HastNode[] {
  return children.filter((c) => !(c.type === "text" && (c.value ?? "").trim() === ""));
}

// Null unless `node` is a paragraph whose entire content is one citation link
// carrying a quote. Figure citations never carry one, so [fig:N] falls through
// here and keeps its own card.
export function quotedCitationParagraph(node: unknown): QuotedCitation | null {
  const children = (node as HastNode | null | undefined)?.children;
  if (!Array.isArray(children)) return null;
  const only = meaningfulChildren(children);
  if (only.length !== 1) return null;
  const link = only[0];
  if (link.type !== "element" || link.tagName !== "a") return null;
  const href = link.properties?.href;
  if (typeof href !== "string") return null;
  const citation = parseCitationHref(href);
  if (!citation) return null;
  const quote = citation.kind === "figure" ? undefined : citation.quote;
  if (!quote) return null;
  return { citation, quote, label: textOf(link).replace(/\s+/g, " ").trim() };
}
