// A link to a PDF (docs/85): the generic adapter for a bare link no site
// adapter claims. The bindery fetches it, and a PDF comes back whole, named by
// the file name the server gives it or the last segment of its path. Anything
// else is not this adapter's: a web page is read through the `web` material, not
// a bare link.
//
// Also the PDF checks the site adapters share: a server that answers a PDF link
// with an HTML page (a sign-in, a confirm step, a paper still being processed)
// has not served the document, whatever its Content-Type says.

import { oneLine } from "../../platform/std/text";
import { rejection, type Rejection } from "./gate";
import type { FetchedBytes } from "./images";
import type { BinderyDeps, Material, WholeDocument } from "./material";

/** "%PDF", the first four bytes of every PDF. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** Whether the body opens like an HTML page, after any BOM and whitespace. */
export function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 512)).replace(/^﻿?\s*/, "");
  return /^<(?:!doctype\s+html|html|head|body|!--|meta|script)\b/i.test(head);
}

/**
 * The file name a Content-Disposition header gives, the RFC 5987 `filename*`
 * before the plain `filename`; null when it names none.
 */
export function contentDispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      const name = decodeURIComponent(extended[2].trim().replace(/^"|"$/g, ""));
      if (name.trim() !== "") return name.trim();
    } catch {
      // A malformed escape: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? "").replace(/\\(.)/g, "$1").trim();
  return name === "" ? null : name;
}

/** A file name as a title: its directory and the .pdf extension off. */
export function titleFromFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return oneLine(base.replace(/\.pdf$/i, ""));
}

// The last path segment of a URL, decoded, or "" when it has none.
function lastSegment(url: URL): string {
  const segment = url.pathname.split("/").filter((s) => s !== "").pop() ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A downloaded PDF, as a document passed through whole. */
export function pdfDocument(res: FetchedBytes, sourceUrl: string, fallbackTitle: string): WholeDocument {
  const named = contentDispositionFilename(res.contentDisposition);
  const title = (named === null ? "" : titleFromFilename(named)) || fallbackTitle;
  return { kind: "whole", format: "pdf", bytes: res.bytes, title, sourceUrl };
}

/** A bare link fetched for a PDF. */
export const pdfLinkAdapter = {
  name: "pdf",
  async toManuscript(material: Material, deps: BinderyDeps): Promise<WholeDocument | Rejection> {
    if (material.kind !== "url" || !deps.fetch) {
      return rejection("no-adapter", "nothing here knows how to read a bare link to that site");
    }
    let url: URL;
    try {
      url = new URL(material.url);
    } catch {
      return rejection("no-adapter", "the link does not parse as a URL");
    }
    const pdfPath = /\.pdf$/i.test(url.pathname);
    let res: FetchedBytes;
    try {
      res = await deps.fetch(url.href);
    } catch {
      return rejection("unreachable", `${url.host} could not be reached`);
    }
    if (!res.ok) return rejection("unreachable", `${url.host} answered HTTP ${res.status}`);
    if (isPdfBytes(res.bytes)) {
      return pdfDocument(res, url.href, titleFromFilename(lastSegment(url)) || url.host);
    }
    const declaredPdf = /^application\/pdf\b/i.test(res.contentType ?? "");
    if (pdfPath || declaredPdf) {
      const served = looksLikeHtml(res.bytes) ? "a web page" : "something else";
      return rejection("unreachable", `${url.host} served ${served}, not the PDF the link names`);
    }
    return rejection("no-adapter", "the link is not a PDF, and nothing here knows how to read that site");
  },
};
