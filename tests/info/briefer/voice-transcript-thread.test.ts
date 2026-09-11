// Where a voice call's turns end up (docs/33 M-voice-3). The driver and the
// state machine are held down elsewhere; what this file holds down is the one
// port that writes, threadTranscript, against the real thread store on an
// in-memory disk.
//
// The bug it exists for: the orb and the text chat are alternatives on the info
// page (InfoHome), only the chat ever created the day's thread, and a message
// appended to a thread that is not there is dropped in silence — so a call on a
// day whose chat was never opened left nothing behind at all.
//
// Run: bun test tests/info/briefer/voice-transcript-thread.test.ts

import { beforeEach, expect, test } from "bun:test";
import { briefingThreadId } from "../../../src/info/briefer/anchors";
import { infoBookId } from "../../../src/info/briefer/call";
import type { ConversationEvent, ConversationSource } from "../../../src/soul/voice/conversation";
import {
  KICKOFF_TURN,
  createVoiceCall,
  type VoiceCall,
  type VoiceCallModel,
} from "../../../src/soul/voice/voice-call";
import { threadTranscript } from "../../../src/info/briefer/voice-call-live";
import {
  createThread,
  getThread,
  rebuildThreadStoreForTests,
  type ThreadMessage,
} from "../../../src/platform/app/threads";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";
import { useDom } from "../../support/dom";

// A window, for the store's debounced write and nothing else: without one the
// writer schedules no timer at all (debounced-writer.ts), so a headless run can
// hold the cache but never the file — and the file is the question here.
await useDom();

const DATE = "2026-09-06";
const BOOK = infoBookId(DATE);
const THREAD = briefingThreadId(DATE);
const FILE = `threads-${BOOK}.json`;

const GREETING = "今天最值得看的是这条。你想先听哪个？";
const ANSWER = "第一条是这个。";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
  // The store as it was first imported: the previous case's messages must not
  // be appended to this case's thread (see the note on the export).
  rebuildThreadStoreForTests();
});

// A call with no plugin under it and no model behind it: the bridge answers
// every command and the model turn is settled by hand. Only the transcript is
// the real thing.
function harness(): {
  call: VoiceCall;
  emit: (e: ConversationEvent) => Promise<void>;
  say: (turn: number, text: string) => Promise<void>;
} {
  let listener: ((e: ConversationEvent) => void) | null = null;
  const runs = new Map<number, { onDelta: (c: string) => void; done: () => void }>();

  const bridge: ConversationSource = {
    start: async (onEvent) => {
      listener = onEvent;
    },
    stop: async () => {
      listener = null;
    },
    setVolume: async () => {},
    speakBegin: async () => 7,
    speakPush: async () => {},
    speakClose: async () => {},
    speakStop: async () => ({ utterance: 7, sentence: 0, positionMs: 0, durationMs: 0 }),
  };

  const model: VoiceCallModel = {
    ask: ({ turn, onDelta }) =>
      new Promise<void>((resolve) => {
        runs.set(turn, { onDelta, done: resolve });
      }),
  };

  const call = createVoiceCall({
    bridge,
    model,
    transcript: threadTranscript(BOOK, THREAD),
  });

  const settle = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 0));
    await call.settled();
  };

  return {
    call,
    emit: async (e) => {
      listener?.(e);
      await settle();
    },
    // The companion answers `turn` in full and the player says all of it.
    say: async (turn, text) => {
      const run = runs.get(turn);
      if (!run) throw new Error(`no model turn ${turn}`);
      run.onDelta(text);
      run.done();
      await settle();
      listener?.({ kind: "spoken", turn, utterance: 7, reason: "done" });
      await settle();
    },
  };
}

/** The thread file, once the store's debounced write has landed. */
async function fileAfterWrite(): Promise<{ threads: Record<string, { messages: ThreadMessage[] }> }> {
  const until = Date.now() + 3000;
  for (;;) {
    const text = disk.files.get(FILE);
    if (text !== undefined) return JSON.parse(text) as never;
    if (Date.now() > until) throw new Error(`${FILE} was never written`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("a call on a day with no thread leaves its turns on disk", async () => {
  expect(getThread(BOOK, THREAD)).toBeUndefined();

  const h = harness();
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await h.say(KICKOFF_TURN, GREETING);
  await h.emit({ kind: "speech-end", turn: 1, text: "第一条是什么", silentMs: 1250 });
  await h.say(1, ANSWER);

  const file = await fileAfterWrite();
  const messages = file.threads[THREAD]?.messages ?? [];
  expect(messages.map((m) => [m.role, m.text])).toEqual([
    // The kickoff note is the driver's sentence, so turn 0 leaves only a reply.
    ["ai", GREETING],
    ["user", "第一条是什么"],
    ["ai", ANSWER],
  ]);
});

test("the call opens the same conversation the text chat does", async () => {
  const h = harness();
  await h.call.start();

  // Same id, same "info" anchor, same per-day pseudo-book as use-info-call.ts:
  // whichever way today is entered, there is one thread.
  const thread = getThread(BOOK, THREAD);
  expect(thread?.annotationId).toBe("info");
  expect(thread?.path).toBe(BOOK);
});

test("a thread the chat already made is written into, not replaced", async () => {
  const made = createThread(BOOK, "info", THREAD);
  made.messages.push({ role: "user", text: "早上问过的", ts: 1 });

  const h = harness();
  await h.call.start();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  await h.say(KICKOFF_TURN, GREETING);

  expect(getThread(BOOK, THREAD)).toBe(made);
  expect(made.messages.map((m) => m.text)).toEqual(["早上问过的", GREETING]);
});
