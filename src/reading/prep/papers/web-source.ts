// A web page pasted into the prep panel, read into the text its note is digested
// from (docs/09 link ingestion, docs/85 step 4). The page is read the way
// ingest_url reads one: the bindery's web adapter (Readability, defuddle when it
// comes up short) cuts the article out, and its gate turns back an empty page or
// a sign-in wall. Nothing is built or filed — prep wants the text and keeps it
// under its own key — so this stops at the manuscript (workshop/bindery
// readMaterial). PDFs and arXiv are prep's own and do not pass through here.

import type { ExtractReadable } from "../../../workshop/extract/readable-select";
import { manuscriptText, readMaterial } from "../../../workshop/bindery";

// Cap on the text so a huge page cannot blow up the digest prompt or the
// fulltext cache. Longer content is cut with a visible marker.
export const WEB_SOURCE_MAX_CHARS = 200_000;
export const TRUNCATION_MARKER = "\n\n[content truncated]";

export interface WebSource {
  /** The article's own title, or undefined when the page named none. */
  title?: string;
  /** The article body as plain text, capped. */
  text: string;
  truncated: boolean;
}

/**
 * Read a fetched page. Throws, with the bindery's reason, when there is no
 * article in it: a paper that cannot be read is the fetch stage failing, which
 * the panel already shows.
 */
export async function readWebSource(
  page: { url: string; html: string },
  deps: { extractReadable: ExtractReadable },
): Promise<WebSource> {
  const read = await readMaterial(
    { kind: "web", url: page.url, html: page.html },
    { extractReadable: deps.extractReadable },
  );
  if (!read.ok) throw new Error(`no readable article at the link: ${read.message}`);
  // A site adapter found a whole document behind the page (a PDF): there is no
  // page text to digest, and prep fetches documents by its own route.
  if ("passedThrough" in read) throw new Error("the link is a whole document, not a web page");
  const full = manuscriptText(read.manuscript);
  const truncated = full.length > WEB_SOURCE_MAX_CHARS;
  const text = truncated ? full.slice(0, WEB_SOURCE_MAX_CHARS) + TRUNCATION_MARKER : full;
  const title = read.manuscript.title.trim();
  return { ...(title === "" ? {} : { title }), text, truncated };
}
