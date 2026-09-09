// A synthetic EPUB, built in memory. The real books this was developed against
// are copyrighted and not a byte of one is in this repository; the corpus test
// beside this file runs against a directory of them when the machine has one and
// skips itself when it does not.
//
// Everything a fixture needs to be is stated here rather than in the tests: a
// container, a package document, a navigation document with a table of contents
// and optionally a page list, one or more spine documents, and images.

import { strToU8, zipSync } from "fflate";

export interface FixtureDoc {
  /** File name inside OEBPS/. */
  name: string;
  /** Markup inside <body>. */
  body: string;
}

export interface FixtureSpec {
  docs: FixtureDoc[];
  /** Table of contents: label and href, relative to OEBPS/. */
  toc?: Array<{ label: string; href: string }>;
  /** Page list: printed page number and href, relative to OEBPS/. */
  pageList?: Array<{ label: string; href: string }>;
  /** Extra archive entries, by full archive path. */
  images?: Record<string, Uint8Array>;
  /** Leave the mimetype entry out, or write the wrong content in it. */
  mimetype?: string | null;
  title?: string;
}

function xhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title></head>
<body>${body}</body>
</html>`;
}

function navList(items: Array<{ label: string; href: string }>): string {
  return items.map((i) => `<li><a href="${i.href}">${i.label}</a></li>`).join("");
}

export function buildEpub(spec: FixtureSpec): Uint8Array {
  const title = spec.title ?? "A Synthetic Book";
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};

  const mimetype = spec.mimetype === undefined ? "application/epub+zip" : spec.mimetype;
  if (mimetype !== null) files["mimetype"] = [strToU8(mimetype), { level: 0 }];

  files["META-INF/container.xml"] = strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  for (const doc of spec.docs) files[`OEBPS/${doc.name}`] = strToU8(xhtml(title, doc.body));
  for (const [path, bytes] of Object.entries(spec.images ?? {})) files[path] = bytes;

  const navs = [
    `<nav epub:type="toc" id="toc"><ol>${navList(spec.toc ?? spec.docs.map((d, i) => ({ label: `Chapter ${i + 1}`, href: d.name })))}</ol></nav>`,
  ];
  if (spec.pageList) {
    navs.push(`<nav epub:type="page-list"><ol>${navList(spec.pageList)}</ol></nav>`);
  }
  files["OEBPS/nav.xhtml"] = strToU8(xhtml("Contents", navs.join("")));

  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...spec.docs.map(
      (d, i) => `<item id="c${i}" href="${d.name}" media-type="application/xhtml+xml"/>`,
    ),
    ...Object.keys(spec.images ?? {}).map(
      (p, i) => `<item id="img${i}" href="${p.replace(/^OEBPS\//, "")}" media-type="image/png"/>`,
    ),
  ].join("");
  const spine = spec.docs.map((_, i) => `<itemref idref="c${i}"/>`).join("");

  files["OEBPS/content.opf"] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:synthetic</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`);

  return zipSync(files);
}

/** A one-pixel PNG, so an image entry is real bytes with a real signature. */
export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

/** Filler prose, long enough to be cut into several position blocks. */
export function prose(paragraphs: number, chars = 300): string {
  const line = "the quick brown fox jumps over the lazy dog. ".repeat(20).slice(0, chars);
  return Array.from({ length: paragraphs }, (_, i) => `<p id="p${i}">${line}</p>`).join("");
}
