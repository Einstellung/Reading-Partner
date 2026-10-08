// The bindery's one door (docs/85): material in, an EPUB and what it is out, or
// the reason there is nothing to read. It decides nothing about where the
// document goes: no topic, no library, no book. That is the calling domain's.
//
// Three steps. An adapter (a registered site adapter if one claims the
// material, else the generic one for its kind) makes a manuscript; the gate
// turns back a manuscript with no content in it; the pictures are fetched and
// the EPUB is built. A manuscript of one untitled section builds to the bytes
// buildArticleEpub has always written for the same article, so a page taken in
// again is the document already on the shelf.
//
// A site adapter may instead find the document already whole (an arXiv paper
// is its PDF). Nothing is gated or built then: its bytes are handed back as the
// site served them, with what the adapter read about it.

import { oneLine } from "../../platform/std/text";
import { builtInAdapter } from "./adapters";
import { buildSectionedEpub, type SectionedEpubInput } from "./build-article";
import { gateManuscript, isRejection, rejection, type Rejection } from "./gate";
import { fetchImages } from "./images";
import { detectLanguage } from "./language";
import { manuscriptText, type Manuscript } from "./manuscript";
import { isWholeDocument, type BinderyDeps, type Material, type WholeDocument } from "./material";
import { collectImageSrcs } from "./page-meta";
import { pdfLinkAdapter } from "./pdf";
import { siteAdapterFor } from "./registry";

/** What the built document is, for the caller to file it by. */
export interface BoundMetadata {
  /** The manuscript's title; may be empty when nothing named it. */
  title: string;
  author?: string;
  publishedAt?: string;
  sourceUrl?: string;
  /** The language the document was built as. */
  language: string;
  /** The adapter that read the material. */
  adapter: string;
  sections: number;
  /** Body characters, as plain text. */
  chars: number;
  imagesEmbedded: number;
  /** Pictures the body asked for that are placeholders in the document. */
  imagesMissing: number;
}

export interface Bound {
  ok: true;
  epub: Uint8Array;
  metadata: BoundMetadata;
}

/** What a document a site serves whole is, for the caller to file it by. */
export interface PassedMetadata {
  /** What the adapter read the document to be called; may be empty. */
  title: string;
  author?: string;
  publishedAt?: string;
  sourceUrl?: string;
  abstract?: string;
  /** The adapter that read the material. */
  adapter: string;
}

/**
 * A document a site adapter found already whole (an arXiv paper's PDF): its
 * bytes as the site served them, nothing built.
 */
export interface PassedThrough {
  ok: true;
  passedThrough: true;
  format: "pdf" | "epub";
  bytes: Uint8Array;
  metadata: PassedMetadata;
}

export type BindResult = Bound | PassedThrough | Rejection;

function passThrough(whole: WholeDocument, adapter: string): PassedThrough | Rejection {
  if (whole.bytes.length === 0) return rejection("empty", "the document is empty");
  const optional = (value: string | undefined) => oneLine(value ?? "");
  const metadata: PassedMetadata = { title: optional(whole.title), adapter };
  for (const key of ["author", "publishedAt", "abstract"] as const) {
    const value = optional(whole[key]);
    if (value !== "") metadata[key] = value;
  }
  const sourceUrl = (whole.sourceUrl ?? "").trim();
  if (sourceUrl !== "") metadata.sourceUrl = sourceUrl;
  return { ok: true, passedThrough: true, format: whole.format, bytes: whole.bytes, metadata };
}

/** The build's input for a manuscript. Exported for the byte-identity test. */
export function manuscriptEpubInput(m: Manuscript): SectionedEpubInput {
  return {
    title: m.title,
    byline: m.author,
    sourceUrl: m.sourceUrl ?? "",
    publishedAt: m.publishedAt,
    language: m.language,
    sections: m.sections,
    images: m.images,
  };
}

