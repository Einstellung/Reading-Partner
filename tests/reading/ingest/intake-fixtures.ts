// An intake store over an in-memory file map and a topic shelf that records
// every attach, for the intake tests.

import { createIntakeStore } from "../../../src/reading/ingest/intake-store";

export function memoryIntakes() {
  const files = new Map<string, string>();
  const attached: { topicId: string; path: string; hash: string }[] = [];
  let n = 0;
  let clock = 1000;
  const store = createIntakeStore({
    read: async (path) => files.get(path) ?? null,
    write: async (path, text) => {
      files.set(path, text);
    },
    attachToTopic: async (topicId, path, hash) => {
      attached.push({ topicId, path, hash });
    },
    newId: () => `in-${++n}`,
    now: () => ++clock,
  });
  return { store, files, attached };
}
