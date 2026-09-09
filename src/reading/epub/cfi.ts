// EPUB canonical fragment identifiers: writing one from a node, reading one
// back, and resolving it against a tree. A CFI is the position language the
// pagination table, the reading position and the annotations are written in
// (docs/39 §1), and it is resolved here against the very same tree it was
// computed on — the sanitized spine document, whether that is the parsed copy
// the ingestion walks or the clone a page card holds (docs/63).
//
// Step numbering, from the spec: a node's element children take the even
// numbers 2, 4, 6, … in document order, and the character data between two of
// them takes the odd number in between. Steps inside a content document start
// at the children of its <html> element, which is what makes <body> "/4" — the
// spelling every CFI printed in the wild uses.
//
// The count is over the sanitized tree, before anything is injected into it: a
// renderer that adds its own nodes shifts every index after them, so a CFI
// computed against the injected tree addresses the wrong node in every other
// tree. The page card therefore adds nothing inside the book's <html> element;
// its own stylesheet and overlay sit beside it (page-card.ts).

/** The step index of a node among its parent's children, per the CFI numbering. */
function stepOf(node: Node): number | null {
  const parent = node.parentNode;
  if (!parent) return null;
  let elements = 0;
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 1) {
      elements++;
      if (child === node) return elements * 2;
      continue;
    }
    if (child.nodeType !== 3 && child.nodeType !== 4) continue;
    if (child === node) return elements * 2 + 1;
  }
  return null;
}

/** The document element of the tree `node` is in: `<html>`, wherever the tree hangs. */
export function contentRootOf(node: Node): Element | null {
  let el: Node | null = node;
  while (el) {
    if (el.nodeType === 1 && (el as Element).localName.toLowerCase() === "html") return el as Element;
    el = el.parentNode;
  }
  return null;
}

/**
 * Element steps from the document's <html> element down to `el`, e.g. "/4/10/2".
 * Null when `el` is not inside a content root.
 */
export function elementSteps(el: Element): string | null {
  const steps: number[] = [];
  let node: Node | null = el;
  const root = contentRootOf(el);
  if (!root) return null;
  while (node && node !== root) {
    const step = stepOf(node);
    if (step === null) return null;
    steps.unshift(step);
    node = node.parentNode;
  }
  if (node !== root) return null;
  return steps.map((s) => `/${s}`).join("");
}

/** Element steps down to a text node, plus its character offset: "/4/10/1:12". */
export function textSteps(text: Text, offset: number): string | null {
  const parent = text.parentElement;
  if (!parent) return null;
  const step = stepOf(text);
  if (step === null) return null;
  const root = contentRootOf(text);
  const prefix = parent === root ? "" : elementSteps(parent);
  if (prefix === null) return null;
  return `${prefix}/${step}:${Math.max(0, Math.trunc(offset))}`;
}

/**
 * The local steps for a point: a text node with an offset, or an element
 * (offset null, or an offset that is a child index which is normalized to the
 * child it names when there is one).
 */
export function pointSteps(node: Node, offset: number | null): string | null {
  if (node.nodeType === 3 || node.nodeType === 4) return textSteps(node as Text, offset ?? 0);
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  if (offset !== null && offset >= 0 && offset < el.childNodes.length) {
    const child = el.childNodes[offset];
    if (child.nodeType === 1) return elementSteps(child as Element);
    if (child.nodeType === 3 || child.nodeType === 4) return textSteps(child as Text, 0);
  }
  return elementSteps(el);
}

// The package document's spine element is the third child element of <package>
// (metadata, manifest, spine), so it is always step 6; the itemref inside it
// takes the even step its own index gives it. The idref goes in as an assertion,
// which is what lets a resolver notice that the spine has been reordered.
export function spineStep(spineIndex: number, idref: string): string {
  const assertion = idref ? `[${idref.replace(/[[\]^,;]/g, "^$&")}]` : "";
  return `/6/${(spineIndex + 1) * 2}${assertion}`;
}

/** A whole CFI: the spine step, the indirection, and the local part. */
export function epubCfi(spineIndex: number, idref: string, local: string): string {
  return `epubcfi(${spineStep(spineIndex, idref)}!${local})`;
}

