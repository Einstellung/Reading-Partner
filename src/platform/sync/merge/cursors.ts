// The cursors strategy: observations/meta.json, the bookkeeping that says how
// much of each topic has already been folded into observations
// (memory/observations/store.ts). Fields, plus one rule: when both devices
// moved the same cursor, the lower one wins.
//
// Every cursor in this file is a watermark, and all of them are asymmetric the
// same way — too high loses material for good, too low costs a repeat.
//
//   distilledMessageKeys[threadId]  the key of every message of that thread a
//     pass has read (distill.ts MessageCursor). A key list and not a count
//     because conversation files merge one message at a time (messages.ts): a
//     message from the other device sorts by its stamp into a stretch already
//     read, and a count would cover it for good. Both devices moved it: the
//     shorter list wins, then content. Either side's list is only messages that
//     side really read, and the shorter one goes with the lower count below, so
//     the two maps settle on the same side and stay a pair.
//   distilledMessages[threadId]  the count older versions read and write: how
//     many of that thread's messages a pass has read, in thread order. Still
//     written beside the keys, equal to their length. A count that does not
//     match the length of its keys was moved by an older version, and is read
//     as the first that many messages on top of the keys. Nothing ever walks
//     back behind it, so too high skips the messages under it forever; too low
//     re-reads a stretch, and the distiller is told to update the observation
//     it already wrote rather than write a second one.
//   distilledMarks[bookId]       the newest mark folded in for that book
//     (markCursor, countNewMarks). Same asymmetry: marks at or before it are
//     never offered to a pass again.
//   lastAnnotationDistillAt[topicId]  the topic-wide stamp older versions
//     wrote, still read as the seed for a book that has no per-book cursor yet.
//     A cursor too, by the same reading.
//   lastDistilledAt[topicId]     not a cursor but a rate limit: isTopicDue
//     (arrears.ts) makes that topic wait MIN_DISTILL_GAP_MS after it. Too high
//     holds the next pass back by up to half an hour; too low only lets the half-hourly sweep look at the topic sooner, and the
//     cursors above then end the pass at "no new messages" before it costs a
//     model call. Lower is the cheap direction here as well, so the file needs
//     one rule and not two.
//
// The last two are keyed by topic id because there is one file for every topic;
// the ones above them are keyed by thread and by book, which are already global.
//
// Measured, not hypothetical: meta.json was falling through to opaque, which
// parks the losing side's whole file at meta.conflict-<digest>.json where no
// reader in src/ looks for it. One of the owner's per-topic directories held
// three such copies — 2026-08-13, and two on 2026-08-19 — carrying 1, 14 and 9
// distilledMessages cursors that the live file never got.

import { chooseByContent, type Json } from "./text";

// Two values both devices moved away from the base. Numbers resolve to the
// lower one, key lists to the shorter one; a tie or anything else falls back to
// the module's usual content order. Symmetric and idempotent, like everything
// else that has to run on both devices and land on the same bytes.
export function lowerCursorWins(local: Json, remote: Json): { winner: Json; loser: Json } {
  if (typeof local === "number" && typeof remote === "number") {
    return local <= remote ? { winner: local, loser: remote } : { winner: remote, loser: local };
  }
  if (Array.isArray(local) && Array.isArray(remote) && local.length !== remote.length) {
    return local.length < remote.length
      ? { winner: local, loser: remote }
      : { winner: remote, loser: local };
  }
  return chooseByContent(local, remote);
}
