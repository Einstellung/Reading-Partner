// The readable manuscript (docs/85): what every adapter turns its material into
// and the one thing the EPUB build reads. Whatever the material was — a web
// page, a thread, pasted text — by the time it is a manuscript it is a title,
// what is known about where it came from, and clean HTML in reading order.

import { htmlToText } from "../extract/sanitize";
import type { ArticleImage } from "./build-article";

export type ManuscriptImage = ArticleImage;

export interface ManuscriptSection {
  /** The section's own title, written above it and listed in the outline. */
  heading?: string;
  /** Body HTML: an article body, not a page. Sanitized again when built. */
  html: string;
}

export interface Manuscript {
  title: string;
  author?: string;
  /** ISO date or datetime, as the source declared it. */
  publishedAt?: string;
  sourceUrl?: string;
  /** BCP 47 language tag. */
  language?: string;
  /**
   * In reading order, at least one. Each section starts on a page of its own;
   * posts that should read as one flow (a thread) belong in one section.
   */
  sections: ManuscriptSection[];
  /** Pictures the sections reference, matched by their src exactly as spelled. */
  images: ManuscriptImage[];
}

/** The body as plain text, sections apart by a blank line. Headings are not body. */
export function manuscriptText(m: Manuscript): string {
  return m.sections
    .map((s) => htmlToText(s.html))
    .filter((t) => t !== "")
    .join("\n\n");
}
