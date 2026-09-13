// Writing the translations into the document. The only thing here that mutates
// anything, and the only place the bilingual form is decided.
//
// Every translated block is a sibling of the same element type, right after the
// original, carrying lang="zh" and the rp-zh class: a paragraph after a
// paragraph, a heading of the same level after a heading. Same type, because
// the page card's CSS styles by element (docs/64) and a translation that is a
// <div> after an <h2> would be set in body type. The exception is a list item,
// whose translation goes inside it — a sibling <li> would draw a second bullet
// and renumber an ordered list.
//
// A translated heading gets no id and is never a nav entry: the outline is the
// article's, not the translation's, and it is rebuilt from the headings that
// were there before this ran (translate-article.ts).
//
// Running twice is refused rather than made idempotent. The second run has no
// way to tell a translation it wrote from a translation somebody edited, so it
// would either double the book or silently overwrite work; the document says
// plainly that it already has translations, and that is an answer.

import { splitMasked } from "./mask";
import { hasTranslations, ZH_CLASS, ZH_LANG, type TranslatableBlock } from "./segment";

/** Block containers a list item's translation has to stay above. */
const NESTED_CONTAINERS = new Set(["ul", "ol", "dl", "table", "figure", "blockquote"]);

export class AlreadyTranslatedError extends Error {
  constructor() {
    super("this document already carries translations");
    this.name = "AlreadyTranslatedError";
  }
}

/** An id on a cloned fragment would be a second element answering to it. */
function stripIds(el: Element): void {
  el.removeAttribute("id");
  for (const child of Array.from(el.querySelectorAll("[id]"))) child.removeAttribute("id");
}

function fill(doc: Document, target: Element, text: string, block: TranslatableBlock): void {
  for (const part of splitMasked(text)) {
    if (part.kind === "text") {
      if (part.text !== "") target.appendChild(doc.createTextNode(part.text));
      continue;
    }
    const mask = block.masks[part.index - 1];
    if (!mask) {
      // A placeholder the block never had. It is three characters of text.
      target.appendChild(doc.createTextNode(`⟦${part.index}⟧`));
      continue;
    }
    const clone = mask.node.cloneNode(true) as Element;
    stripIds(clone);
    target.appendChild(clone);
  }
}

/**
 * Put one translation beside its block. Exported for the tests; the run uses
 * applyTranslations below, which is the one that refuses a second pass.
 */
export function applyOne(block: TranslatableBlock, text: string): Element | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const el = block.element;
  const doc = el.ownerDocument;
  if (!doc) return null;

  if (block.mode === "sibling") {
    const sibling = doc.createElement(el.localName);
    sibling.setAttribute("class", ZH_CLASS);
    sibling.setAttribute("lang", ZH_LANG);
    fill(doc, sibling, trimmed, block);
    el.parentNode?.insertBefore(sibling, el.nextSibling);
    return sibling;
  }

  const nested = doc.createElement("div");
  nested.setAttribute("class", ZH_CLASS);
  nested.setAttribute("lang", ZH_LANG);
  fill(doc, nested, trimmed, block);
  // Above any list nested under this item, so the translation stays with the
  // line it translates rather than after the sub-list.
  const stop = Array.from(el.children).find((c) =>
    NESTED_CONTAINERS.has(c.localName.toLowerCase()),
  );
  el.insertBefore(nested, stop ?? null);
  return nested;
}

/**
 * Write every translation into the document. Throws when the document already
 * has translations, and skips a block the model returned nothing for rather
 * than writing an empty paragraph into the page.
 *
 * Returns how many blocks were given a translation.
 */
export function applyTranslations(
  root: Document | Element,
  blocks: readonly TranslatableBlock[],
  translations: ReadonlyMap<string, string>,
): number {
  if (hasTranslations(root)) throw new AlreadyTranslatedError();
  let written = 0;
  for (const block of blocks) {
    const text = translations.get(block.id);
    if (text === undefined) continue;
    if (applyOne(block, text)) written++;
  }
  return written;
}
