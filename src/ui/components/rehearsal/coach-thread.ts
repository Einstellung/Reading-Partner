// The talk's conversation, from the outside: how it is opened and how a finished
// pass gets into it (docs/44).
//
// One conversation per outline, not per rehearsal and not per pass. The reader
// gives the talk again and again, and the point of coming back is that the coach
// remembers the last time — three passes in three threads would be three
// strangers (docs/43). The key and the reason are in reading/talk/store.ts; what
// is here is the wiring to platform/app/threads.

import {
  appendMessage,
  createThread,
  getThread,
  loadThreads,
  type ThreadMessage as StoredMessage,
} from "../../../platform/app/threads";
import {
  passMessage,
  type RehearsalPage,
  type RehearsalRunEntry,
} from "../../../reading/rehearsal";
import { talkThreadKey, type TalkOutline } from "../../../reading/talk";

// A talk has exactly one conversation, so the thread id is the outline's id.
// Nothing has to be looked up, and a thread file with a second thread in it
// could only come from a hand edit. Same shape as the retell's.
export function coachThreadId(outlineId: string): string {
  return outlineId;
}

/**
 * Open the talk's conversation, making it if this is the first pass, and answer
 * the messages in it. Every caller goes through here: appending to a thread the
 * store has not loaded is a no-op (platform/app/threads.ts), so a pass handed in
 * before the view was ever opened would vanish.
 */
export async function openCoachThread(outlineId: string): Promise<StoredMessage[]> {
  const key = talkThreadKey(outlineId);
  await loadThreads(key).catch(() => ({}));
  const id = coachThreadId(outlineId);
  const thread = getThread(key, id) ?? createThread(key, "", id);
  return thread.messages;
}

export interface HandOffPassInput {
  // Only for the conversation this goes into: the message itself says nothing
  // about the talk, because the coach's prompt already carries the whole note.
  outline: TalkOutline;
  // The pass as the store recorded it, and what was said during it.
  entry: RehearsalRunEntry;
  pages: readonly RehearsalPage[];
  now?: number;
}

/**
 * Put a finished pass into the talk's conversation, as the reader's own message.
 * True when something went in; false for a pass with no words in it, which has
 * nothing for a coach to hear.
 *
 * It goes in as a message rather than being handed to a turn here on purpose:
 * the coach answers when the reader is looking at the conversation, and a pass
 * given on a machine with no model configured still sits there to be answered
 * later.
 */
export async function handOffPass(input: HandOffPassInput): Promise<boolean> {
  const text = passMessage({ entry: input.entry, pages: input.pages });
  if (!text) return false;
  await openCoachThread(input.outline.id);
  appendMessage(talkThreadKey(input.outline.id), coachThreadId(input.outline.id), {
    role: "user",
    text,
    ts: input.now ?? Date.now(),
  });
  return true;
}

/**
 * Whether the conversation is waiting on the coach: the last thing said was the
 * reader's, and nothing has answered it. That covers both ways a turn starts —
 * a pass just handed in, and a reply typed — so neither needs a flag of its own.
 */
export function awaitingReply(messages: readonly { role: string; text: string }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    // Card rows carry their payload in `parts` and no text; they are receipts
    // for what the coach wrote, not something anyone said.
    if (!m.text.trim()) continue;
    return m.role === "user";
  }
  return false;
}
