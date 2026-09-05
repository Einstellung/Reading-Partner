// Which stuck points of a book are still open (docs/48, 消费侧). The program
// decides this, not a nightly pass: the answer has to be right on the turn the
// reader is having, and everything it needs is already in the observations the
// turn holds.
//
// A stuck point closes only on later evidence that the reader got it — they
// answered it, retold it, said so — which is written up as an
// understood-concept observation naming the stuck point's id in its body. "The
// AI explained it again" is not evidence and closes nothing, which is the whole
// point of reading the link rather than the calendar.
//
// The cost of the rule runs the other way too: a stuck point the reader has
// quietly got over stays here until something records it, and the companion
// explains it once more. That is the failure the reader can see and forgive;
// the other one — dropping a stuck point that is still open — is the one they
// cannot.

import { mentionedIds } from "./links";
import type { Observation } from "./types";

// The book's open stuck points, in the order they were handed in (the store
// lists newest-updated first, so a caller that passed that list gets them
// newest first without asking).
//
// Scoped to one book by `bookId` alone. An observation that carries no bookId
// is not this book's: the field is absent on everything written before it
// existed and on anything not about one book, and guessing from page numbers in
// a body is what docs/09 measured as wrong.
export function openStuckPoints(
  observations: readonly Observation[],
  bookId: string,
): Observation[] {
  if (!bookId) return [];
  const stuck = observations.filter((o) => o.type === "stuck-point" && o.bookId === bookId);
  if (stuck.length === 0) return [];

  // The last day each observation id was named by an understood-concept, over
  // every observation and not only this book's: an id names one observation
  // wherever it is stored, and the reader can well get a book's stuck point
  // while reading another one.
  const namedOn = new Map<string, string>();
  for (const o of observations) {
    if (o.type !== "understood-concept") continue;
    for (const id of mentionedIds(o.body, o.id)) {
      const seen = namedOn.get(id);
      if (seen === undefined || o.created > seen) namedOn.set(id, o.created);
    }
  }

  // Not older than the stuck point closes it. The same day counts: the
  // understanding is written up the day it happens, and a stuck point that
  // survived its own resolution until midnight would be asked about again in
  // the same session it was cleared in. An understood-concept written before
  // the stuck point is about an earlier round of the same subject and leaves it
  // open.
  return stuck.filter((s) => {
    const day = namedOn.get(s.id);
    return day === undefined || day < s.created;
  });
}
