// A citation chip in a reading reply, on the shell's side: what a click on one
// does, what the event log records of it, which names a reply may cite, and
// whether a quote it carries is really on its page. The shell executes the
// route; nothing here touches the view.

import { findFigureById } from "../figures/lookup";
import type { Figure } from "../figures/types";
import type { AnchorSources, Citation } from "../prep/anchors";
import { locateQuote } from "../prep/quote-locate";
import type { SupplementRef } from "../../platform/app/supplements";
import { supplementForSlug, supplementTitles } from "./supplement-citation";

export type CitationRoute =
  // Jump the reader to this page of the document on screen, highlighting the
  // quote when there is one.
  | { kind: "page"; pageIndex: number; quote?: string }
  // A supplement named by its title (docs/67): open it if it is not the document
  // on screen, then the page.
  | { kind: "supplement"; supplement: SupplementRef; pageIndex: number; quote?: string }
  // Open this paper's note in the prep panel (the note, not the paper PDF).
  | { kind: "prep"; slug: string }
  // The jump has nowhere to go; tell the reader rather than do nothing.
  | { kind: "warn"; message: string };

export interface CitationTargets {
  figures: readonly Pick<Figure, "id" | "page">[];
  supplements: readonly SupplementRef[];
  // The prepped papers, or undefined while prep state has not loaded.
  papers: readonly { slug: string }[] | undefined;
}

export function routeCitation(c: Citation, targets: CitationTargets): CitationRoute {
  if (c.kind === "page") return { kind: "page", pageIndex: c.page - 1, quote: c.quote };
  if (c.kind === "figure") {
    // Reachable when this document's figure list is empty, which is both "no
    // figures in it" and "extraction hasn't finished" — nothing here can tell
    // those apart. (With a figure list, an unknown id never gets here: it
    // renders as an inert chip instead of a control.)
    const fig = findFigureById(targets.figures, c.id);
    if (!fig) return { kind: "warn", message: `No figure ${c.id} in this document.` };
    return { kind: "page", pageIndex: fig.page - 1 };
  }
  const supplement = supplementForSlug(c.slug, targets.supplements);
  if (supplement) return { kind: "supplement", supplement, pageIndex: c.page - 1, quote: c.quote };
  // The model can cite a paper that isn't prepped — an abbreviated slug, or one
  // it remembers from another book. Selecting it opened the prep panel on
  // nothing, which reads as the panel being broken.
  //
  // Only once there is a list to check against: prep state loads a moment after
  // the book does, and a citation clicked in that window is very likely real.
  const { papers } = targets;
  if (papers && !papers.some((p) => p.slug === c.slug)) {
    return { kind: "warn", message: `No prepped paper "${c.slug}" — the reply cited one that isn't here.` };
  }
  return { kind: "prep", slug: c.slug };
}

/** What a "citation-click" event records. */
export function citationLogDetail(c: Citation): Record<string, string | number> {
  return c.kind === "page"
    ? { kind: "page", page: c.page }
    : c.kind === "figure"
      ? { kind: "figure", id: c.id }
      : { kind: "paper", slug: c.slug };
}

/**
 * The names a [name p.N] citation may carry, from the prepped slugs and the
 * supplements' titles, each as a newline-joined key so a caller can memoize on
 * strings. A null slug key — not an empty one — means prep state has not
 * loaded: "this paper isn't prepped" and "the list isn't here yet" are different
 * answers, and only the first should strike a citation back to plain text. The
 * titles are always known, so an empty key really is "none".
 */
export function citationSources(slugKey: string | null, titleKey: string): AnchorSources {
  return {
    slugs: slugKey === null ? null : new Set(slugKey.split("\n").filter(Boolean)),
    titles: supplementTitles(titleKey ? titleKey.split("\n").map((title) => ({ title, hash: "", addedAt: 0 })) : []),
  };
}

/**
 * Whether a citation's quote is really on the page it names (1-based), against
 * this book's text. Same answer the click's highlight asks locateQuote for, so
 * the two cannot disagree about what counts as found.
 *
 * Cached per (page, quote) inside the returned function, so a new check per book
 * text empties it by construction. The cache is not an optimization to skip:
 * every delta of a streaming reply re-renders the whole tree, and locateQuote
 * folds an entire page of text per call.
 */
export function createQuoteCheck(
  fulltext: { pages: readonly string[] } | null,
): (page: number, quote: string) => boolean {
  const cache = new Map<string, boolean>();
  return (page, quote) => {
    const key = `${page}\u0000${quote}`;
    const seen = cache.get(key);
    if (seen !== undefined) return seen;
    // No text for that page — extraction still running, an unreadable scan, a
    // page number past the end. None of those is evidence against the quote, so
    // it passes, the same way an unknown prep list lets a citation link on its
    // shape alone.
    const pageText = fulltext?.pages[page - 1];
    const ok = pageText ? locateQuote(pageText, quote) !== null : true;
    cache.set(key, ok);
    return ok;
  };
}
