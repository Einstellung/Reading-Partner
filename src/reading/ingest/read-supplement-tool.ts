// The read_supplement chat tool (docs/67 「辅助资料」, feedback 辅助资料读不到):
// read pages of one of this book's supplements, whichever document is on screen
// and whatever prep the book has. Every supplement's text is extracted into the
// fulltext store under its document id when it is taken in, so the text is
// there; before this tool the only way to it was read_paper, which only a
// paper-prep run mounts and only for the rows that run filed.
//
// Which supplement is meant is decided by title, the way remove_supplement
// decides it. Everything the read touches is injected, so what each answer says
// is pinned by a test with no library.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import { formatPages, MAX_PAGES } from "../../fulltext/format";
import type { Fulltext } from "../../fulltext/types";
import { pageRangeLabel } from "../../ai/turn-view/tool-labels";
import { matchSupplement, type SupplementListing } from "./remove-tool";

export interface ReadSupplementToolDeps {
  /** The book's supplements, read at call time: one may have arrived mid-turn. */
  list(): Promise<readonly SupplementListing[]>;
  /** A document's extracted text, by document id; null when there is none. */
  fulltext(hash: string): Promise<Fulltext | null>;
}

// The line added to the companion prompt wherever the tool is mounted.
export const READ_SUPPLEMENT_PROMPT =
  "The book's supplements (listed below when it has any) are yours to read: call " +
  "read_supplement with the title and a page range. Read one yourself rather than " +
  "asking the reader to open it.";

// Page headers carry the citation the model should write, as read_paper's do.
function anchor(title: string, page: number): string {
  return `=== Page ${page} === [${title.replace(/\s+/g, " ").trim()} p.${page}]`;
}

export function buildReadSupplementTools(deps: ReadSupplementToolDeps): AgentTool[] {
  return [
    {
      name: "read_supplement",
      label: (args) => pageRangeLabel(args),
      effect: "read",
      description:
        "Read a page range from one of this book's supplements — the papers and pages " +
        "the reader brought in beside it. Takes the supplement's title as listed; pages " +
        `are 1-based and inclusive, at most ${MAX_PAGES} per call.`,
      parameters: Type.Object({
        title: Type.String({ description: "The supplement's title, as listed." }),
        from: Type.Number({ description: "First page (1-based)." }),
        to: Type.Number({ description: "Last page (1-based, inclusive)." }),
      }),
      execute: async (args) => {
        const query = String(args.title ?? "").trim();
        const supplements = await deps.list();
        if (supplements.length === 0) return "This book has no supplements.";
        const found = matchSupplement(query, supplements);
        if (!found) {
          const titles = supplements.map((s) => `"${s.title}"`).join(", ");
          return `There is no single supplement called "${query}". This book has: ${titles}.`;
        }
        const ft = await deps.fulltext(found.hash).catch(() => null);
        if (!ft || ft.status !== "ok") {
          return `"${found.title}" has no readable text (it may be a scan, or still being extracted).`;
        }
        return formatPages(
          ft,
          Math.round(Number(args.from)),
          Math.round(Number(args.to)),
          (p) => anchor(found.title, p),
        );
      },
    },
  ];
}
