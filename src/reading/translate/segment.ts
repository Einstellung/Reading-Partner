// Which parts of a document get a translation, and what text each of them
// sends. Pure: nothing here touches the tree it is given.
//
// A translatable block is a leaf block — a block element whose own text is not
// somebody else's block. That rule is what keeps a <blockquote><p> from being
// translated twice and what lets a list item with a nested list under it send
// only its own line.
//
// Four kinds of content are neither translated nor duplicated, and they are the
// ones whose value is their exact characters: a <pre>, a <table>, a <figure>,
// and mathematics. The block discovery never descends into them, so nothing
// inside one is ever a block; when one sits inline inside a sentence it leaves
// the text as a placeholder instead (mask.ts) and comes back at apply time.
//
// The header the article was built with (build-article.ts: prependHeader) is
// three lines of metadata and a title. The title is prose and is translated;
// the byline is a name, the date is a date and the source line is a URL, and a
// model handed one of those returns something worse than what it was given.

import { placeholder } from "./mask";

/** The class every translated block carries, and the guard against a second run. */
export const ZH_CLASS = "rp-zh";

/** The language tag translations are written in. One target, fixed (docs/67). */
export const ZH_LANG = "zh";

/** Where a block's translation goes relative to the block. */
export type InsertMode =
  /** A sibling of the same element type, right after it. A <p> after a <p>. */
  | "sibling"
  /** A <div> inside the block, after its own text. A list item's marker is not
   *  duplicated this way, and an ordered list keeps its numbering. */
  | "nested";

export interface BlockMask {
  /** The placeholder as it appears in the block's text. */
  token: string;
  /** The element the placeholder stands for, to be cloned back in. */
  node: Element;
}

export interface TranslatableBlock {
  /** Document order, 1-based: `b1`, `b2`. Stable for a given document. */
  id: string;
  element: Element;
  mode: InsertMode;
  /** The block's own text, with the untranslatable fragments masked. */
  text: string;
  masks: BlockMask[];
}

// Block elements whose own text is worth a translation. <div> is here for the
// article whose paragraphs are divs; the leaf rule keeps a wrapper out.
const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "dd", "dt", "div",
]);

// Never entered, and never translated. Their text is their meaning.
const OPAQUE_TAGS = new Set(["pre", "code", "table", "figure", "figcaption", "math", "svg"]);

// The header's metadata lines: a name, a date, a URL.
const SKIP_CLASSES = new Set(["rp-byline", "rp-published", "rp-source"]);

function tagOf(el: Element): string {
  return el.localName.toLowerCase();
}

function hasClass(el: Element, name: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(name);
}

function skipped(el: Element): boolean {
  if (hasClass(el, ZH_CLASS)) return true;
  for (const name of SKIP_CLASSES) if (hasClass(el, name)) return true;
  return false;
}

/**
 * The text a block sends, and what was masked out of it. Descends through the
 * inline markup — a link, an emphasis — because that is prose; stops at a
 * nested block, which is its own request, and at an opaque element, which
 * becomes a placeholder.
 */
function gather(block: Element): { text: string; masks: BlockMask[] } {
  const masks: BlockMask[] = [];
  const parts: string[] = [];

  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        parts.push((child as Text).nodeValue ?? "");
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = tagOf(el);
      if (skipped(el)) continue;
      if (OPAQUE_TAGS.has(tag)) {
        const token = placeholder(masks.length + 1);
        masks.push({ token, node: el });
        parts.push(token);
        continue;
      }
      // A nested block is a request of its own; its text is not this one's.
      if (BLOCK_TAGS.has(tag)) continue;
      walk(el);
    }
  };
  walk(block);

  return { text: parts.join("").replace(/\s+/g, " ").trim(), masks };
}

/**
 * Every translatable block of a document, in document order. Blocks already
 * carrying a translation are not returned, so the guard in apply.ts and this
 * agree on what a second run would find.
 */
export function segmentDocument(root: Document | Element): TranslatableBlock[] {
  const start: Element | null =
    "body" in root && (root as Document).body ? (root as Document).body : (root as Element);
  if (!start) return [];
  const blocks: TranslatableBlock[] = [];

  const visit = (el: Element): void => {
    const tag = tagOf(el);
    if (OPAQUE_TAGS.has(tag) || skipped(el)) return;
    if (BLOCK_TAGS.has(tag)) {
      const own = gather(el);
      // Punctuation and a placeholder are not a sentence; a block whose text is
      // only masked fragments has nothing to translate.
      if (own.text !== "" && /[\p{L}\p{N}]/u.test(stripMasks(own))) {
        blocks.push({
          id: `b${blocks.length + 1}`,
          element: el,
          mode: tag === "li" ? "nested" : "sibling",
          text: own.text,
          masks: own.masks,
        });
      }
    }
    for (const child of Array.from(el.children)) visit(child);
  };

  for (const child of Array.from(start.children)) visit(child);
  return blocks;
}

function stripMasks(own: { text: string; masks: BlockMask[] }): string {
  let s = own.text;
  for (const mask of own.masks) s = s.split(mask.token).join("");
  return s;
}

/** Whether a document already carries translations, which makes it not one to run on. */
export function hasTranslations(root: Document | Element): boolean {
  const scope: Document | Element = root;
  return scope.querySelector(`.${ZH_CLASS}`) !== null;
}
