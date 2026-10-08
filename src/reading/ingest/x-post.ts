// An X link pasted into a book's chat (docs/84). The post is a lead: info reads
// it into a record, the content it is in its own right and the links worth
// following (info/x/read-post), and this file turns that into documents.
//
// Fan-out sits here, above the bindery, and not in it: the bindery's contract
// stays one material in, one document out, and it never learns what X is
// (docs/85). The post's own content goes in as HTML material; each followed
// link goes in exactly as a pasted link would, so the registry picks its site
// adapter (arXiv, Drive, GitHub, a PDF) or the generic web path reads it. The
// record is kept whatever came of the rest, with the hashes of what did.

import { bind } from "../../workshop/bindery";
import { readXPost, type XPostRecord, type XReadDeps, type XSkip } from "../../info/x/read-post";
import type { XPostEntry } from "../../info/x/store";
import {
  fileBuilt,
  ingestArticleUrl,
  type ArticleIngestDeps,
  type IngestedDocument,
  type IngestTarget,
} from "./article";

export interface XIngestDeps extends ArticleIngestDeps {
  x: XReadDeps;
  /** Keep the post's record (info/x/store). */
  saveRecord(entry: XPostEntry): Promise<void>;
  now?: () => number;
}

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

function who(record: XPostRecord): string {
  return `@${record.author.handle}`;
}

function shapeWords(record: XPostRecord): string {
  if (record.shape === "article") return `an X Article ("${record.articleTitle ?? ""}")`;
  if (record.shape === "long") return "a long post";
  return "a post";
}

function skipNote(skip: XSkip): string {
  const desktop = skip.needsDesktop
    ? " This needs the desktop app, which reads X pages in a hidden browser; paste the link there."
    : "";
  return `Not taken: ${skip.subject}: ${skip.reason}.${desktop}`;
}

/**
 * Take an X post in. Throws, with a sentence the chat can say, only when the
 * post could not be read at all; otherwise the batch says what came of it,
 * which may be the record alone.
 */
export async function ingestXPost(
  url: string,
  target: IngestTarget,
  deps: XIngestDeps,
): Promise<IngestBatch> {
  const reading = await readXPost(url, deps.x);
  if (!reading.ok) throw new Error(`Could not read the X post ${url}: ${reading.message}.`);
  const { record } = reading;
  const documents: IngestedDocument[] = [];
  const notes = reading.skipped.map(skipNote);
  const binderyDeps = { fetch: deps.fetch, extractReadable: deps.extractReadable };

  for (const own of reading.documents) {
    const bound = await bind(
      {
        kind: "html",
        html: own.html,
        title: own.title,
        author: own.author,
        publishedAt: own.publishedAt,
        sourceUrl: own.sourceUrl,
      },
      binderyDeps,
    );
    if (!bound.ok) notes.push(`Not taken: ${own.sourceUrl}: ${bound.message}.`);
    else if ("passedThrough" in bound) notes.push(`Not taken: ${own.sourceUrl}: not built.`);
    else documents.push(await fileBuilt(deps, target, bound, `x-${own.postId}`));
  }

  for (const link of reading.follow) {
    try {
      documents.push(await ingestArticleUrl(link.url, target, deps));
    } catch (e) {
      notes.push(`Not taken: ${link.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await deps.saveRecord({
    record,
    documents: documents.map((d) => d.entry.hash),
    takenAt: (deps.now ?? Date.now)(),
  });

  const date = record.postedAt.slice(0, 10);
  const linkCount = reading.follow.length;
  let lead =
    `Read ${shapeWords(record)} by ${who(record)}${date ? ` (${date})` : ""} and kept it as the ` +
    `source record of what it led to.`;
  if (linkCount > 0) lead += ` Followed ${linkCount} link${linkCount === 1 ? "" : "s"} out of it.`;
  if (documents.length === 0) {
    lead +=
      reading.documents.length === 0 && linkCount === 0 && reading.skipped.length === 0
        ? " It has no link to follow and is too short to be a document, so only the record was kept."
        : " Nothing became a document.";
  }
  return { documents, lead, notes };
}
