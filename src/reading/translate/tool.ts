// The translate_document chat tool (docs/67): the reader says "translate this
// one" and the article on the shelf is replaced by a bilingual copy of itself.
// There is no button, and this is the whole entrance.
//
// It returns as soon as the run is written. A dozen model calls is longer than a
// turn should be held open, and the reader asked a question in the same breath
// half the time; the line goes to the screen (watch.ts) and the closing sentence
// to the conversation (tool-live.ts) when it is over.
//
// Nothing is read here but the shelf's own index. Opening the document, cutting
// it into blocks and finding out it was translated already are the worker's, not
// the turn's: they are a megabyte of EPUB and a parse, and the reader is sitting
// in front of a composer that has stopped answering while they happen.
//
// Everything it reaches is injected, so what the model is told in each of the
// five cases is pinned by a test with no library, no topic and no provider.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import type { TranslationHome } from "./replace";

/** A document the tool could act on, as the shelf knows it. */
export interface TranslateTarget {
  bookId: string;
  /** What the reader calls it. */
  title: string;
  /** A web article; everything else cannot be translated in the app. */
  article: boolean;
  /** Where the translation takes its place: a topic's shelf, or a book's
   * supplements (docs/67). */
  home: TranslationHome;
}

export interface TranslateToolDeps {
  /**
   * The document the request names, or the one the reader has open when it
   * names none. Null when nothing on this shelf answers to the name.
   */
  find(query: string | undefined): Promise<TranslateTarget | null>;
  /**
   * Hand the work over. Answers once the run is written, not once it is done;
   * a refusal is the runner's own sentence.
   */
  start(
    target: TranslateTarget,
  ): Promise<{ ok: true; runId: string } | { ok: false; reason: string }>;
  /** Whether a translation is already in flight. */
  busy(): Promise<boolean>;
}

// The line added to the companion prompt wherever the tool is mounted.
export const TRANSLATE_PROMPT =
  "When the reader asks for a document to be translated (\"translate this\", " +
  "\"这篇翻一下\"), call translate_document. It translates a web article on the " +
  "shelf into a bilingual Chinese copy and puts that in its place; it runs in " +
  "the background and reports when it is done, so say nothing about progress.";

export function buildTranslateTools(deps: TranslateToolDeps): AgentTool[] {
  return [
    {
      name: "translate_document",
      description:
        "Translate a web article on the shelf into Chinese. The result is a " +
        "bilingual document — every paragraph followed by its translation — and " +
        "it replaces the original in the topic, marks and all. Works on web " +
        "articles only, not on PDFs or books. Runs in the background: this " +
        "returns as soon as the work has been handed over, before the document " +
        "has even been opened, so a document that turns out to be bilingual " +
        "already is said so afterwards rather than here.",
      parameters: Type.Object({
        document: Type.Optional(
          Type.String({
            description:
              "Which document to translate, by title. Leave it out for the one " +
              "the reader is reading.",
          }),
        ),
      }),
      execute: async (args) => {
        const query = args.document ? String(args.document).trim() : undefined;
        const target = await deps.find(query);
        if (!target) {
          return query
            ? `There is no document called "${query}" here.`
            : "There is no document open to translate.";
        }
        if (!target.article) {
          return (
            `"${target.title}" is not a web article, so it cannot be translated ` +
            `in the app — that works on a page that was ingested from a URL. A PDF ` +
            `paper or a book has to be read in its own language for now.`
          );
        }
        if (await deps.busy()) {
          return "A translation is already running. It has to finish before another starts.";
        }
        const started = await deps.start(target);
        if (!started.ok) {
          return `"${target.title}" could not be handed over: ${started.reason}`;
        }
        return (
          `Started translating "${target.title}" (run ${started.runId}). It runs in the ` +
          `background and the result replaces this document on the shelf; I will say ` +
          `when it is done.`
        );
      },
    },
  ];
}
