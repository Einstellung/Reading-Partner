// The cited sections' original text, carried in a study's book (docs/info/91
// 「节号的原文」): the cite sheet shows a section's paragraphs, and the cached
// section text lives in the run directory of the computer that ran the study,
// which does not sync. So each version's book ends with a block of excerpts,
// one per section some sentence of the book cites, keyed by its anchor, and
// the reader reads the sheet's paragraphs from there first.
//
//   <div class="rp-excerpt" id="rp-excerpt-M3-2">
//     <p>…the material's title and the section's heading…</p>
//     <p class="rp-excerpt-text">one paragraph of the section</p> …
//   </div>
//
// Each section is cut at SECTION_EXCERPT_CHARS, keeping first the paragraphs
// that hold a citing sentence's quote or figures (what the sheet looks for),
// then the section's opening; a book carries at most BOOK_EXCERPT_CHARS of
// them, sections in the order the book first cites them. Pure but for
// loadStudyExcerpts, which reads through the function it is given.

import { quoteOccurs } from "../topic-search/entry-parts";
import { numbersIn } from "../topic-search/model-io";
import type { MaterialBody } from "../dossier/registry";
import type { TopicSearchResult, TopicSearchResultItem } from "../topic-search/result-types";
import { citeHref, entrySentences, splitAnchor } from "./study-cites";
import { materialBodyPaths, paragraphs, sectionText } from "./study-reader";

/** The class of one section's block of excerpts. */
export const EXCERPT_CLASS = "rp-excerpt";
/** The class of a paragraph of the original inside it. */
export const EXCERPT_TEXT_CLASS = "rp-excerpt-text";
/** Characters of one cited section a book carries at most. */
export const SECTION_EXCERPT_CHARS = 2_000;
/** Characters of cited sections one book carries at most. */
export const BOOK_EXCERPT_CHARS = 60_000;
/** A paragraph cut to fit is cut no shorter than this; below it, it is left out. */
const MIN_CUT_CHARS = 160;

/** "M3.§2" to "rp-excerpt-M3-2", "M3" to "rp-excerpt-M3"; null for anything that is not an anchor. */
export function excerptId(anchor: string): string | null {
  const href = citeHref(anchor);
  return href ? href.replace("#rp-cite-", "rp-excerpt-") : null;
}

export interface CitingSentence {
  text: string;
  quote?: string;
}

export interface CitedSection {
  anchor: string;
  /** The sentences of the book that cite it. */
  sentences: CitingSentence[];
}

/** The sections a book's entries cite, in the order the book first cites them, each with the sentences citing it. */
export function citedSections(items: readonly Pick<TopicSearchResultItem, "parts">[]): CitedSection[] {
  const out = new Map<string, CitingSentence[]>();
  for (const item of items) {
    if (!item.parts) continue;
    for (const { sentence } of entrySentences(item.parts)) {
      for (const anchor of sentence.cites) {
        if (citeHref(anchor) === null) continue;
        const list = out.get(anchor) ?? [];
        list.push(sentence);
        out.set(anchor, list);
      }
    }
  }
  return [...out].map(([anchor, sentences]) => ({ anchor, sentences }));
}

function wanted(para: string, sentences: readonly CitingSentence[]): boolean {
  const figures = numbersIn(para);
  return sentences.some((s) => (s.quote?.trim() && quoteOccurs(s.quote, para)) || numbersIn(s.text).some((n) => figures.includes(n)));
}

function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
}

/**
 * The paragraphs of a section a book carries, in the section's order: the ones
 * the citing sentences point at (by quote or figure) first, then the opening,
 * within `max` characters. `cut` when anything of the section was left out.
 * Null when the section has no text.
 */
export function pickExcerpt(text: string, sentences: readonly CitingSentence[], max = SECTION_EXCERPT_CHARS): { paras: string[]; cut: boolean } | null {
  const paras = paragraphs(text);
  if (paras.length === 0) return null;
  const hits = paras.map((p) => wanted(p, sentences));
  const order = [...paras.keys()].sort((a, b) => Number(hits[b]) - Number(hits[a]) || a - b);
  const chosen = new Map<number, string>();
  let budget = max;
  let cut = false;
  for (const i of order) {
    const p = paras[i];
    if (p.length <= budget) {
      chosen.set(i, p);
      budget -= p.length;
      continue;
    }
    cut = true;
    if ((hits[i] || chosen.size === 0) && budget >= MIN_CUT_CHARS) {
      chosen.set(i, clip(p, budget));
      budget = 0;
    }
    // The opening stops at the first paragraph that does not fit.
    if (!hits[i]) break;
  }
  if (chosen.size < paras.length) cut = true;
  return { paras: [...chosen].sort(([a], [b]) => a - b).map(([, p]) => p), cut };
}

