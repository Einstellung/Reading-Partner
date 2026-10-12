// The coach's and the retell's thread files on disk, for their kill tests: a
// talk's conversation with the reader's pass last, and a retell opened with
// nothing in it (its opening turn's line is the kickoff, not a row).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlaceFactory } from "../../../../src/legion/durable/device";
import { threadFileName, type ThreadMessage } from "../../../../src/platform/app/threads";
import { coachConversationKey, coachOrigin, coachPlace, COACH_PLACE } from "../../../../src/reading/rehearsal/coach-durable";
import { RETELL_KICKOFF } from "../../../../src/reading/retell/prompt";
import { retellConversationKey, retellOrigin, retellPlace, RETELL_PLACE } from "../../../../src/reading/retell/retell-durable";
import { retellThreadKey } from "../../../../src/reading/retell/store";
import { talkThreadKey } from "../../../../src/reading/talk/store";
import type { OneThreadOrigin } from "../../../../src/reading/turn/one-thread-place";

export const KILL_PASS: ThreadMessage = { id: "m-1", role: "user", text: "I have just given this talk out loud.", ts: 1000 };
export const KILL_REPLY = "The opening lands; the middle runs long, so cut the second case. ".repeat(40);

export interface KillCase {
  name: "coach" | "retell";
  place: string;
  key: string;
  origin: OneThreadOrigin;
  fileKey: string;
  /** The file as the view left it before the turn. */
  seed: ThreadMessage[];
  /** The turn's line, and its row in the file if it is one. */
  line: { text: string; ts?: number };
  factory(): PlaceFactory;
}

export const KILL_CASES: Record<KillCase["name"], KillCase> = {
  coach: {
    name: "coach",
    place: COACH_PLACE,
    key: coachConversationKey("o1"),
    origin: coachOrigin("o1"),
    fileKey: talkThreadKey("o1"),
    seed: [KILL_PASS],
    line: { text: KILL_PASS.text, ts: KILL_PASS.ts },
    factory: () => coachPlace({ assembled: new Map(), openDesk: async () => [] }),
  },
  retell: {
    name: "retell",
    place: RETELL_PLACE,
    key: retellConversationKey("r1"),
    origin: retellOrigin("r1"),
    fileKey: retellThreadKey("r1"),
    seed: [],
    line: { text: RETELL_KICKOFF },
    factory: () => retellPlace({ assembled: new Map(), openDesk: async () => [] }),
  },
};

export function seedKillFile(root: string, c: KillCase): void {
  const thread = { id: c.origin.id, annotationId: "", book: true, path: c.fileKey, createdAt: 1, messages: c.seed };
  writeFileSync(join(root, threadFileName(c.fileKey)), JSON.stringify({ threads: { [thread.id]: thread } }));
}

export function killFileMessages(root: string, c: KillCase): ThreadMessage[] {
  const file = JSON.parse(readFileSync(join(root, threadFileName(c.fileKey)), "utf8"));
  return file.threads[c.origin.id].messages;
}
