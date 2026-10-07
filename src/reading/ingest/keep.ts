// Keeping an article from the briefing (docs/21, docs/85 step 4): the body the
// briefing already holds is bound into an EPUB by the bindery, put in the
// library as an article and listed in the record's topic, and the record names
// it. From then on it is a document like any ingested page — it opens in the
// reader, takes marks, has full text, can be prepped and cited. The page is not
// fetched again: the briefing's body is the article as it was read, and the
// site may be behind a paywall the collector got past. Only its pictures are
// fetched, as for any page that becomes a document (docs/67 「图」).
//
// The record stays. It holds what the document cannot — the source the briefing
// named, whether only a summary was had, when it was kept — and it is what the
// phone's Saved list, the article conversation's Apply and the topic cascade
// act on (saved/kept-document.ts keeps the two together).
//
// A body the bindery turns back (empty, a sign-in wall) is kept as a record
// alone, which is all a keep ever was before. So is a body whose build or
// filing fails: the reader pressed Keep, and the record is the part that
// cannot be had again once the briefing is gone.
//
// A summary-only body is not built at all, and the record is the whole keep.
// A document of a truncated feed body or a paywall preview would sit in the
// reader, the full text and search_topic looking like the article, and nothing
// on the way to the model says it is not (docs/21 「证据不全」); the record
// carries `summaryOnly` everywhere it is read. Keeping the same article again
// once the full body is in hand builds the document then.
//
// The briefing does not say what language an article is in, so the bindery
// tells it from the text (workshop/bindery/language.ts).
//
// Existing records are not rebuilt here (docs/85): a record kept before this
// carries no document until it is kept again.

import type { LibraryEntry } from "../../platform/app/library";
import { bind, type FetchBytes, type Material, type Rejection } from "../../workshop/bindery";
import {
  savedArticleDocumentOf,
  savedArticleId,
  type SavedArticle,
  type SavedArticleInput,
} from "../saved/saved-articles";
import { slugBaseFromUrl } from "../sources";
import { fileBuilt, type FilingDeps, type IngestedDocument } from "./article";

export interface KeepDeps extends Omit<FilingDeps, "attachToBook"> {
  /** Fetch a picture the body references. Without it every picture is a placeholder. */
  fetch?: FetchBytes;
  /** Write the record (saved-articles.ts saveArticle). */
  save(input: SavedArticleInput): Promise<SavedArticle | null>;
  /** The record already kept under this id, if any. */
  existing(id: string): Promise<SavedArticle | null>;
  /** The library's entry for a document, or null when it is not in the library. */
  libraryEntry(hash: string): Promise<LibraryEntry | null>;
}

export interface KeepOutcome {
  /** The record written, or null when nothing was (no identity, or a file that would not write). */
  record: SavedArticle | null;
  /** The document built by this keep; null when it built none (reused, turned back, or failed). */
  document: IngestedDocument | null;
  /** Why the bindery turned the body back, when it did. */
  rejection: Rejection | null;
}

/**
 * Pure: what the bindery is handed for a kept body. The HTML when there is any
 * — it is already the article cut out of its page and sanitized — else the
 * plain text. The briefing's own title, link and date name the document; the
 * body has no head of its own to say them. Null for a body with neither.
 */
export function keptMaterial(input: SavedArticleInput): Material | null {
  const meta = {
    title: input.title,
    sourceUrl: input.url,
    publishedAt: input.publishedAt,
  };
  if (input.html.trim() !== "") return { kind: "html", html: input.html, ...meta };
  if (input.text.trim() !== "") return { kind: "text", text: input.text, ...meta };
  return null;
}

/**
 * Keep one article: build its document when it can be built, then write the
 * record pointing at it.
 *
 * A summary-only body builds nothing (see the head of this file).
 *
 * Keeping the same article again reuses the document the first keep linked,
 * when the library still has it, rather than building a second copy of one
 * article (pictures fetched a second time can come out differently, and the
 * bytes with them). A record that has none yet — its first keep had only a
 * summary — gets one now if this keep has the full body. A second keep also
 * leaves the record in the topic it was filed under since.
 */
export async function keepArticle(input: SavedArticleInput, deps: KeepDeps): Promise<KeepOutcome> {
  const id = savedArticleId(input.url, input.title);
  if (id === "") return { record: null, document: null, rejection: null };
  const earlier = await deps.existing(id);
  const topicId = earlier?.topicId ?? input.topicId;
  const earlierDoc = earlier ? savedArticleDocumentOf(earlier) : "";

  let documentHash = "";
  let document: IngestedDocument | null = null;
  let rejection: Rejection | null = null;
  if (earlierDoc !== "" && (await deps.libraryEntry(earlierDoc)) !== null) {
    documentHash = earlierDoc;
  } else if (!input.summaryOnly) {
    const material = keptMaterial(input);
    if (material) {
      try {
        const bound = await bind(material, deps.fetch ? { fetch: deps.fetch } : {});
        if (!bound.ok) {
          rejection = bound;
        } else if (!("passedThrough" in bound)) {
          // A body in hand is always built; only a site adapter passes a whole
          // document through, and none reads a kept body.
          document = await fileBuilt(
            {
              importBook: deps.importBook,
              attachToTopic: deps.attachToTopic,
              attachToBook: () => Promise.reject(new Error("a kept article is filed under a topic")),
            },
            { kind: "topic", topicId },
            bound,
            slugBaseFromUrl(input.url),
          );
          documentHash = document.entry.hash;
        }
      } catch (e) {
        console.warn("could not build the kept article into a document", e);
      }
    }
  }

  const record = await deps.save({
    ...input,
    topicId,
    ...(documentHash === "" ? {} : { documentHash }),
  });
  return { record, document, rejection };
}
