// The confirmation cards a delegated run left (docs/platform/687 确认). A
// worker has no card channel, so an edit_data change it made that waits for the
// reader is kept as a pending record stamped with its run id. When the run is
// answered in the conversation it was asked from (bell.ts), each such record's
// card is appended there after the reply, where the reader confirms it.

import { confirmCard, liveWriteDeps, pendingOfRun, type WriteIo } from "../housekeeper/write";
import { appendMessage, flushThreads, loadThreads, type ThreadMessage } from "../platform/app/threads";

/** The thread a delivered reply landed in (TurnDeliveryOutcome.address). */
export interface ThreadAddress {
  key: string;
  threadId: string;
}

export interface RunCardDeps {
  io: WriteIo;
  load(key: string): Promise<void>;
  append(key: string, threadId: string, message: ThreadMessage): void;
  flush(): Promise<void>;
  now(): number;
}

export function liveRunCardDeps(): RunCardDeps {
  return {
    io: liveWriteDeps().io,
    load: async (key) => {
      await loadThreads(key).catch(() => ({}));
    },
    append: (key, threadId, message) => appendMessage(key, threadId, message),
    flush: flushThreads,
    now: Date.now,
  };
}

/** The card id a pending record is shown under: one record, one card. */
export function runCardId(pendingId: string): string {
  return `housekeeper-${pendingId}`;
}

/** Append a card for each record `runId` left waiting. Returns how many were appended. */
export async function appendRunConfirmCards(
  runId: string,
  address: ThreadAddress,
  deps: RunCardDeps = liveRunCardDeps(),
): Promise<number> {
  const records = await pendingOfRun(deps.io, runId);
  if (records.length === 0) return 0;
  await deps.load(address.key);
  const at = deps.now();
  records.forEach((record, i) => {
    const card = confirmCard(record);
    deps.append(address.key, address.threadId, {
      role: "ai",
      text: "",
      // One millisecond apart: a row is told from the next by role and timestamp.
      ts: at + i,
      parts: [{ type: "card", id: runCardId(record.pendingId), card: { ...card } }],
    });
  });
  await deps.flush();
  return records.length;
}
