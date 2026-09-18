// A message that landed in the open conversation without the view putting it
// there (docs/68). The soul answering a delegated run appends its reply to the
// thread the run was sent from, whoever is looking at it — and the reader who
// stayed in that conversation to wait is the commonest case of all.
//
// The rule is here; the subscription and the dispatch are the session's
// (reading/session/use-call.ts). Two questions: is this append one the view made
// itself, and is it in the conversation on screen.

import { newThreadMessageId, type ThreadAppend, type ThreadMessage } from "../platform/app/threads";

/**
 * The ids this view appended.
 *
 * An id is taken before the append rather than read back off it afterwards,
 * because the channel calls its listeners inside appendMessage: a set filled
 * after that call has not been filled yet when the listener runs, and the reply
 * the view is already showing would be inserted under it a second time.
 */
export interface OwnAppends {
  /** The message to append, carrying an id this view will recognise. */
  mint(message: ThreadMessage): ThreadMessage;
  /** Whether this append is one of ours. A claimed id is forgotten. */
  claim(message: ThreadMessage): boolean;
}

export function createOwnAppends(newId: () => string = newThreadMessageId): OwnAppends {
  const mine = new Set<string>();
  return {
    mint(message) {
      if (message.id) {
        mine.add(message.id);
        return message;
      }
      const id = newId();
      mine.add(id);
      return { ...message, id };
    },
    // Forgotten on the way through: every minted id is announced exactly once,
    // so a session that talks all evening does not accumulate one per message.
    claim: (message) => message.id !== undefined && mine.delete(message.id),
  };
}

/** The conversation on screen, as the rule reads it. */
export interface OpenThread {
  threadId: string;
  /** The document whose thread file it is written to (session/documents.ts). */
  home: string;
}

/**
 * The message to show, or null for one there is nothing to do about.
 *
 * Claimed first and whatever else is true: an append this view made into a
 * conversation that is not the one on screen — the receipt written back into the
 * lesson as the reader leaves a side conversation — is still ours, and dropping
 * out before the claim would leave its id behind for good.
 */
export function arrivedMessage(
  append: ThreadAppend,
  open: OpenThread | null | undefined,
  own: OwnAppends,
): ThreadMessage | null {
  const ours = own.claim(append.message);
  if (ours || !open) return null;
  if (append.threadId !== open.threadId || append.key !== open.home) return null;
  return append.message;
}
