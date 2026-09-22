// The lesson's side conversation, as state (docs/74): which aside is open, the
// record behind it, and the line it leaves on the lesson on the way back.
//
// The pure half is reading/aside.ts and is shared with the desk — the span, the
// anchor, the way back and the receipt are the same on both shells. What is
// here is only what this shell does differently: the aside is a view inside the
// lesson screen rather than another conversation in a call slot, so there is no
// call to swap and nothing to route.
//
// One level. The aside view is drawn without the gesture that opens one, so
// there is no case here for an aside off an aside.

import { useCallback, useEffect, useRef, useState } from "react";

import { asideAnchorAt, asideReceipt, asideReturn } from "../../../reading/aside";
import {
  appendMessage,
  createAsideThread,
  getThread,
  patchThreadMessage,
  threadKind,
  type AsideInit,
} from "../../../platform/app/threads";
import { nextCardId, toPersistedCardPart } from "../chat/chatParts";
import type { LessonAskSpan } from "./lesson-aside";

/** The aside on screen: its conversation, and the words it was pulled out of. */
export interface LessonAsideOpen {
  threadId: string;
  span: string;
}

export interface LessonAside {
  open: LessonAsideOpen | null;
  /** A paragraph of the lesson the reader asked about. */
  ask: (span: LessonAskSpan) => void;
  /**
   * Write the open aside down, if it is not already. Called on its first
   * question and nowhere else: the view is free, the record is not.
   */
  ensure: () => void;
  /** A receipt row pressed: back into the aside it stands for. */
  reopen: (threadId: string) => void;
  /** Back to the lesson, leaving the line behind. */
  back: () => void;
}

export function useLessonAside(bookId: string, parentThreadId: string): LessonAside {
  const [open, setOpen] = useState<LessonAsideOpen | null>(null);
  // Read at the moment of use rather than closed over: `back` is handed to the
  // shell's one back button, which must not be rebound as the lesson moves.
  const openRef = useRef<LessonAsideOpen | null>(null);
  openRef.current = open;
  const parentRef = useRef(parentThreadId);
  parentRef.current = parentThreadId;
  // The record the open aside would be written down as, until something is
  // asked in it. Null once it has been written, and on one that was opened from
  // a receipt and therefore already exists.
  const pendingRef = useRef<{ threadId: string; init: AsideInit } | null>(null);

  // A lesson swapped underneath is a different book: whatever was open belonged
  // to the old one.
  useEffect(() => {
    pendingRef.current = null;
    setOpen(null);
  }, [bookId]);

  const ask = useCallback(
    (span: LessonAskSpan) => {
      const parent = parentRef.current;
      if (!parent || openRef.current) return;
      const anchor = asideAnchorAt(span.messageTs, span.text);
      if (!anchor) return;
      const threadId = crypto.randomUUID();
      // Held, not written. A reader who pressed the control and thought better
      // of it leaves nothing behind — the same rule the desk's asides follow
      // (reading/session/use-call.ts ensureAsideRecord). The id is settled now
      // all the same, so the conversation the view runs on does not change
      // under it when the first question does write it down.
      pendingRef.current = { threadId, init: { parentThreadId: parent, asideAnchor: anchor } };
      setOpen({ threadId, span: anchor.text });
    },
    [bookId],
  );

  // The record arrives with the first question. The aside's own turn is run by
  // a second useLessonCall, and that hook assembles its turn off the record:
  // with no record the desk would read the aside as the lesson itself and
  // answer with the lesson's prompt.
  const ensure = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    createAsideThread(bookId, pending.threadId, pending.init);
  }, [bookId]);

  const reopen = useCallback(
    (threadId: string) => {
      const thread = getThread(bookId, threadId);
      if (!thread || threadKind(thread) !== "aside") return;
      if (thread.parentThreadId !== parentRef.current) return;
      pendingRef.current = null;
      setOpen({ threadId, span: thread.asideAnchor?.text ?? "" });
    },
    [bookId],
  );

  // The receipt (reading/aside.ts): a row under the message the reader stepped
  // out of, and a sentence the model reads on the lesson's next turn. Both come
  // out of the aside's own first question, so nothing about coming back waits
  // on a model call.
  //
  // Idempotent, and it has to be: a reader who reopens an aside from its row
  // and steps back again must not be given the same line twice.
  //
  // An aside nothing was asked in was never written down (ensure), so there is
  // no conversation for a row to point at: it leaves no line and no record.
  const back = useCallback(() => {
    const aside = openRef.current;
    pendingRef.current = null;
    setOpen(null);
    if (!aside) return;
    const own = getThread(bookId, aside.threadId);
    const parent = getThread(bookId, parentRef.current);
    // Nowhere to leave it: the lesson was deleted, or the link points at
    // something that is itself an aside.
    if (!own || !parent || !asideReturn(parent)) return;
    const write = asideReceipt({
      threadId: aside.threadId,
      span: aside.span,
      // No page. A span pulled out of a reply was never on one, and this shell
      // draws no pages at all (docs/74).
      messages: own.messages,
      parent: parent.messages,
    });
    if (!write) return;
    if (write.mode === "merge") {
      // Asides left one after another with nothing said in the lesson between
      // them are one row, not one each.
      patchThreadMessage(bookId, parent.id, write.ts, {
        text: write.text,
        parts: [toPersistedCardPart(write.cardId, write.card)],
      });
      return;
    }
    appendMessage(bookId, parent.id, {
      role: "ai",
      text: write.text,
      ts: Date.now(),
      parts: [toPersistedCardPart(nextCardId("aside"), write.card)],
    });
  }, [bookId]);

  return { open, ask, ensure, reopen, back };
}
