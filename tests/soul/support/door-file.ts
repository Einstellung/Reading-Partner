// A day at the door's thread file on disk, for the door's kill test.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { threadFileName, type ThreadMessage } from "../../../src/platform/app/threads";
import { doorKey } from "../../../src/soul/door";
import { doorOrigin } from "../../../src/soul/door-durable";

export const DOOR = doorOrigin("2026-10-11", "door-thread-1");
export const DOOR_LINE: ThreadMessage = { id: "m-1", role: "user", text: "What should I read next?", ts: 1000 };
export const DOOR_ANSWER = "Start with the short essays, then the long one, slowly. ".repeat(40);

/** The day's file as the reader's line left it: one thread, the line last. */
export function seedDoorFile(root: string): void {
  const key = doorKey(DOOR.date);
  const thread = { id: DOOR.threadId, annotationId: "", book: true, path: key, createdAt: 1, messages: [DOOR_LINE] };
  writeFileSync(join(root, threadFileName(key)), JSON.stringify({ threads: { [thread.id]: thread } }));
}

export function doorFileMessages(root: string): ThreadMessage[] {
  const file = JSON.parse(readFileSync(join(root, threadFileName(doorKey(DOOR.date))), "utf8"));
  return file.threads[DOOR.threadId].messages;
}
