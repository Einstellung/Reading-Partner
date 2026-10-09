// The ingest-url kind, as a legion worker (docs/55, docs/68).
//
// On the `local` tier: the fetch, the page cutting and the filing all happen in
// this process, on the device the reader pasted the link on, and nothing about
// it reaches the synced folder. It declares no `requires`: the device that was
// asked is the device that has the library the supplement is going into. Most
// links are one fetch and no model; an X link is taken in by the link agent on
// the daily tier (docs/86).
//
// What it does is what the ingest_url tool used to do inside the reader's turn,
// in the same order and with the same three pieces: the document (the thing the
// reader opens from the Outline), its text cut into the pages they will see, and
// the prep list's copy that read_paper reads. The order matters — the document
// is made first because it is the thing; everything after it is about it.
//
// The prep half rides along only where the book has a live pipeline. That is one
// object per open book (prep/papers/live.ts) and it owns its own file, so a
// second one made here would race the reader's. No pipeline means the supplement
// is the whole of the ingest, which is the answer the tool has always given for
// a book with no prep run behind it.
//
// An ask that names an intake instead of a book is a link pasted with no book
// open (topic-intake.ts): the documents go into the library attached nowhere,
// the intake record hears each host being read and what was filed, and the
// topic the reader picks on the card is attached by whichever comes second.

import {
  registerWorker,
  type WorkerContext,
  type WorkerHandle,
  type WorkerOutcome,
} from "../../legion/execute/worker";
import { writeRunOutput } from "../../legion/execute/outputs";
import { GiveUpError, StoppedError } from "../../legion/stop";
import { MAX_ATTEMPTS } from "../../legion/run/types";
import { appData } from "../../platform/app/appdata";
import { t } from "../../i18n";
import { formatOfBytes, readLibraryBook } from "../../platform/app/library";
import { hostOf } from "../../platform/std/url";
import type { Fulltext } from "../../fulltext/types";
import { ensureDocumentFulltext } from "./fulltext";
import { ingestUrlLive, type IngestRunContext } from "./live";
import type { IngestedDocument, IngestTarget } from "./article";
import { isIngestBatch, type IngestBatch } from "./link-intake";
import { intakeStore, type IntakeDocument, type IntakeStore } from "./intake-store";
import { appBox, type BoxStore } from "../../box";
import { exitIntakeItem } from "./intake-box";
import { prepareCapturedDocument, type PreparedSource } from "../prep/papers/captured-source";
import { peekPrepPipeline } from "../prep/papers/live";
import type { PrepPaper } from "../prep/papers/types";
import {
  INGEST_URL_KIND,
  ingestOutputLine,
  intakeOutputLine,
  isBookIngestAsk,
  parseIngestAsk,
  type IngestOutcome,
  type IntakeIngestAsk,
} from "./url-run";

export { INGEST_URL_KIND };

/** Everything that reaches the host, so the worker itself is testable. */
export interface IngestUrlWorkerDeps {
  /** The ask, read back off its path. */
  readAsk?: (path: string) => Promise<string>;
  /**
   * Fetch the URL and file it where the target says — a book's supplements, or
   * the library attached nowhere for an intake: one document, or for a link the
   * link agent takes in (an X post, docs/86) a batch of them.
   */
  ingest?: (url: string, target: IngestTarget, context: IngestRunContext) => Promise<IngestedDocument | IngestBatch>;
  /** The document's text, cut into the pages the reader will see. Null when there is none. */
  fulltext?: (hash: string) => Promise<Fulltext | null>;
  /** This book's live prep pipeline, or null where the book has none. */
  pipeline?: (bookId: string) => CapturedSink | null;
  /** Where the run's one line is put, answering the path. */
  writeOutput?: (runId: string, text: string) => Promise<string>;
  /** The intake records an ask with no book reports to (intake-store.ts). */
  intakes?: Pick<IntakeStore, "progress" | "filed" | "failed">;
  /** The box an intake's item leaves when the intake failed (intake-box.ts). The app's unless injected. */
  box?: BoxStore | null;
}

/** The part of the prep pipeline this worker uses: one captured document in. */
export interface CapturedSink {
  ingestCaptured(mint: PreparedSource["mint"], fetched: PreparedSource["fetched"]): Promise<PrepPaper>;
}

