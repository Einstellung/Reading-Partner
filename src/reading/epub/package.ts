// The package document: META-INF/container.xml names it, and it names
// everything else. What comes out is the manifest (every entry the book
// declares, by id), the spine (the reading order), and the few pieces of
// metadata the shelf shows.
//
// Elements are looked up by local name in any namespace. A package document may
// be written with a prefix ("opf:package") or without one, and both are the same
// document; matching the qualified name would read one of them and not the
// other.

import { resolveZipPath, type EpubZip } from "./zip";

export interface ManifestItem {
  id: string;
  /** Archive entry path, resolved against the package document. */
  entry: string;
  mediaType: string;
  properties: string[];
}

export interface SpineItem {
  idref: string;
  entry: string;
  mediaType: string;
  /** EPUB 2 books mark front matter non-linear; it is still part of the book. */
  linear: boolean;
}

export interface EpubPackage {
  /** Archive path of the package document itself. */
  opfEntry: string;
  version: string;
  title: string | null;
  /** dc:creator, first of them: the name under the title on a shelf card. */
  creator: string | null;
  language: string | null;
  /** Manifest by item id. */
  manifest: Map<string, ManifestItem>;
  spine: SpineItem[];
  /** The EPUB 3 navigation document, when the manifest declares one. */
  navEntry: string | null;
  /** The EPUB 2 NCX, when the spine points at one. */
  ncxEntry: string | null;
  /** The cover image's archive entry, by either of the two ways it is declared. */
  coverEntry: string | null;
}

function parseXml(source: string): Document | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement) return null;
  return doc;
}

function byLocalName(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS("*", name));
}

function textOf(el: Element | undefined): string | null {
  const value = el?.textContent?.trim();
  return value ? value : null;
}

function properties(el: Element): string[] {
  const raw = el.getAttribute("properties");
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}

/** The package document's archive path, per META-INF/container.xml. */
export function readContainer(zip: EpubZip): string | null {
  const source = zip.text("META-INF/container.xml");
  if (source === null) return null;
  const doc = parseXml(source);
  if (!doc) return null;
  for (const root of byLocalName(doc, "rootfile")) {
    const path = root.getAttribute("full-path");
    if (path) return resolveZipPath("META-INF/container.xml", `/${path}`);
  }
  return null;
}

export function parsePackage(source: string, opfEntry: string): EpubPackage | null {
  const doc = parseXml(source);
  if (!doc) return null;
  const pkg = byLocalName(doc, "package")[0] ?? doc.documentElement;

  const manifest = new Map<string, ManifestItem>();
  let navEntry: string | null = null;
  let coverEntry: string | null = null;
  for (const item of byLocalName(doc, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    const props = properties(item);
    const entry: ManifestItem = {
      id,
      entry: resolveZipPath(opfEntry, href),
      mediaType: item.getAttribute("media-type") ?? "",
      properties: props,
    };
    manifest.set(id, entry);
    if (props.includes("nav")) navEntry = entry.entry;
    if (props.includes("cover-image")) coverEntry = entry.entry;
  }

  // EPUB 2's cover: a <meta name="cover" content="<manifest id>">.
  if (coverEntry === null) {
    for (const meta of byLocalName(doc, "meta")) {
      if (meta.getAttribute("name") !== "cover") continue;
      const id = meta.getAttribute("content");
      const item = id ? manifest.get(id) : undefined;
      if (item) coverEntry = item.entry;
    }
  }

  const spine: SpineItem[] = [];
  let ncxEntry: string | null = null;
  const spineEl = byLocalName(doc, "spine")[0];
  if (spineEl) {
    const toc = spineEl.getAttribute("toc");
    const ncx = toc ? manifest.get(toc) : undefined;
    if (ncx) ncxEntry = ncx.entry;
    for (const ref of byLocalName(spineEl, "itemref")) {
      const idref = ref.getAttribute("idref");
      const item = idref ? manifest.get(idref) : undefined;
      if (!idref || !item) continue;
      spine.push({
        idref,
        entry: item.entry,
        mediaType: item.mediaType,
        linear: ref.getAttribute("linear") !== "no",
      });
    }
  }

  // dc:title and dc:language, first of each. A book with a refined title has
  // several; the first is the one every reader shows.
  const title = textOf(byLocalName(doc, "title").find((el) => el.namespaceURI?.includes("/dc/")));
  const language = textOf(
    byLocalName(doc, "language").find((el) => el.namespaceURI?.includes("/dc/")),
  );
  const creator = textOf(byLocalName(doc, "creator").find((el) => el.namespaceURI?.includes("/dc/")));

  return {
    opfEntry,
    version: pkg.getAttribute("version") ?? "",
    title,
    creator,
    language,
    manifest,
    spine,
    navEntry,
    ncxEntry,
    coverEntry,
  };
}

export { parseXml };
