// The articles the reader kept on the info side (docs/21), as a thing that lies
// beside the book on the reading desk (reading/desk.ts registers it).

import type { DeskEnv, DeskItem, DeskItemKind } from "../../desk";
import { saveFulltext } from "../../fulltext/store";
import { paperFulltextHash } from "../prep/papers/store";
import type { PrepPipeline } from "../prep/papers/pipeline";
import {
  buildSavedArticleTools,
  prepareSavedArticle,
  SAVED_ARTICLES_PROMPT,
  type SavedArticleStore,
} from "./saved-article-tools";
import {
  hasSavedArticles,
  loadSavedArticles,
  loadSavedArticleBody,
  NO_ARTICLE_BODY,
  type SavedArticle,
} from "./saved-articles";

export const SAVED_ARTICLES_KIND = "saved-articles";

// The real kept-article store. A failed read answers "nothing kept" rather than
// failing the turn: the tools are an offer, and a turn the reader is waiting for
// is not the place to raise a store problem the library screen will raise.
export const savedArticleStoreOnDisk: SavedArticleStore = {
  any: () => hasSavedArticles().catch(() => false),
  all: () => loadSavedArticles().catch((): SavedArticle[] => []),
  body: (article) => loadSavedArticleBody(article).catch(() => NO_ARTICLE_BODY),
};

// The kept articles lie beside the book rather than branching inside it: they
// bring two tools and a paragraph, and nothing else about the turn changes when
// they are there.
export interface SavedArticlesDeskRef {
  // The book the kept article would be put on the prep list of.
  bookId: string;
  getPipeline: () => PrepPipeline | null;
  // Injected so the assembly runs with no AppData. It is asked `any` here — the
  // records themselves are read when a tool actually runs.
  savedArticles?: SavedArticleStore;
}

export const savedArticlesKind: DeskItemKind<SavedArticlesDeskRef> = {
  kind: SAVED_ARTICLES_KIND,
  open: openSavedArticles,
};

// Saved info articles (docs/21): the model can list what the reader kept and
// put one into this book's prep list, then read it with read_paper. Gated on
// there being something kept — a tool whose only possible answer is "nothing"
// is one the model learns to call for nothing — and on the prep state
// existing, since read_paper is what the answer sends it to.
async function openSavedArticles(
  ref: SavedArticlesDeskRef,
  _env: DeskEnv,
): Promise<DeskItem | null> {
  const { bookId, getPipeline, savedArticles = savedArticleStoreOnDisk } = ref;
  const livePipeline = getPipeline();
  const prepState = livePipeline?.snapshot().state ?? null;
  if (!livePipeline || !prepState) return null;
  if (!(await savedArticles.any().catch(() => false))) return null;
  // The records are read on the first tool call, not here: most turns mount
  // these tools without the model ever reaching for them. Read once per
  // turn, however often it does. The bodies are not in there — only the one
  // article the reader names is read, in add below.
  let records: Promise<SavedArticle[]> | null = null;
  const list = () => (records ??= savedArticles.all().catch((): SavedArticle[] => []));
  return {
    kind: SAVED_ARTICLES_KIND,
    label: "Kept articles",
    tools: buildSavedArticleTools({
      list,
      add: async (article) => {
        const body = await savedArticles.body(article);
        const prepared = prepareSavedArticle(article, body.text);
        const paper = await livePipeline.ingestCaptured(prepared.mint, prepared.fetched);
        // The kept text goes into the fulltext cache under the slug the paper
        // got, which is why it is written after the ingest and not before:
        // the slug is minted in there. Nothing reads that cache in between —
        // the digest was handed the text directly, and read_paper is not
        // reachable until this call answers.
        await saveFulltext(paperFulltextHash(bookId, paper.slug), prepared.fulltext);
        return {
          slug: paper.slug,
          title: paper.title,
          kind: "article",
          pages: prepared.fulltext.pages.length,
          chars: prepared.chars,
          status: paper.status,
          error: paper.error,
        };
      },
    }),
    toolPrompts: [SAVED_ARTICLES_PROMPT],
    rungs: [],
    // Nothing of its own in the prompt: what a kept article contributes is two
    // tools and the paragraph that says when to reach for them, and that
    // paragraph belongs among the book's own (reading/desk.ts, composePrompt).
    prompt: () => "",
  };
}
