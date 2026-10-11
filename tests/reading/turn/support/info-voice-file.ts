// The voice call's conversation, for the kill test and its child.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { infoAddress, type InfoOrigin } from "../../../../src/info/briefer/info-durable";
import { threadFileName, type ThreadMessage } from "../../../../src/platform/app/threads";

export const VOICE_DATE = "2026-10-11";
export const VOICE_ORIGIN: InfoOrigin = { place: "info", date: VOICE_DATE, threadId: `briefing-${VOICE_DATE}` };
export const VOICE_LINE = "What matters today?";
export const VOICE_ANSWER = "The rate decision matters most, then the chip rules, slowly. ".repeat(40);

export function voiceFileMessages(root: string): ThreadMessage[] {
  const { key, threadId } = infoAddress(VOICE_ORIGIN);
  const file = JSON.parse(readFileSync(join(root, threadFileName(key)), "utf8"));
  return file.threads[threadId].messages;
}