// Pictures, when the adapter did not bring its own and there is a fetch.
async function withImages(
  m: Manuscript,
  deps: BinderyDeps,
): Promise<{ manuscript: Manuscript; srcs: string[] }> {
  const html = m.sections.map((s) => s.html).join("\n");
  const base = m.sourceUrl ?? "";
  const srcs = collectImageSrcs(html, base).map((s) => s.src);
  if (m.images.length > 0 || !deps.fetch || srcs.length === 0) return { manuscript: m, srcs };
  const { images } = await fetchImages(html, base, deps.fetch);
  return { manuscript: { ...m, images }, srcs };
}

/** A manuscript that passed the gate, and the adapter that read it. */
export interface ReadManuscript {
  ok: true;
  manuscript: Manuscript;
  adapter: string;
}

/**
 * The first two steps without the third: the adapter reads the material and the
 * gate looks at what it made. For a caller that needs the text and not a
 * document (prep's add-link reads a page into its notes and files nothing), so
 * the page is read by the same adapter and turned back by the same gate as one
 * that becomes a document. No picture is fetched. A document a site serves
 * whole comes back as it does from bind, since there is no manuscript to read.
 */
export async function readMaterial(
  material: Material,
  deps: BinderyDeps = {},
): Promise<ReadManuscript | PassedThrough | Rejection> {
  // A bare link no site adapter claims is fetched once for a PDF (pdf.ts).
  const adapter =
    siteAdapterFor(material) ?? (material.kind === "url" ? pdfLinkAdapter : builtInAdapter(material));
  if (!adapter) {
    return rejection("no-adapter", "nothing here knows how to read a bare link to that site");
  }
  const made = await adapter.toManuscript(material, deps);
  if (isRejection(made)) return made;
  if (isWholeDocument(made)) return passThrough(made, adapter.name);
  if (made.sections.length === 0) return rejection("empty", "the page has no body text");

  const minChars = "minChars" in adapter ? adapter.minChars : undefined;
  const turnedBack = gateManuscript(made, { minChars });
  if (turnedBack) return turnedBack;
  return { ok: true, manuscript: withLanguage(made), adapter: adapter.name };
}

// A manuscript that declares no language is given the one its text shows, when
// the text shows one (language.ts). A declared language is never second-guessed,
// so a page that says what it is builds to the bytes it always did.
function withLanguage(m: Manuscript): Manuscript {
  if (oneLine(m.language ?? "") !== "") return m;
  const detected = detectLanguage(manuscriptText(m));
  return detected === undefined ? m : { ...m, language: detected };
}

/**
 * Make material into an EPUB, or say why it cannot be one. A rejection is a
 * normal answer (a sign-in wall, an empty page) and carries a sentence the
 * caller can pass on; a thrown error is a wiring or build fault.
 */
export async function bind(material: Material, deps: BinderyDeps = {}): Promise<BindResult> {
  const read = await readMaterial(material, deps);
  if (!read.ok || "passedThrough" in read) return read;

  const { manuscript, srcs } = await withImages(read.manuscript, deps);
  const epub = await buildSectionedEpub(manuscriptEpubInput(manuscript));
  const have = new Set(manuscript.images.map((i) => i.src));
  return {
    ok: true,
    epub,
    metadata: {
      title: manuscript.title,
      ...(manuscript.author === undefined ? {} : { author: manuscript.author }),
      ...(manuscript.publishedAt === undefined ? {} : { publishedAt: manuscript.publishedAt }),
      ...(manuscript.sourceUrl === undefined ? {} : { sourceUrl: manuscript.sourceUrl }),
      language: oneLine(manuscript.language ?? "") || "en",
      adapter: read.adapter,
      sections: manuscript.sections.length,
      chars: manuscriptText(manuscript).length,
      imagesEmbedded: manuscript.images.length,
      imagesMissing: srcs.filter((src) => !have.has(src)).length,
    },
  };
}
