// The tools every thread of an open book carries, whatever the book has been
// through (reading/desk.ts): taking in a link, taking a supplement away,
// translating the document on screen, and looking up one paper. A tool that is
// only sometimes there is one the model stops reaching for.

import type { AgentTool } from "../legion/execute/turn";
import type { ProviderId } from "../ai";
import type { BoxOrigin } from "../box";
import type { Settings } from "../platform/app/settings";
import { listSupplements, removeSupplement } from "../platform/app/supplements";
import { readingFetch } from "../platform/http/throttled-fetch";
import { INGEST_URL_PROMPT, buildSourceTools } from "./prep/papers/source-tool";
import type { PrepPipeline } from "./prep/papers/pipeline";
import { startUrlIngest } from "./ingest/url-run";
import { REMOVE_SUPPLEMENT_PROMPT, buildSupplementTools } from "./ingest/remove-tool";
import { TRANSLATE_PROMPT, buildTranslateTools } from "./translate/tool";
import { bookDeleter, liveTranslateToolDeps } from "./translate/tool-live";
import { buildFindPaperTool, FIND_PAPER_PROMPT } from "./papers/citation-tool";
import { RESEARCH_PROMPT } from "./papers/research-agent";

export interface BookSideToolDeps {
  bookId: string;
  // The document on screen: the book, or one of its supplements.
  docId: string;
  topicId: string | null;
  threadId: string;
  settings: Settings;
  // The pipeline the reader was on when the turn opened; a removed supplement's
  // row on it is skipped.
  pipeline: PrepPipeline | null;
  // Where a run delegated from this turn is delivered back to (docs/68).
  origin: () => BoxOrigin;
  onSupplement?: () => void;
  onSupplementGone?: (hash: string) => void;
}

// Two groups because the prep run's read_paper / read_note sit between them in
// the tool list, and the order the tools go out in is the order the provider's
// cache remembers.
export interface BookSideTools {
  shelf: AgentTool[];
  literature: AgentTool[];
}

// The paragraphs of those tools, in the order they have always come out in:
// the shelf's before whatever the rest of the desk brought, the literature's
// after.
export const SHELF_TOOL_PROMPTS = [INGEST_URL_PROMPT, REMOVE_SUPPLEMENT_PROMPT, TRANSLATE_PROMPT];
export const LITERATURE_TOOL_PROMPTS = [FIND_PAPER_PROMPT, RESEARCH_PROMPT];

export function bookSideTools(deps: BookSideToolDeps): BookSideTools {
  const { bookId, docId, topicId, threadId, settings: s, pipeline } = deps;
  const { origin, onSupplement, onSupplementGone } = deps;
  // Link ingestion (docs/09, docs/67 「辅助资料」): the model can ingest a
  // user-pasted URL with ingest_url on any thread of this book — "compare this
  // link with ch.3" is a question a marked passage can raise as easily as the
  // book-level thread can. Mounted with a prep pipeline or without one.
  //
  // The taking-in itself is a run (reading/ingest/url-worker.ts): the tool writes
  // it and this turn ends, and what came in is said back into this thread when
  // the run lands. What a pasted link always produces is a supplement of this
  // book, which the reader can open in the same reader; the prep half — full
  // text the model reads with read_paper — rides along wherever there is a
  // pipeline to carry it, and the run reaches for the same one this turn holds.
  const ingest = buildSourceTools({
    start: async (url, note) => {
      const started = await startUrlIngest(
        { url, bookId, ...(note ? { note } : {}) },
        { origin: origin() },
      );
      // The Outline is asked again when the run lands, not now: the supplement
      // does not exist yet, and by the time it does this turn is long over and
      // nothing else would think to look. Not awaited — that is the whole
      // point of the run.
      void started.done
        ?.then(() => onSupplement?.())
        .catch(() => {});
      return { runId: started.runId };
    },
  });

  // Taking one away again (docs/67 「辅助资料」). The reader corrects what was
  // taken in by saying so, which is where every correction of this kind goes;
  // the Outline has no delete button.
  const supplement = buildSupplementTools({
    // Read now rather than off the turn's copy: a link ingested earlier in
    // this same turn is a supplement the reader can already be asking about.
    list: () => listSupplements(bookId),
    remove: async (one) => {
      const removeBook = bookDeleter();
      if (!removeBook) throw new Error("the app is not ready to delete a document yet");
      // The reader first: the bytes on screen are about to stop existing.
      onSupplementGone?.(one.hash);
      await removeSupplement(bookId, one.hash);
      // The prep list keeps its row — the note is a record of a reading that
      // happened — but the source is off: skipped is the status a paper the
      // run must not touch again already has.
      const paper = pipeline?.snapshot().state?.papers.find((p) => p.documentId === one.hash);
      if (paper) pipeline?.skip(paper.slug);
      await removeBook(one.hash);
      onSupplement?.();
    },
  });

  // Translation (docs/67): the reader says "translate this" and the article on
  // the shelf is replaced by a bilingual copy. Mounted on every book thread, not
  // only on an article's: the tool itself is what says a PDF cannot be done in
  // the app. It translates with the model this conversation is on.
  const translate = buildTranslateTools(
    liveTranslateToolDeps({
      bookId,
      docId,
      topicId,
      threadId,
      model: {
        providerId: s.defaultProviderId as ProviderId,
        modelId: s.defaultModelId as string,
        sessionId: threadId,
      },
    }),
  );

  // Academic literature (docs/24, docs/25). Not gated on the prep pipeline or on
  // the turn being in the book's own thread: "what is the latest research on
  // this" is a question the reader can have on any page of any book.
  //
  // find_paper stays on the reader's turn. Pointing at one endnote is a different
  // job from a topic search: the answer is a single record, the companion wants
  // that record rather than prose about it, and delegating it would spend model
  // turns to come back with less. The topic search itself is no longer a tool of
  // this turn at all — it is a run now (docs/68), handed over with the soul's
  // delegate and answered back into this thread when it is finished.
  const findPaper = buildFindPaperTool({
    fetchFn: readingFetch,
    s2ApiKey: s.semanticScholarApiKey ?? undefined,
  });

  return { shelf: [...ingest, ...supplement, ...translate], literature: [findPaper] };
}
