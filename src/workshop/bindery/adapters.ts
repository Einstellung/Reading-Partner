// The generic adapters the bindery carries itself (docs/85): a fetched web page,
// HTML that already is the body, plain text, and Markdown. None of them knows a
// website; those are site adapters, registered by the domains (registry.ts).
//
// An adapter only reads. Pictures are fetched by the bindery after the gate, so
// material that is turned back costs no image downloads.

import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { escapeHtmlText, oneLine } from "../../platform/std/text";
import { htmlToText } from "../extract/sanitize";
import { rejection } from "./gate";
import type { Manuscript } from "./manuscript";
import type { Adapter, Material, MaterialKind, MaterialMeta } from "./material";
import { pageLanguage, readPageMeta } from "./page-meta";

type Of<K extends MaterialKind> = Extract<Material, { kind: K }>;

// A title made from the first line of a body, when nothing else names it.
const MAX_DERIVED_TITLE = 120;

function derivedTitle(text: string): string {
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return oneLine(first).slice(0, MAX_DERIVED_TITLE).trim();
}

// The caller's metadata, with absent and blank fields left out.
function given(meta: MaterialMeta): Omit<Manuscript, "title" | "sections" | "images"> {
  const out: Omit<Manuscript, "title" | "sections" | "images"> = {};
  const author = oneLine(meta.author ?? "");
  if (author !== "") out.author = author;
  const publishedAt = oneLine(meta.publishedAt ?? "");
  if (publishedAt !== "") out.publishedAt = publishedAt;
  const sourceUrl = (meta.sourceUrl ?? "").trim();
  if (sourceUrl !== "") out.sourceUrl = sourceUrl;
  const language = oneLine(meta.language ?? "");
  if (language !== "") out.language = language;
  return out;
}

/**
 * A web page as fetched: Readability (defuddle when it comes up short) cuts the
 * article out of it, and the page's own head says who wrote it, when, and in
 * what language. What it builds is what an ingested article has always been.
 */
export const webAdapter: Adapter<Of<"web">> = {
  name: "web",
  // A short news item in Chinese runs to a couple of hundred characters; a JS
  // shell or a login wall is caught by the gate's patterns, not by length.
  minChars: 200,
  async toManuscript(material, deps) {
    if (!deps.extractReadable) throw new Error("the web adapter needs extractReadable");
    const extraction = deps.extractReadable(material.html, material.url);
    if (!extraction || extraction.textContent.trim() === "") {
      return rejection("empty", "no readable article text was found on the page");
    }
    const meta = readPageMeta(material.html);
    const language = pageLanguage(material.html);
    return {
      title: extraction.title.trim() || (material.fallbackTitle ?? "").trim(),
      ...(meta.byline === undefined ? {} : { author: meta.byline }),
      ...(meta.publishedAt === undefined ? {} : { publishedAt: meta.publishedAt }),
      sourceUrl: material.url,
      ...(language === undefined ? {} : { language }),
      sections: [{ html: extraction.contentHtml }],
      images: [],
    };
  },
};

const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const FIRST_HEADING = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i;

/**
 * HTML that is already the body: what a site adapter or the app itself wrote.
 * Nothing is cut out of it. A whole page is accepted too, and its head supplies
 * whatever the caller did not.
 */
export const htmlAdapter: Adapter<Of<"html">> = {
  name: "html",
  // Handed over by the reader, not scraped: anything not empty is content.
  minChars: 1,
  async toManuscript(material) {
    const meta = readPageMeta(material.html);
    const titleFrom = (re: RegExp) => oneLine(htmlToText(re.exec(material.html)?.[1] ?? ""));
    const title =
      oneLine(material.title ?? "") || titleFrom(TITLE_TAG) || titleFrom(FIRST_HEADING);
    return {
      title,
      ...given({
        author: meta.byline,
        publishedAt: meta.publishedAt,
        language: pageLanguage(material.html),
        ...dropBlank(material),
      }),
      sections: [{ html: material.html }],
      images: [],
    };
  },
};

// The caller's fields that carry something, so they override what the page says.
function dropBlank(meta: MaterialMeta): MaterialMeta {
  const out: MaterialMeta = {};
  for (const key of ["author", "publishedAt", "sourceUrl", "language"] as const) {
    const value = meta[key];
    if (value !== undefined && value.trim() !== "") out[key] = value;
  }
  return out;
}

/** Plain text as paragraphs: a blank line between two, a line break kept as one. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => `<p>${escapeHtmlText(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Plain text. Untitled text is named by its first line. */
export const textAdapter: Adapter<Of<"text">> = {
  name: "text",
  // Handed over by the reader, not scraped: anything not empty is content.
  minChars: 1,
  async toManuscript(material) {
    const title = oneLine(material.title ?? "") || derivedTitle(material.text);
    return {
      title,
      ...given(material),
      sections: [{ html: textToHtml(material.text) }],
      images: [],
    };
  },
};

/**
 * Markdown as HTML, CommonMark with GFM (tables, strikethrough, task lists,
 * autolinks). Raw HTML in the source is escaped, not passed through.
 */
export function markdownToHtml(markdown: string): string {
  return micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}

// A leading level-one heading, which in a Markdown document is its title.
const LEADING_H1 = /^\s*#[ \t]+(.+?)[ \t#]*(?:\n|$)/;

/**
 * Markdown. Untitled Markdown that opens with `# A title` is named by it, and
 * that line is not repeated under the header that already says it.
 */
export const markdownAdapter: Adapter<Of<"markdown">> = {
  name: "markdown",
  // Handed over by the reader, not scraped: anything not empty is content.
  minChars: 1,
  async toManuscript(material) {
    let source = material.markdown.replace(/\r\n?/g, "\n");
    let title = oneLine(material.title ?? "");
    if (title === "") {
      const h1 = LEADING_H1.exec(source);
      if (h1) {
        title = oneLine(htmlToText(markdownToHtml(h1[1])));
        source = source.slice(h1[0].length);
      } else {
        title = derivedTitle(htmlToText(markdownToHtml(source)));
      }
    }
    return {
      title,
      ...given(material),
      sections: [{ html: markdownToHtml(source) }],
      images: [],
    };
  },
};

/** The generic adapter for a kind of material, or null for a bare link. */
export function builtInAdapter(material: Material): Adapter<Material> | null {
  const table: { [K in MaterialKind]: Adapter<Of<K>> | null } = {
    url: null,
    web: webAdapter,
    html: htmlAdapter,
    text: textAdapter,
    markdown: markdownAdapter,
  };
  return table[material.kind] as Adapter<Material> | null;
}
