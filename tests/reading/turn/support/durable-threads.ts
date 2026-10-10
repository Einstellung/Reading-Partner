// A book thread file in memory for the durable runtime's tests, logging the
// appends and flushes in order.

import type { ThreadMessage } from "../../../../src/platform/app/threads";
import type { BookThreads } from "../../../../src/reading/turn/durable-book";

// `unloaded` behaves like the app's store before the book is opened: nothing
// to read and appends dropped until `load` (docs/pitfall/523).
export function fakeThreads(initial: ThreadMessage[] = [], options: { unloaded?: boolean } = {}) {
  const log: string[] = [];
  const messages = [...initial];
  let loaded = !options.unloaded;
  const threads: BookThreads = {
    load: async () => {
      loaded = true;
    },
    messages: () => (loaded ? messages : undefined),
    append: (_home, _threadId, message) => {
      if (!loaded) return;
      messages.push(message);
      log.push(`append:${message.role}:${message.ts}`);
    },
    flush: async () => {
      log.push("flush");
    },
  };
  return { threads, messages, log };
}