// The text of a document that is not on screen, cached under the document's own
// id, so opening it later reads this copy back rather than cutting the pages a
// second time under different numbers. Null when the text could not be
// extracted, which costs the prep half and nothing else.
async function libraryFulltext(hash: string): Promise<Fulltext | null> {
  try {
    const bytes = await readLibraryBook(hash);
    const buffer = bytes.slice().buffer as ArrayBuffer;
    return await ensureDocumentFulltext(hash, buffer, formatOfBytes(bytes));
  } catch (e) {
    console.warn("could not read the ingested document text", e);
    return null;
  }
}

/** Build the worker legion runs for one ingest-url run. */
export function ingestUrlWorker(deps: IngestUrlWorkerDeps = {}) {
  const readAsk = deps.readAsk ?? ((path: string) => appData.readText(path));
  const ingest =
    deps.ingest ??
    ((url: string, target: IngestTarget, context: IngestRunContext) => ingestUrlLive(url, target, context));
  const fulltext = deps.fulltext ?? libraryFulltext;
  const pipeline = deps.pipeline ?? ((bookId: string) => peekPrepPipeline(bookId));
  const writeOutput = deps.writeOutput ?? writeRunOutput;
  const intakes = deps.intakes ?? intakeStore;
  const box = deps.box === undefined ? appBox() : deps.box;
  // A failed intake has nothing left to pick a topic for: its item leaves the
  // box, and the run's own bell is what tells the reader why.
  const failedOut = (id: string) =>
    box
      ? exitIntakeItem(box, id, "dismissed").catch((e) => console.warn("a failed intake's box item would not leave", e))
      : Promise.resolve();

  // A link with no book: filed into the library attached nowhere, and recorded
  // on the intake the card reads. The intake hears each host, then either what
  // was filed or, once the run will not be tried again, why nothing was.
  async function intakeRun(ask: IntakeIngestAsk, ctx: WorkerContext, stopped: () => void): Promise<WorkerOutcome> {
    const id = ask.intakeId;
    const reading = (host: string) => {
      void ctx.report(t("reader.ingest.fetching", { host }));
      void intakes.progress(id, host).catch((e) => console.warn("could not record the host being read", e));
    };
    try {
      reading(hostOf(ask.url));
      const taken = await ingest(
        ask.url,
        { kind: "topic", topicId: null },
        { ...(ask.note ? { note: ask.note } : {}), report: reading },
      );
      stopped();
      const batch = isIngestBatch(taken) ? taken : null;
      const documents = batch ? batch.documents : [taken as IngestedDocument];

      const filed: { document: IntakeDocument; outcome: IngestOutcome }[] = [];
      for (const ingested of documents) {
        await ctx.report(t("reader.ingest.extractingText"));
        const kind = ingested.kind === "article" ? ("article" as const) : ("pdf" as const);
        const ft = await fulltext(ingested.entry.hash);
        stopped();
        const pages = ft?.pages.length ?? 0;
        const chars = ft ? ft.pages.reduce((n, page) => n + page.length, 0) : ingested.chars;
        filed.push({
          outcome: { title: ingested.title, kind, pages, chars },
          document: {
            hash: ingested.entry.hash,
            title: ingested.title,
            format: ingested.kind === "article" ? "article" : (ingested.entry.format ?? "pdf"),
            ...(ingested.sections === undefined ? {} : { sections: ingested.sections }),
            pages,
            chars,
            path: ingested.path,
            ...(ingested.entry.sourceUrl ? { sourceUrl: ingested.entry.sourceUrl } : {}),
          },
        });
      }

      const intake = await intakes.filed(id, {
        documents: filed.map((f) => f.document),
        skipped: batch?.skipped ?? [],
        ...(batch?.aiNote ? { aiNote: batch.aiNote } : {}),
        ...(batch ? { emptyReason: batch.lead } : {}),
      });
      if (intake.state === "failed") await failedOut(id);
      const chosen = intake.attachedTo !== null;
      const lines: string[] = batch ? [batch.lead] : [];
      for (const f of filed) lines.push(intakeOutputLine(f.outcome, chosen));
      if (batch) lines.push(...batch.notes);
      const line = lines.join(" ");
      const output = await writeOutput(ctx.run.id, line);
      return { output, progress: line };
    } catch (e) {
      // A try below the limit is tried again in place, and the card keeps
      // showing it as being read; only the last one says it failed.
      const last = e instanceof StoppedError || e instanceof GiveUpError || ctx.run.attempts >= MAX_ATTEMPTS;
      if (last) {
        await intakes
          .failed(id, e instanceof Error ? e.message : String(e))
          .catch((err) => console.warn("could not record the failed intake", err));
        await failedOut(id);
      }
      throw e;
    }
  }

  return (brief: string, ctx: WorkerContext): WorkerHandle => {
    let cancelled = false;
    // Nothing in here takes a signal: the fetch is the host's and the page
    // cutting is a stretch of CPU. So cancelling is read between the stages,
    // which is where the run can stop without leaving half a document behind.
    const stopped = () => {
      if (cancelled) throw new StoppedError();
    };
    const done = (async () => {
      const ask = parseIngestAsk(await readAsk(brief));
      stopped();
      if (!isBookIngestAsk(ask)) return intakeRun(ask, ctx, stopped);
      await ctx.report(t("reader.ingest.fetching", { host: hostOf(ask.url) }));
      const taken = await ingest(ask.url, { kind: "book", bookId: ask.bookId }, {
        ...(ask.note ? { note: ask.note } : {}),
        // Each host the link agent reads, in the program's words (docs/86 「回路」).
        report: (host) => void ctx.report(t("reader.ingest.fetching", { host })),
      });
      stopped();
      const batch = isIngestBatch(taken) ? taken : null;
      const documents = batch ? batch.documents : [taken as IngestedDocument];

      const lines: string[] = batch ? [batch.lead] : [];
      for (const ingested of documents) {
        await ctx.report(t("reader.ingest.extractingText"));
        const kind = ingested.kind === "article" ? ("article" as const) : ("pdf" as const);
        const ft = await fulltext(ingested.entry.hash);
        stopped();

        let slug: string | undefined;
        const prep = pipeline(ask.bookId);
        if (prep && ft && ft.status === "ok") {
          await ctx.report(t("reader.ingest.filingUnderBook"));
          const prepared = prepareCapturedDocument(
            {
              documentId: ingested.entry.hash,
              title: ingested.title,
              kind,
              ...(ingested.entry.sourceUrl ? { sourceUrl: ingested.entry.sourceUrl } : {}),
            },
            ft,
            ask.note ?? "",
          );
          const paper = await prep.ingestCaptured(prepared.mint, prepared.fetched);
          // A source the fetch stage could not make anything of is the prep half
          // failing, not the ingest: the supplement is in the library either way,
          // and the line says what there is.
          if (paper.status !== "failed") slug = paper.slug;
        }
        stopped();

        const outcome: IngestOutcome = {
          title: ingested.title,
          kind,
          pages: ft?.pages.length ?? 0,
          chars: ft ? ft.pages.reduce((n, page) => n + page.length, 0) : ingested.chars,
          ...(slug === undefined ? {} : { slug }),
        };
        lines.push(ingestOutputLine(outcome));
      }
      // The receipt (docs/84): what came in, then what did not and why.
      if (batch) lines.push(...batch.notes);
      const line = lines.join(" ");
      const output = await writeOutput(ctx.run.id, line);
      return { output, progress: line };
    })();

    return {
      cancel: () => {
        cancelled = true;
      },
      done,
    };
  };
}

/**
 * Hand legion the ingest-url kind. Called once at startup; deps are for tests.
 *
 * An agent kind: an X link is taken in by the link agent (docs/86), so there is
 * a model inside, and it may not delegate. Not `delegable`: the ask is a URL
 * and a book or an intake, which is not something the model could write as a brief. The
 * tool writes this run itself and the soul's delegate catalogue never names
 * the kind.
 */
export function registerIngestUrlWorker(deps: IngestUrlWorkerDeps = {}): void {
  registerWorker({
    kind: INGEST_URL_KIND,
    tier: "local",
    requires: [],
    agent: true,
    run: ingestUrlWorker(deps),
  });
}