/**
 * A range CFI over one document: `epubcfi(/6/8[x]!/4/2,/1:10,/3:4)`. The common
 * parent path is factored out as the spec asks; two points that share nothing
 * beyond the root leave it empty.
 */
export function epubRangeCfi(spineIndex: number, idref: string, startLocal: string, endLocal: string): string {
  const a = startLocal.split("/").filter(Boolean);
  const b = endLocal.split("/").filter(Boolean);
  let common = 0;
  while (common < a.length - 1 && common < b.length - 1 && a[common] === b[common]) common++;
  const parent = a.slice(0, common).map((s) => `/${s}`).join("");
  const start = a.slice(common).map((s) => `/${s}`).join("");
  const end = b.slice(common).map((s) => `/${s}`).join("");
  return `epubcfi(${spineStep(spineIndex, idref)}!${parent},${start},${end})`;
}

export interface ParsedCfi {
  spineIndex: number;
  idref: string | null;
  /** The steps inside the content document, without the character offset. */
  steps: number[];
  /** The character offset when the last step addresses character data. */
  offset: number | null;
}

export interface ParsedRangeCfi {
  spineIndex: number;
  idref: string | null;
  start: { steps: number[]; offset: number | null };
  end: { steps: number[]; offset: number | null };
}

const CFI_SHAPE = /^epubcfi\((.*)\)$/;

function parseAssertion(step: string): { index: number; assertion: string | null } | null {
  const m = /^(\d+)(?:\[(.*)\])?$/.exec(step);
  if (!m) return null;
  return { index: Number(m[1]), assertion: m[2] === undefined ? null : m[2].replace(/\^(.)/g, "$1") };
}

function parseLocal(localPart: string): { steps: number[]; offset: number | null } | null {
  const [stepText, offsetText] = localPart.split(":");
  const steps: number[] = [];
  for (const raw of stepText.split("/").filter((s) => s !== "")) {
    const parsed = parseAssertion(raw);
    if (!parsed) return null;
    steps.push(parsed.index);
  }
  const offset = offsetText === undefined ? null : Number(offsetText);
  if (offset !== null && !Number.isFinite(offset)) return null;
  return { steps, offset };
}

function parsePackagePart(packagePart: string): { spineIndex: number; idref: string | null } | null {
  const packageSteps = packagePart.split("/").filter((s) => s !== "");
  if (packageSteps.length !== 2 || packageSteps[0] !== "6") return null;
  const itemref = parseAssertion(packageSteps[1]);
  if (!itemref || itemref.index < 2 || itemref.index % 2 !== 0) return null;
  return { spineIndex: itemref.index / 2 - 1, idref: itemref.assertion };
}

function splitCfi(cfi: string): { packagePart: string; localPart: string } | null {
  const shape = CFI_SHAPE.exec(cfi.trim());
  if (!shape) return null;
  const body = shape[1];
  const bang = body.indexOf("!");
  if (bang < 0) return null;
  const localPart = body.slice(bang + 1);
  if (localPart.includes("!")) return null; // a second indirection
  return { packagePart: body.slice(0, bang), localPart };
}

/**
 * Read back a point CFI. Returns null for anything else — a range, a side
 * bias, a deeper indirection — because a half-understood position is worse
 * than none.
 */
export function parseEpubCfi(cfi: string): ParsedCfi | null {
  const split = splitCfi(cfi);
  if (!split) return null;
  if (split.localPart.includes(",")) return null;
  const pkg = parsePackagePart(split.packagePart);
  if (!pkg) return null;
  const local = parseLocal(split.localPart);
  if (!local || local.steps.length === 0) return null;
  return { ...pkg, ...local };
}

/** Read back a range CFI written by epubRangeCfi (or by Zotero, same grammar). */
export function parseEpubRangeCfi(cfi: string): ParsedRangeCfi | null {
  const split = splitCfi(cfi);
  if (!split) return null;
  const parts = split.localPart.split(",");
  if (parts.length !== 3) return null;
  const pkg = parsePackagePart(split.packagePart);
  if (!pkg) return null;
  const parent = parseLocal(parts[0]);
  const start = parseLocal(parts[1]);
  const end = parseLocal(parts[2]);
  if (!parent || !start || !end || parent.offset !== null) return null;
  return {
    ...pkg,
    start: { steps: [...parent.steps, ...start.steps], offset: start.offset },
    end: { steps: [...parent.steps, ...end.steps], offset: end.offset },
  };
}

