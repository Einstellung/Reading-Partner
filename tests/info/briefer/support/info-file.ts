// An info or meals conversation's thread file on disk, for the kill tests.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { threadFileName, type ThreadMessage } from "../../../../src/platform/app/threads";
import { infoAddress, infoThreadKey, type InfoOrigin } from "../../../../src/info/briefer/info-durable";
import { MEALS_ADDRESS, MEALS_CONVERSATION_KEY, type MealsOrigin } from "../../../../src/meals/conversation/durable";

/** The conversation's key and thread, for either place. */
export const keyOf = (o: InfoOrigin | MealsOrigin): string => (o.place === "meals" ? MEALS_CONVERSATION_KEY : infoThreadKey(o));
export const addressOf = (o: InfoOrigin | MealsOrigin) => (o.place === "meals" ? MEALS_ADDRESS : infoAddress(o));

export const KILL_ORIGINS: Record<"info" | "meals", InfoOrigin | MealsOrigin> = {
  info: { place: "info", date: "2026-10-11", threadId: "briefing-2026-10-11" },
  meals: { place: "meals" },
};
export const INFO_LINE: ThreadMessage = { id: "m-1", role: "user", text: "What matters today?", ts: 1000 };
export const INFO_ANSWER = "The rate decision matters most, then the chip rules, slowly. ".repeat(40);

/** The conversation's file as the reader's line left it: one thread, the line last. */
export function seedInfoFile(root: string, origin: InfoOrigin | MealsOrigin): void {
  const { key, threadId } = addressOf(origin);
  const thread = { id: threadId, annotationId: "", book: true, path: key, createdAt: 1, messages: [INFO_LINE] };
  writeFileSync(join(root, threadFileName(key)), JSON.stringify({ threads: { [thread.id]: thread } }));
}

export function infoFileMessages(root: string, origin: InfoOrigin | MealsOrigin): ThreadMessage[] {
  const { key, threadId } = addressOf(origin);
  const file = JSON.parse(readFileSync(join(root, threadFileName(key)), "utf8"));
  return file.threads[threadId].messages;
}
