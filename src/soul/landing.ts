// Where a reply nobody was waiting for lands (docs/68).
//
// Two callers write one: a bell answered in the place the run was delegated
// from (bell.ts), and a turn a dead process left half-said, finished by the one
// after it (recover.ts). The order is the same for both and is the whole of
// what this file is: the line goes into the conversation, the thread store is
// flushed, and only then does a card go in the box — an item can never point at
// a conversation that is not on disk yet. And no card at all where the reader
// is looking at that conversation as the reply lands, which is the rule a plain
// reading turn follows too (reading/turn-box.ts).

import { appBox, type BoxStore, type PutBoxItemInput } from "../box";
import { appendMessage, flushThreads } from "../platform/app/threads";

export interface ReplyLanding {
  /** The thread store's key for that conversation, and the thread in it. */
  key: string;
  threadId: string;
  /** What the soul said. An empty reply is a decision to say nothing. */
  reply: string;
  at: number;
  /**
   * What this line is an answer to, when the reader never said anything it
   * could be read as answering (docs/72).
   */
  answers?: { runId: string };
  /** The conversation is free again: called once the reply is on disk. */
  release?: () => void;
  /** Whether the reader is looking at that conversation as the reply lands. */
  watching?: () => boolean;
  /** The card, where the caller has one to put. Asked after the reply landed. */
  card?: () => PutBoxItemInput;
  box?: BoxStore;
  flush?: () => Promise<void>;
}

/**
 * Land it. Never throws: the answer is already written, and a card that would
 * not write is no reason to fail anything.
 */
export async function landReply(landing: ReplyLanding): Promise<void> {
  const flush = landing.flush ?? flushThreads;
  if (landing.reply.trim() !== "") {
    appendMessage(landing.key, landing.threadId, {
      role: "ai",
      text: landing.reply,
      ts: landing.at,
      ...(landing.answers ? { origin: landing.answers } : {}),
    });
    // On disk before anything points at it. The store coalesces its writes, so
    // without this a card could outlive the reply it opens.
    await flush();
  }
  landing.release?.();
  if (!landing.card || landing.watching?.()) return;
  // Asked now and not when the turn was assembled: the work took a while and
  // the reader may have walked over to that conversation in the meantime.
  await (landing.box ?? appBox())
    .put(landing.card())
    .catch((e) => console.warn("a reply landed but its box item would not write", e));
}
