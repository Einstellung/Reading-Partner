// A link taken in through the link agent (docs/86), filed the way reading files
// everything: a built EPUB as an article, a whole PDF or EPUB as a book, each
// listed where the target says. info/links builds and decides; this file only
// hands it the filing and turns its intake into the batch the ingest-url run
// reports. X links come this way (ingestUrlLive); other links keep the one-page
// path until each source is measured (docs/86 「以后」).

import { takeLinkIn, type LinkIntake, type LinkIntakeDeps } from "../../info/links";
import { fileBound, type ArticleIngestDeps, type IngestedDocument, type IngestTarget } from "./article";

/** What one pasted link became: any number of documents, and what was left out. */
export interface IngestBatch {
  documents: IngestedDocument[];
  /** One sentence about the source, said before the documents. */
  lead: string;
  /** One sentence each about what was not taken and why. */
  notes: string[];
}

export function isIngestBatch(value: IngestedDocument | IngestBatch): value is IngestBatch {
  return "documents" in value;
}

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