/** Either kind of CFI, reduced to the point it starts at. */
export function parseCfiStart(cfi: string): ParsedCfi | null {
  const point = parseEpubCfi(cfi);
  if (point) return point;
  const range = parseEpubRangeCfi(cfi);
  if (!range) return null;
  return { spineIndex: range.spineIndex, idref: range.idref, ...range.start };
}

/**
 * Document order of two local positions in the same document: negative when
 * `a` comes first. A shorter path that is a prefix of the other is the
 * ancestor and comes first.
 */
export function compareLocal(
  a: { steps: number[]; offset: number | null },
  b: { steps: number[]; offset: number | null },
): number {
  const n = Math.min(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++) {
    if (a.steps[i] !== b.steps[i]) return a.steps[i] - b.steps[i];
  }
  if (a.steps.length !== b.steps.length) return a.steps.length - b.steps.length;
  return (a.offset ?? 0) - (b.offset ?? 0);
}

export interface ResolvedPoint {
  node: Node;
  /** A character offset for a text node; the child index 0 for an element. */
  offset: number;
}

/**
 * Walk local steps down from a content root (`<html>`). An even step picks the
 * n-th element child; an odd step picks the character data after the (n-1)-th
 * element child, and an offset past the end of the first text node there runs
 * on into the next one, which is how two adjacent text nodes are one run in
 * CFI's eyes. Null when a step names a child the tree does not have.
 */
export function resolveSteps(root: Element, steps: number[], offset: number | null): ResolvedPoint | null {
  let node: Node = root;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const children = Array.from(node.childNodes);
    if (step % 2 === 0) {
      let seen = 0;
      let hit: Node | null = null;
      for (const child of children) {
        if (child.nodeType !== 1) continue;
        seen++;
        if (seen * 2 === step) {
          hit = child;
          break;
        }
      }
      if (!hit) return null;
      node = hit;
      continue;
    }
    // Character data: the text nodes after (step - 1) / 2 element children.
    const after = (step - 1) / 2;
    let seen = 0;
    let at = 0;
    while (at < children.length && seen < after) {
      if (children[at].nodeType === 1) seen++;
      at++;
    }
    const texts: Text[] = [];
    for (let j = at; j < children.length; j++) {
      const c = children[j];
      if (c.nodeType === 1) break;
      if (c.nodeType === 3 || c.nodeType === 4) texts.push(c as Text);
    }
    if (texts.length === 0) return null;
    if (i !== steps.length - 1) return null; // character data has no children
    let remaining = Math.max(0, offset ?? 0);
    for (let j = 0; j < texts.length; j++) {
      const len = texts[j].data.length;
      if (remaining <= len || j === texts.length - 1) {
        return { node: texts[j], offset: Math.min(remaining, len) };
      }
      remaining -= len;
    }
    return null;
  }
  return { node, offset: 0 };
}

/** Resolve a point CFI's local part against a content root. */
export function resolvePoint(root: Element, parsed: ParsedCfi): ResolvedPoint | null {
  return resolveSteps(root, parsed.steps, parsed.offset);
}

/** Resolve a range CFI against a content root into a live Range. */
export function resolveRange(root: Element, parsed: ParsedRangeCfi): Range | null {
  const start = resolveSteps(root, parsed.start.steps, parsed.start.offset);
  const end = resolveSteps(root, parsed.end.steps, parsed.end.offset);
  if (!start || !end) return null;
  const doc = root.ownerDocument;
  if (!doc) return null;
  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** A live Range in a content tree, as a range CFI. Null when either end is outside the tree. */
export function rangeToCfi(range: Range, spineIndex: number, idref: string): string | null {
  const start = pointSteps(range.startContainer, range.startOffset);
  const end = pointSteps(range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  return epubRangeCfi(spineIndex, idref, start, end);
}