export interface BookExcerpt {
  anchor: string;
  paras: string[];
  /** Part of the section was left out. */
  cut: boolean;
}

export interface StudyExcerpts {
  excerpts: BookExcerpt[];
  /** Cited sections with text that did not fit in the book. */
  left: number;
}

/**
 * The excerpts one book carries: each cited section whose text `textOf` has,
 * picked by `pickExcerpt`, until the book's cap; a section that would pass the
 * cap is left out and counted. A section with no text here is skipped.
 */
export function bookExcerpts(
  cited: readonly CitedSection[],
  textOf: (anchor: string) => string | null,
  caps: { section: number; book: number } = { section: SECTION_EXCERPT_CHARS, book: BOOK_EXCERPT_CHARS },
): StudyExcerpts {
  const excerpts: BookExcerpt[] = [];
  let used = 0;
  let left = 0;
  for (const c of cited) {
    const text = textOf(c.anchor);
    const picked = text ? pickExcerpt(text, c.sentences, caps.section) : null;
    if (!picked) continue;
    const size = picked.paras.reduce((n, p) => n + p.length, 0);
    if (used + size > caps.book) {
      left++;
      continue;
    }
    used += size;
    excerpts.push({ anchor: c.anchor, ...picked });
  }
  return { excerpts, left };
}

/** The materials a book's cited sections are in ("M3"), for loading their bodies. */
export function citedMaterials(cited: readonly CitedSection[]): string[] {
  return [...new Set(cited.flatMap((c) => splitAnchor(c.anchor)?.material ?? []))];
}

/**
 * The paragraphs a book carries for an anchor, read from its parsed spine
 * documents; null when the book has no block for it (a book made before the
 * excerpts, or a section that did not fit).
 */
export function excerptInBook(docs: readonly { doc: Document }[], anchor: string): string[] | null {
  const id = excerptId(anchor);
  if (!id) return null;
  for (const { doc } of docs) {
    const block = doc.getElementById(id);
    if (!block) continue;
    return [...block.getElementsByTagName("p")]
      .filter((p) => p.getAttribute("class") === EXCERPT_TEXT_CLASS)
      .map((p) => (p.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }
  return null;
}

/** The excerpt a book carries for an anchor, as a material body citeSheet reads (study-reader.ts). */
export function excerptBody(anchor: string, paras: readonly string[]): MaterialBody {
  return { id: splitAnchor(anchor)?.material ?? anchor, url: "", sections: [{ id: anchor, heading: null, text: paras.join("\n\n") }] };
}

/**
 * The excerpts for a book's entries, from the materials' cached bodies in the
 * study's run directories (study-reader.ts materialBodyPaths), read through
 * `read`. Only the computer that ran the study has them; anywhere else, and
 * for a torn body, there is nothing to carry and the book has no excerpts.
 */
export async function loadStudyExcerpts(
  read: (path: string) => Promise<string | null>,
  result: Pick<TopicSearchResult, "runDir" | "retries">,
  items: readonly Pick<TopicSearchResultItem, "parts">[],
): Promise<StudyExcerpts> {
  const cited = citedSections(items);
  const bodies = new Map<string, MaterialBody>();
  for (const material of citedMaterials(cited)) {
    for (const path of materialBodyPaths(result, material)) {
      const text = await read(path).catch(() => null);
      if (!text) continue;
      try {
        const body = JSON.parse(text) as MaterialBody;
        if (!Array.isArray(body.sections)) continue;
        bodies.set(material, body);
        break;
      } catch {
        // A torn body: try the next directory.
      }
    }
  }
  return bookExcerpts(cited, (anchor) => {
    const body = bodies.get(splitAnchor(anchor)?.material ?? "");
    return body ? sectionText(body, anchor) : null;
  });
}
