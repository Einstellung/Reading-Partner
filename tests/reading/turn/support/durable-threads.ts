// A book thread file in memory for the durable runtime's tests, logging the
// appends and flushes in order.

import type { ThreadMessage } from "../../../../src/platform/app/threads";
import type { BookThreads } from "../../../../src/reading/turn/durable-book";

export function fakeThreads(initial: ThreadMessage[] = []) {
  const log: string[] = [];
  const messages = [...initial];
  const threads: BookThreads = {
    messages: () => messages,
    append: (_home, _threadId, message) => {
      messages.push(message);
      log.push(`append:${message.role}:${message.ts}`);
    },
    flush: async () => {
      log.push("flush");
    },
  };
  return { threads, messages, log };
}
