// The tests' stand-in for the conversation view state pi-durable 1.1.0 had
// (`Conversation.viewState()`): the active transcript and the built-in
// documents, its current value and a subscription, on followActiveView.

import type { Context } from "@earendil-works/chord";
import type { Conversation } from "@earendil-works/pi-durable";
import { followActiveView, type ActiveView } from "../../../../src/legion/durable/follow-view";

export interface ViewState {
  readonly value: ActiveView;
  subscribe(listener: (value: ActiveView) => void): () => void;
  dispose(): void;
}

export async function viewState(conversation: Conversation, context: Context): Promise<ViewState> {
  let value: ActiveView = { entries: [], docs: {} };
  const listeners = new Set<(value: ActiveView) => void>();
  const stop = await followActiveView(
    conversation,
    (next) => {
      value = next;
      for (const listener of listeners) listener(next);
    },
    context,
  );
  return {
    get value() {
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: stop,
  };
}
