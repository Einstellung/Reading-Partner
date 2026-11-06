// Kill fixtures arm on what Storage holds, not on the view: pi-durable 1.5
// shows a partial to watches before it stores it (docs/pitfall/694), so a
// child killed when the view showed N characters may have stored fewer.

import type { ConversationId, Session } from "@earendil-works/pi-durable";
import { textOf } from "../../../../src/legion/durable/turn";

/** Call `fire` once, with the text, when a stored pi.live of `conversationId` holds at least `min` characters of answer. */
export function whenStoredText(
  session: Session,
  conversationId: ConversationId | undefined,
  min: number,
  fire: (text: string) => void,
): void {
  const observation = session.observeCommits({
    advance(publication) {
      for (const change of publication.changes) {
        if (change.type !== "document" || change.kind !== "change" || change.record.kind !== "pi.live") continue;
        if (conversationId !== undefined && change.conversationId !== conversationId) continue;
        const text = textOf((change.value as { generation?: { message?: unknown } }).generation?.message);
        if (text.length < min) continue;
        observation.detach();
        fire(text);
        return;
      }
    },
    end() {},
  });
}
