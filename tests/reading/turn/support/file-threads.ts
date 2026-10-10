// The app's thread store over a directory, for the book runtime's kill tests:
// the same store the app runs (appends dropped until a book is loaded,
// read-modify-write on flush), with files in place of AppData.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import { createThreadStore, threadFileName, type ThreadMessage } from "../../../../src/platform/app/threads";
import type { BookOrigin } from "../../../../src/reading/turn/durable-book";

export const KILL_BOOK = {
  place: "book",
  bookId: "book-1",
  threadId: "thread-1",
  home: "book-1",
} as unknown as BookOrigin;

export const KILL_LINE: ThreadMessage = { id: "m-1", role: "user", text: "Explain the tides.", ts: 1000 };

export const KILL_ANSWER = "The tides follow the moon, and the sun pulls a little too. ".repeat(40);

export function fileThreadStore(root: string) {
  return createThreadStore({
    read: async (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null),
    write: async (file, text) => writeFileSync(join(root, file), text),
    quarantine: async () => null,
    exit: () => {},
  });
}

/** The book's thread file as the reader's line left it: one thread, the line last. */
export function seedThreadFile(root: string): void {
  const thread = {
    id: KILL_BOOK.threadId,
    annotationId: "",
    book: true,
    path: KILL_BOOK.home,
    createdAt: 1,
    messages: [KILL_LINE],
  };
  writeFileSync(join(root, threadFileName(KILL_BOOK.home)), JSON.stringify({ threads: { [thread.id]: thread } }));
}

export function threadFileMessages(root: string): ThreadMessage[] {
  const file = JSON.parse(readFileSync(join(root, threadFileName(KILL_BOOK.home)), "utf8"));
  return file.threads[KILL_BOOK.threadId].messages;
}

export function slowFauxModels(texts: string[], tokensPerSecond: number) {
  const faux = fauxProvider({
    tokensPerSecond,
    tokenSize: { min: 1, max: 2 },
    models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 4096 }],
  });
  faux.setResponses(texts.map((text) => fauxAssistantMessage(fauxText(text))));
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, faux };
}
