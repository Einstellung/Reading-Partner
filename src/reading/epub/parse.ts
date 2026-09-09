// Opening an EPUB: container, package, spine documents, navigation. Everything
// after this point works on the result rather than on the archive.
//
// Every spine document is sanitized on the way in and the sanitized tree is the
// only one anything downstream sees (sanitize.ts). The text, the offsets, the
// figure positions and the locators are all computed against that tree, so what
// the renderer will eventually be handed and what the AI was told about are the
// same document.

import { extractDocumentText, type DocumentText } from "./text";
import { parseNavDocument, parseNcx, type NavLists } from "./nav";
import { parsePackage, readContainer, type EpubPackage } from "./package";
import { sanitizeDocument, type ResourceRefs } from "./sanitize";
import { openZip, type EpubZip } from "./zip";

export interface SpineDocument {
  /** Position in the spine, 0-based. Half of every locator. */
  index: number;
  idref: string;
  entry: string;
  /** Sanitized markup, and the tree parsed back from exactly those bytes. */
  html: string;
  doc: Document;
  text: DocumentText;
  refs: ResourceRefs;
}

export interface EpubBook {
  zip: EpubZip;
  pkg: EpubPackage;
  docs: SpineDocument[];
  nav: NavLists;
}

export class EpubParseError extends Error {}

export function parseEpub(bytes: Uint8Array): EpubBook {
  const zip = openZip(bytes);
  const opfEntry = readContainer(zip);
  if (!opfEntry) throw new EpubParseError("no META-INF/container.xml rootfile");
  const opf = zip.text(opfEntry);
  if (opf === null) throw new EpubParseError(`package document missing: ${opfEntry}`);
  const pkg = parsePackage(opf, opfEntry);
  if (!pkg) throw new EpubParseError(`package document could not be parsed: ${opfEntry}`);
  if (pkg.spine.length === 0) throw new EpubParseError("the spine is empty");

  const docs: SpineDocument[] = [];
  for (const item of pkg.spine) {
    const source = zip.text(item.entry);
    if (source === null) continue;
    const sanitized = sanitizeDocument(source, item.entry);
    if (!sanitized) throw new EpubParseError("no DOMParser: an EPUB cannot be read unsanitized");
    docs.push({
      index: docs.length,
      idref: item.idref,
      entry: item.entry,
      html: sanitized.html,
      doc: sanitized.doc,
      text: extractDocumentText(sanitized.doc),
      refs: sanitized.refs,
    });
  }
  if (docs.length === 0) throw new EpubParseError("no spine document could be read");

  return { zip, pkg, docs, nav: readNav(zip, pkg) };
}

// EPUB 3's navigation document when the manifest declares one, the EPUB 2 NCX
// otherwise. A book that has both and lists nothing useful in the first falls
// through to the second rather than being left without a table of contents.
function readNav(zip: EpubZip, pkg: EpubPackage): NavLists {
  const lists: NavLists = { toc: [], pageList: [] };
  if (pkg.navEntry) {
    const source = zip.text(pkg.navEntry);
    if (source !== null) {
      const parsed = parseNavDocument(source, pkg.navEntry);
      lists.toc = parsed.toc;
      lists.pageList = parsed.pageList;
    }
  }
  if (pkg.ncxEntry && (lists.toc.length === 0 || lists.pageList.length === 0)) {
    const source = zip.text(pkg.ncxEntry);
    if (source !== null) {
      const parsed = parseNcx(source, pkg.ncxEntry);
      if (lists.toc.length === 0) lists.toc = parsed.toc;
      if (lists.pageList.length === 0) lists.pageList = parsed.pageList;
    }
  }
  return lists;
}

/** Spine index of an archive entry, or null when it is not a spine document. */
export function spineIndexOf(book: EpubBook, entry: string): number | null {
  const hit = book.docs.find((d) => d.entry === entry);
  return hit ? hit.index : null;
}
