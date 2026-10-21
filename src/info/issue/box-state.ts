// The box item of a brief's issue (types.ts ISSUE_BOX_KIND) as the reader's
// own doing moves it: opening the issue is being told of it.

import type { BoxStore } from "../../box";
import { issueBookOfItem } from "./types";

/**
 * The reader has the issue open, so the box has nothing more to say about it:
 * its item moves to told, which takes the card out of the corner and out of the
 * door's conversation, where the companion's opening already says it. Whichever way the
 * issue was opened: from the card, the shelf or a link.
 */
export async function markIssueTold(box: Pick<BoxStore, "list" | "setState">, bookId: string): Promise<void> {
  const unseen = await box.list({ state: "in-box" });
  for (const item of unseen) {
    if (issueBookOfItem(item) === bookId) await box.setState(item.id, "told");
  }
}
