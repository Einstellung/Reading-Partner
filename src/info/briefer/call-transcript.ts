// Where a voice call's lines are written as they settle (voice-call-live.ts).
//
// The call's own home is the day's info thread: the model history the briefing
// page's Ask reads and the distillation that runs on hang-up. The same lines
// are also copied into today's door conversation, which is where the call is
// entered and where Lumen's panel shows what was said (docs/68), live through
// the thread store's append event. One stamp per line, shared by every copy,
// so a line that settles again is patched in place everywhere.

export interface CallThread {
  /** The thread store's key: a book id, or a day at the door. */
  key: string;
  threadId: string;
}

export interface CallLine {
  /** The call's own name for the line: the same key again is the same line, settled further. */
  key: string;
  role: "user" | "ai";
  text: string;
}

export interface CallTranscriptDeps {
  append(key: string, threadId: string, message: { role: "user" | "ai"; text: string; ts: number }): void;
  patch(key: string, threadId: string, ts: number, patch: { text: string }): void;
  now(): number;
}

/** A writer for the call's lines into every one of `threads`. */
export function callTranscriptWriter(
  threads: readonly CallThread[],
  deps: CallTranscriptDeps,
): (line: CallLine) => void {
  const stamps = new Map<string, number>();
  let last = 0;
  return ({ key, role, text }) => {
    const at = stamps.get(key);
    if (at !== undefined) {
      for (const thread of threads) deps.patch(thread.key, thread.threadId, at, { text });
      return;
    }
    const ts = Math.max(deps.now(), last + 1);
    last = ts;
    stamps.set(key, ts);
    for (const thread of threads) deps.append(thread.key, thread.threadId, { role, text, ts });
  };
}
