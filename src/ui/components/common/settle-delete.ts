// How a confirmed delete runs from a list: do it, say so if it failed, and
// reread the list either way. The delete functions throw on the steps whose
// partial result the reader would see (a book still on the shelf, a topic still
// there), so a failure is a thing to tell them, not a rejection nobody catches;
// and a failed delete can still have taken some of it away, so the list is
// reread whether it worked or not.

import { errMsg } from "../../../platform/std/errors";

// The line a failed delete puts in front of the reader: what did not happen,
// e.g. "Could not delete the book", then why.
export function deleteFailedLine(failed: string, e: unknown): string {
  return `${failed}: ${errMsg(e)}`;
}

export async function settleDelete(opts: {
  act: () => Promise<unknown>;
  refresh: () => Promise<unknown> | unknown;
  failed: string;
  onFail: (line: string) => void;
}): Promise<boolean> {
  let ok = true;
  try {
    await opts.act();
  } catch (e) {
    ok = false;
    opts.onFail(deleteFailedLine(opts.failed, e));
  }
  await opts.refresh();
  return ok;
}
