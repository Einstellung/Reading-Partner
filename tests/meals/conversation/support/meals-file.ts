// The meals conversation's thread file on disk, for the kill test.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { threadFileName, type ThreadMessage } from "../../../../src/platform/app/threads";
import { MEALS_ADDRESS } from "../../../../src/meals/conversation/durable";

export const MEALS_LINE: ThreadMessage = { id: "m-1", role: "user", text: "What matters today?", ts: 1000 };
export const MEALS_ANSWER = "The rate decision matters most, then the chip rules, slowly. ".repeat(40);

/** The conversation's file as the reader's line left it: one thread, the line last. */
export function seedMealsFile(root: string): void {
  const { key, threadId } = MEALS_ADDRESS;
  const thread = { id: threadId, annotationId: "", book: true, path: key, createdAt: 1, messages: [MEALS_LINE] };
  writeFileSync(join(root, threadFileName(key)), JSON.stringify({ threads: { [thread.id]: thread } }));
}

export function mealsFileMessages(root: string): ThreadMessage[] {
  const { key, threadId } = MEALS_ADDRESS;
  const file = JSON.parse(readFileSync(join(root, threadFileName(key)), "utf8"));
  return file.threads[threadId].messages;
}
