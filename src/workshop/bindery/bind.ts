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

import { oneLine } from "../../platform/std/text";
import { builtInAdapter } from "./adapters";
import { buildSectionedEpub, type SectionedEpubInput } from "./build-article";
import { gateManuscript, isRejection, rejection, type Rejection } from "./gate";
import { fetchImages } from "./images";
import { manuscriptText, type Manuscript } from "./manuscript";
import type { BinderyDeps, Material } from "./material";
import { collectImageSrcs } from "./page-meta";
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

export type BindResult = Bound | Rejection;

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

/**
 * Make material into an EPUB, or say why it cannot be one. A rejection is a
 * normal answer (a sign-in wall, an empty page) and carries a sentence the
 * caller can pass on; a thrown error is a wiring or build fault.
 */
export async function bind(material: Material, deps: BinderyDeps = {}): Promise<BindResult> {
  const adapter = siteAdapterFor(material) ?? builtInAdapter(material);
  if (!adapter) {
    return rejection("no-adapter", "nothing here knows how to read a bare link to that site");
  }
  const made = await adapter.toManuscript(material, deps);
  if (isRejection(made)) return made;
  if (made.sections.length === 0) return rejection("empty", "the page has no body text");

  const turnedBack = gateManuscript(made, { minChars: adapter.minChars });
  if (turnedBack) return turnedBack;

  const { manuscript, srcs } = await withImages(made, deps);
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
      adapter: adapter.name,
      sections: manuscript.sections.length,
      chars: manuscriptText(manuscript).length,
      imagesEmbedded: manuscript.images.length,
      imagesMissing: srcs.filter((src) => !have.has(src)).length,
    },
  };
}
