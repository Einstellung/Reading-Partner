// The brief open in the reader, as a voice call at the door reads it
// (docs/info/88 「简报的对话」): the provider the corner hands the door call
// (soul/voice/live/door-material.ts). It reads whichever brief is open at the
// moment it is asked, so a brief opened or put away during the call is what the
// next turn or run sees: the front's place from issueCallPlace, a think run's
// desk from issueDoorTurn, the same material the door's text turn lays.

import { issueHeadings } from "../../../info/issue/opening";
import { issueCallPlace, issueContents, issueHighlights } from "../../../reading/issue";
import type { DoorCallMaterial } from "../../../soul/voice/live/door-material";
import { getOpenIssue, issueDoorTurn, type OpenIssue } from "./issue-context";

export interface IssueCallDeps {
  open(): OpenIssue | null;
  /** The headings of the issue's items (info/issue/opening.ts). */
  headings(bookId: string): Promise<readonly string[]>;
}

const LIVE: IssueCallDeps = { open: getOpenIssue, headings: issueHeadings };

export function issueCallMaterial(deps: IssueCallDeps = LIVE): DoorCallMaterial {
  // An issue's headings are written when it is assembled and never change.
  const headings = new Map<string, Promise<readonly string[]>>();
  const headingsOf = (bookId: string): Promise<readonly string[]> => {
    let known = headings.get(bookId);
    if (!known) {
      known = deps.headings(bookId);
      headings.set(bookId, known);
    }
    return known;
  };
  return {
    opened: () => deps.open() !== null,
    async place() {
      const issue = deps.open();
      if (!issue) return "";
      const [fulltext, items] = await Promise.all([issue.fulltext().catch(() => null), headingsOf(issue.bookId)]);
      const { page, pageCount } = issue.where();
      return issueCallPlace({
        title: issue.title,
        page,
        pageCount,
        highlights: issueHighlights(issue.marks()),
        contents: issueContents(fulltext, items),
      });
    },
    async desk() {
      const issue = deps.open();
      return issue ? issueDoorTurn(issue, "") : null;
    },
  };
}
