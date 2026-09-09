// EPUB canonical fragment identifiers, the generating half. A CFI is the one
// position language both candidate renderers speak natively and the one Zotero's
// EPUB annotations are written in (docs/39 §1), so a position block's start is
// recorded as one from the day the pagination table is first written — the
// reading line can then resolve it without the table being rebuilt.
//
// Only what a position needs is here: the package step to a spine item, the
// indirection into that document, element steps, and an optional text-node step
// with a character offset. Ranges and side bias are the annotation line's, and
// resolving a CFI back to a node is the renderer's.
//
// Step numbering, from the spec: a node's element children take the even numbers
// 2, 4, 6, … in document order, and the character data between two of them takes
// the odd number in between. Steps inside a content document start at the
// children of its <html> element, which is what makes <body> "/4" — the spelling
// every CFI printed in the wild uses.
//
// The count is over the sanitized tree, before anything is injected into it: a
// renderer that adds its own nodes shifts every index after them, so a CFI
// computed against the injected tree addresses the wrong node in every other
// tree (docs/39 §1).

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

/**
 * Element steps from the document's <html> element down to `el`, e.g. "/4/10/2".
 * Null when `el` is not inside a document element.
 */
export function elementSteps(el: Element): string | null {
  const steps: number[] = [];
  let node: Node | null = el;
  const root = el.ownerDocument?.documentElement;
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
  const root = text.ownerDocument?.documentElement;
  const prefix = parent === root ? "" : elementSteps(parent);
  if (prefix === null) return null;
  return `${prefix}/${step}:${Math.max(0, Math.trunc(offset))}`;
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

export interface ParsedCfi {
  spineIndex: number;
  idref: string | null;
  /** The steps inside the content document, without the character offset. */
  steps: number[];
  /** The character offset when the last step addresses character data. */
  offset: number | null;
}

const CFI_SHAPE = /^epubcfi\((.*)\)$/;

function parseAssertion(step: string): { index: number; assertion: string | null } | null {
  const m = /^(\d+)(?:\[(.*)\])?$/.exec(step);
  if (!m) return null;
  return { index: Number(m[1]), assertion: m[2] === undefined ? null : m[2].replace(/\^(.)/g, "$1") };
}

/**
 * Read back a CFI this module wrote. Returns null for anything else — a range,
 * a side bias, a deeper indirection — because nothing here produces those and a
 * half-understood position is worse than none.
 */
export function parseEpubCfi(cfi: string): ParsedCfi | null {
  const shape = CFI_SHAPE.exec(cfi.trim());
  if (!shape) return null;
  const body = shape[1];
  if (body.includes(",")) return null; // a range
  const bang = body.indexOf("!");
  if (bang < 0) return null;
  const packagePart = body.slice(0, bang);
  const localPart = body.slice(bang + 1);
  if (localPart.includes("!")) return null; // a second indirection

  const packageSteps = packagePart.split("/").filter((s) => s !== "");
  if (packageSteps.length !== 2 || packageSteps[0] !== "6") return null;
  const itemref = parseAssertion(packageSteps[1]);
  if (!itemref || itemref.index < 2 || itemref.index % 2 !== 0) return null;

  const [stepText, offsetText] = localPart.split(":");
  const steps: number[] = [];
  for (const raw of stepText.split("/").filter((s) => s !== "")) {
    const parsed = parseAssertion(raw);
    if (!parsed) return null;
    steps.push(parsed.index);
  }
  if (steps.length === 0) return null;
  const offset = offsetText === undefined ? null : Number(offsetText);
  if (offset !== null && !Number.isFinite(offset)) return null;

  return {
    spineIndex: itemref.index / 2 - 1,
    idref: itemref.assertion,
    steps,
    offset,
  };
}
