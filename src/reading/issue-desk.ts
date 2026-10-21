// The brief on the desk (docs/info/88 「简报的对话」). When the reader talks to
// The companion with an issue open, the door's turn lays the issue on the desk as
// material: the conversation stays the door's (soul/door.ts), and this item
// brings the book's text, the tools to read it and its originals, and how to
// cite it. It carries no history, no memory anchor and no place of its own.
//
// A brief is a dozen short pages, so its text is inlined whole when it fits;
// read_pages is mounted either way, for a reply that wants a page's exact words.

import type { DeskEnv, DeskItem, DeskItemKind } from "../desk";
import { estimateTextTokens } from "../budget";
import type { TopicMaterial } from "../fulltext/format";
import { getFulltext } from "../fulltext/store";
import type { Fulltext } from "../fulltext/types";
import { listSupplements } from "../platform/app/supplements";
import { buildReadingTools } from "./context";
import { READ_SUPPLEMENT_PROMPT, buildReadSupplementTools } from "./ingest/read-supplement-tool";

export const ISSUE_DESK_KIND = "issue";

export interface IssueDeskRef {
  /** The issue's content hash. */
  bookId: string;
  title: string;
  /** The issue's extracted text; null while extraction runs. */
  fulltext: Fulltext | null;
}

export interface IssueDeskIo {
  listSupplements(bookId: string): Promise<readonly { hash: string; title: string }[]>;
  fulltext(hash: string): Promise<Fulltext | null>;
}

const LIVE_IO: IssueDeskIo = { listSupplements, fulltext: getFulltext };

/** Inlined whole up to this many tokens; past it the model reads with read_pages. */
export const ISSUE_INLINE_TOKENS = 12_000;

/** The text page by page, each page headed with the anchor the model copies. */
export function issueText(fulltext: Pick<Fulltext, "pages">): string {
  return fulltext.pages.map((text, i) => `=== Page ${i + 1} === [p.${i + 1}]\n${text.trim()}`).join("\n\n");
}

export function issuePrompt(
  title: string,
  fulltext: Fulltext | null,
  supplements: readonly { title: string }[],
): string {
  const text = fulltext?.status === "ok" ? issueText(fulltext) : "";
  const inline = text !== "" && estimateTextTokens(text) <= ISSUE_INLINE_TOKENS;
  const parts = [
    `The reader has a brief open beside this conversation: "${title}". The app wrote it overnight ` +
      "from the topic searches they follow: a contents page, then one item per page, then Notes and an Annex. " +
      "It is the material on your desk; the conversation is still the one at the door.",
    inline
      ? `Its text, page by page:\n\n${text}`
      : text !== ""
        ? "Read it with read_pages; the contents page lists every item."
        : "Its text is still being read out of the file; say so if the reader asks about a page.",
    'Cite it as [p.N "words copied from that page"]. The reader taps the citation to go to the passage, ' +
      "so the words must be on that page exactly.",
  ];
  if (supplements.length > 0) {
    parts.push(
      `Its supplements are the originals the items were written from:\n${supplements
        .map((s) => `- ${s.title}`)
        .join("\n")}\nCheck an original before saying more than the brief does. ${READ_SUPPLEMENT_PROMPT}`,
    );
  }
  return parts.join("\n\n");
}

async function openIssue(ref: IssueDeskRef, env: DeskEnv, io: IssueDeskIo): Promise<DeskItem | null> {
  const supplements = await io.listSupplements(ref.bookId).catch(() => []);
  if (env.signal?.aborted) return null;
  const supplementTexts: TopicMaterial[] = await Promise.all(
    supplements.map(async (s) => ({
      label: s.title,
      fulltext: await io.fulltext(s.hash).catch(() => null),
      annotations: [],
    })),
  );
  if (env.signal?.aborted) return null;
  // read_pages over the issue and search over its originals; nothing else the
  // reading set offers is about a brief.
  const reading = buildReadingTools({
    currentFulltext: ref.fulltext,
    materials: [],
    supplements: supplementTexts,
  }).filter((tool) => tool.name === "read_pages" || tool.name === "search_topic");
  const readSupplement =
    supplements.length > 0
      ? buildReadSupplementTools({ list: () => io.listSupplements(ref.bookId), fulltext: io.fulltext })
      : [];
  const prompt = issuePrompt(ref.title, ref.fulltext, supplements);
  return {
    kind: ISSUE_DESK_KIND,
    label: ref.title,
    tools: [...reading, ...readSupplement],
    toolPrompts: [],
    rungs: [],
    prompt: () => prompt,
  };
}

export function issueDeskKind(io: IssueDeskIo = LIVE_IO): DeskItemKind<IssueDeskRef> {
  return { kind: ISSUE_DESK_KIND, open: (ref, env) => openIssue(ref, env, io) };
}
