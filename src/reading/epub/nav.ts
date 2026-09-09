// The two lists a book keeps about itself: the table of contents, and — when it
// was made from a printed edition — the page list, which is what lets [p.N] mean
// the page number printed in the paper book rather than a number this app made
// up (docs/39 §1).
//
// EPUB 3 puts both in one navigation document, marked with epub:type. EPUB 2
// puts the table of contents in an NCX and the page list in that same file's
// pageList. Both are read here and both come out in the same shape.

import { EPUB_NS } from "./sanitize";
import { parseXml } from "./package";
import { hrefFragment, resolveZipPath } from "./zip";

export interface NavEntry {
  title: string;
  /** Archive entry the link points at, resolved against the list's own path. */
  entry: string;
  /** The link's fragment, when it has one. */
  fragment: string | null;
  /** 0 for the top level of the list. */
  level: number;
}

export interface NavLists {
  toc: NavEntry[];
  pageList: NavEntry[];
}

// An HTML parse turns epub:type into a plain attribute with a colon in its name,
// an XML parse into a namespaced one. Both spellings are the same markup.
function epubType(el: Element): string {
  return (el.getAttributeNS(EPUB_NS, "type") ?? el.getAttribute("epub:type") ?? "").trim();
}

export function hasEpubType(el: Element, type: string): boolean {
  return epubType(el).split(/\s+/).includes(type);
}

function parseMarkup(source: string): Document | null {
  const xml = parseXml(source);
  if (xml) return xml;
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(source, "text/html");
}

// One <ol>/<ul> and everything under it. Nesting depth is the outline level.
function readList(list: Element, from: string, level: number, out: NavEntry[]): void {
  for (const li of Array.from(list.children)) {
    if (li.localName.toLowerCase() !== "li") continue;
    let nested: Element | null = null;
    for (const child of Array.from(li.children)) {
      const tag = child.localName.toLowerCase();
      if (tag === "ol" || tag === "ul") {
        nested = child;
        continue;
      }
      if (tag !== "a" && tag !== "span") continue;
      const href = child.getAttribute("href");
      const title = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!href) continue;
      out.push({
        title,
        entry: resolveZipPath(from, href),
        fragment: hrefFragment(href),
        level,
      });
    }
    if (nested) readList(nested, from, level + 1, out);
  }
}

function firstList(nav: Element): Element | null {
  for (const el of Array.from(nav.getElementsByTagNameNS("*", "ol"))) return el;
  for (const el of Array.from(nav.getElementsByTagNameNS("*", "ul"))) return el;
  return null;
}

/** The EPUB 3 navigation document. Missing lists come back empty, never null. */
export function parseNavDocument(source: string, navEntry: string): NavLists {
  const lists: NavLists = { toc: [], pageList: [] };
  const doc = parseMarkup(source);
  if (!doc) return lists;
  for (const nav of Array.from(doc.getElementsByTagNameNS("*", "nav"))) {
    const target = hasEpubType(nav, "toc")
      ? lists.toc
      : hasEpubType(nav, "page-list")
        ? lists.pageList
        : null;
    if (!target || target.length > 0) continue;
    const list = firstList(nav);
    if (list) readList(list, navEntry, 0, target);
  }
  return lists;
}

function readNavPoints(parent: Element, from: string, level: number, out: NavEntry[]): void {
  for (const point of Array.from(parent.children)) {
    if (point.localName.toLowerCase() !== "navpoint") continue;
    const content = point.getElementsByTagNameNS("*", "content")[0];
    const href = content?.getAttribute("src");
    const label = point.getElementsByTagNameNS("*", "text")[0];
    if (href) {
      out.push({
        title: (label?.textContent ?? "").replace(/\s+/g, " ").trim(),
        entry: resolveZipPath(from, href),
        fragment: hrefFragment(href),
        level,
      });
    }
    readNavPoints(point, from, level + 1, out);
  }
}

/** The EPUB 2 NCX: navMap for the table of contents, pageList for the pages. */
export function parseNcx(source: string, ncxEntry: string): NavLists {
  const lists: NavLists = { toc: [], pageList: [] };
  const doc = parseMarkup(source);
  if (!doc) return lists;
  const navMap = doc.getElementsByTagNameNS("*", "navMap")[0];
  if (navMap) readNavPoints(navMap, ncxEntry, 0, lists.toc);
  const pageList = doc.getElementsByTagNameNS("*", "pageList")[0];
  if (pageList) {
    for (const target of Array.from(pageList.getElementsByTagNameNS("*", "pageTarget"))) {
      const href = target.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");
      if (!href) continue;
      const label = target.getElementsByTagNameNS("*", "text")[0];
      lists.pageList.push({
        title: (label?.textContent ?? "").replace(/\s+/g, " ").trim(),
        entry: resolveZipPath(ncxEntry, href),
        fragment: hrefFragment(href),
        level: 0,
      });
    }
  }
  return lists;
}
