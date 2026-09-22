// Which words a hold on the lesson picked out (docs/74).
//
// The phone takes a paragraph, not a selection. There is no character-level
// selection on this path at all — the system's own is turned off over the reply
// so the hold can mean something else (styles.css: [data-lesson-press]) — so
// what the reader gets is the block their finger landed in, clipped by the same
// rule a desktop selection is clipped by (reading/aside.ts: asideSpan).
//
// The reply is found by `data-reply-ts`, the marker chat.tsx already writes on
// the prose of a reply worth marking (reading/chat-marks.ts: mayMarkReply). So
// a hold on the reader's own message, on a tool trace, on a budget notice or on
// a reply still being written picks nothing, without this file knowing what any
// of those are.

import { asideSpan } from "../../../reading/aside";

/** A paragraph of a reply, and the reply it came out of. */
export interface LessonAskSpan {
  // The parent message's timestamp: what the aside's anchor hangs on, and what
  // decides how far back its turn replays the lesson (asideParentTail).
  messageTs: number;
  text: string;
}

// The blocks a paragraph can be. Markdown's, because a reply is Markdown — the
// same list chat-mark-dom.ts separates on, minus the containers that would hand
// back several paragraphs at once.
const BLOCKS = "p,li,blockquote,pre,h1,h2,h3,h4,h5,h6,td,th,figcaption,dd,dt";

/**
 * The span a press on this node picked out, or null when the node is not in a
 * reply, or is in one with nothing worth asking about.
 *
 * Falls back to the whole reply when the press landed between blocks — the
 * padding around a one-paragraph answer is still that answer.
 */
export function replySpanAt(node: Node | null | undefined): LessonAskSpan | null {
  const from = node instanceof Element ? node : (node?.parentElement ?? null);
  const reply = from?.closest<HTMLElement>("[data-reply-ts]");
  if (!reply) return null;
  const ts = Number(reply.getAttribute("data-reply-ts"));
  if (!Number.isFinite(ts)) return null;
  const block = from?.closest<HTMLElement>(BLOCKS);
  const source = block && reply.contains(block) ? block : reply;
  const text = asideSpan(source.textContent ?? "");
  return text === null ? null : { messageTs: ts, text };
}
