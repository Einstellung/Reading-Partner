// A link taken in through the link agent (docs/86), filed the way reading files
// everything: a built EPUB as an article, a whole PDF or EPUB as a book, each
// listed where the target says. info/links builds and decides; this file only
// hands it the filing and turns its intake into the batch the ingest-url run
// already knows how to report.
//
// Not what the app runs for X links yet: until the comparison in docs/86
// 「第一期」 passes, ingestUrlLive keeps the rule-based fan-out (x-post.ts), and
// this is called by takeLinkInLive and by the comparison script only.

import { takeLinkIn, type LinkIntake, type LinkIntakeDeps } from "../../info/links";
import { fileBound, type ArticleIngestDeps, type IngestedDocument, type IngestTarget } from "./article";
import type { IngestBatch } from "./x-post";

export interface LinkIntakeFilingDeps
  extends ArticleIngestDeps,
    Omit<LinkIntakeDeps<IngestTarget, IngestedDocument>, "file" | "fetch" | "extractReadable"> {}

/** The batch the run reports, with the intake behind it for a caller that wants the trail. */
export interface FiledLinkIntake extends IngestBatch {
  intake: LinkIntake<IngestedDocument>;
}

/** Take a link in with reading's filing injected. */
export async function takeLinkInFiled(
  url: string,
  target: IngestTarget,
  deps: LinkIntakeFilingDeps,
): Promise<FiledLinkIntake> {
  const intake = await takeLinkIn<IngestTarget, IngestedDocument>(url, target, {
    ...deps,
    file: async (built, slugBase, to) => {
      const document = await fileBound(deps, to, url, slugBase, built);
      return { hash: document.entry.hash, title: document.title, document };
    },
  });
  return { documents: intake.documents, lead: intake.lead, notes: intake.notes, intake };
}
