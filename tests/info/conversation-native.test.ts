// The wire contract with the plugin's full-duplex half: the command strings,
// the argument keys, the plugin event name, and the one property that separates
// this event from `dictation` — a reducer that survives a kind it has never seen.
//
// The bridge is a parameter rather than a mocked module for the reason
// dictation-native.test.ts states: mock.module rewrites the whole worker's
// registry and does not roll back (docs/pitfall/119).
//
// Run: bun test tests/info/conversation-native.test.ts

import { expect, test } from "bun:test";
import {
  EMPTY_CONVERSATION,
  applyConversationEvent,
  createNativeConversation,
  type ConversationBridge,
  type ConversationEvent,
  type ConversationState,
} from "../../src/info/companion/conversation";

interface Call {
  command: string;
  args?: Record<string, unknown>;
}

function bridge(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const subscriptions: { plugin: string; event: string }[] = [];
  let unregistered = 0;
  let emit: ((e: ConversationEvent) => void) | null = null;

  const it: ConversationBridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args });
      if (answers[command] instanceof Error) throw answers[command];
      return answers[command] as T;
    },
    async subscribe(plugin, event, cb) {
      subscriptions.push({ plugin, event });
      emit = cb;
      return {
        async unregister() {
          unregistered += 1;
        },
      };
    },
  };

  return {
    it,
    calls,
    subscriptions,
    fire: (e: ConversationEvent) => emit?.(e),
    unregistered: () => unregistered,
  };
}

const CUT = { utterance: 3, sentence: 2, charOffset: 7, playedMs: 810 };

// --- the commands -----------------------------------------------------------

test("start subscribes to the conversation event before it invokes", async () => {
  const b = bridge();
  await createNativeConversation({}, b.it).start(() => {});

  expect(b.subscriptions).toEqual([{ plugin: "voice", event: "conversation" }]);
  expect(b.calls[0].command).toBe("plugin:voice|start_conversation");
});

test("start passes locale and contextualStrings under exactly those keys", async () => {
  const b = bridge();
  await createNativeConversation({ locale: "zh-CN", contextualStrings: ["注意力"] }, b.it).start(
    () => {},
  );

  expect(b.calls[0].args).toEqual({ locale: "zh-CN", contextualStrings: ["注意力"] });
});

test("a start that fails drops the listener rather than leaking one", async () => {
  const b = bridge({ "plugin:voice|start_conversation": new Error("no microphone") });
  const call = createNativeConversation({}, b.it);

  await expect(call.start(() => {})).rejects.toThrow("no microphone");
  expect(b.unregistered()).toBe(1);
});

test("the speaking commands are the session's four, with the text under `text`", async () => {
  const b = bridge({ "plugin:voice|speak_begin": 4 });
  const call = createNativeConversation({}, b.it);

  expect(await call.speakBegin()).toBe(4);
  await call.speakPush("今天有三条。");
  await call.speakClose();
  await call.speakStop();
  await call.setVolume(0.25);

  expect(b.calls.map((c) => c.command)).toEqual([
    "plugin:voice|speak_begin",
    "plugin:voice|speak_push",
    "plugin:voice|speak_close",
    "plugin:voice|speak_stop",
    "plugin:voice|set_speech_volume",
  ]);
  expect(b.calls[1].args).toEqual({ text: "今天有三条。" });
  expect(b.calls[4].args).toEqual({ value: 0.25 });
});

test("stop drops the listener whether or not the command answers", async () => {
  const b = bridge({ "plugin:voice|stop_conversation": new Error("gone") });
  const call = createNativeConversation({}, b.it);
  await call.start(() => {});

  await expect(call.stop()).rejects.toThrow("gone");
  expect(b.unregistered()).toBe(1);
  expect(b.calls[1].command).toBe("plugin:voice|stop_conversation");
});

test("events reach the callback the start registered", async () => {
  const b = bridge();
  const seen: ConversationEvent[] = [];
  await createNativeConversation({}, b.it).start((e) => seen.push(e));

  b.fire({ kind: "level", turn: 1, value: 0.4 });
  expect(seen).toEqual([{ kind: "level", turn: 1, value: 0.4 }]);
});

// --- the reducer ------------------------------------------------------------

function fold(events: ConversationEvent[], from: ConversationState = EMPTY_CONVERSATION) {
  return events.reduce(applyConversationEvent, from);
}

test("a duck lowers nothing but the flag, and a resume puts it back", () => {
  const ducked = fold([{ kind: "speech-duck", turn: 2 }]);
  expect(ducked.ducked).toBe(true);
  expect(fold([{ kind: "speech-resume", turn: 2 }], ducked).ducked).toBe(false);
});

test("a stop carries where the companion was cut", () => {
  const s = fold([
    { kind: "speech-duck", turn: 2 },
    { kind: "speech-stop", turn: 2, cut: CUT },
  ]);
  expect(s.cut).toEqual(CUT);
  expect(s.ducked).toBe(false);
});

test("the turn number only ever goes up, however the events arrive", () => {
  const s = fold([
    { kind: "level", turn: 5, value: 0.1 },
    { kind: "final", turn: 2, text: "迟到的", range: { startMs: 0, endMs: 100 } },
  ]);
  expect(s.turn).toBe(5);
});

test("a late final for the turn on the floor extends what was heard", () => {
  const s = fold([
    { kind: "speech-end", turn: 3, text: "今天有什么", silentMs: 1250 },
    { kind: "final", turn: 3, text: "值得读的", range: { startMs: 0, endMs: 900 } },
  ]);
  // No space at a CJK seam, which is joinSpeech's rule.
  expect(s.heard).toBe("今天有什么值得读的");
});

test("a final for an older turn changes nothing on screen", () => {
  const s = fold([
    { kind: "speech-end", turn: 4, text: "第二个问题", silentMs: 1250 },
    { kind: "final", turn: 3, text: "迟到的一句", range: { startMs: 0, endMs: 900 } },
  ]);
  expect(s.heard).toBe("第二个问题");
});

test("a call that goes away is not left holding a duck or a level", () => {
  const s = fold([
    { kind: "state", turn: 1, running: true, reason: "opened" },
    { kind: "level", turn: 1, value: 0.6 },
    { kind: "speech-duck", turn: 1 },
    { kind: "state", turn: 1, running: false, reason: "lost" },
  ]);
  expect(s).toEqual({ ...EMPTY_CONVERSATION, turn: 1, reason: "lost" });
});

// The whole reason the call has an event of its own. `dictation` has four kinds
// and a reducer with no default branch, and a fifth kind there leaves the
// composer holding undefined with a hot microphone.
test("an unknown kind is folded as a no-op rather than throwing or erasing", () => {
  const before = fold([
    { kind: "state", turn: 1, running: true, reason: "opened" },
    { kind: "level", turn: 1, value: 0.3 },
  ]);
  const after = applyConversationEvent(before, {
    kind: "vad-hint",
    turn: 1,
    probability: 0.9,
  } as unknown as ConversationEvent);

  expect(after).toEqual(before);
});

test("a malformed event is a no-op too", () => {
  const before = fold([{ kind: "state", turn: 2, running: true, reason: "opened" }]);
  for (const junk of [{}, { kind: null }, null, undefined]) {
    expect(applyConversationEvent(before, junk as unknown as ConversationEvent)).toEqual(before);
  }
});

// Ignoring a kind is not ignoring the turn it carried. A `final` for that turn
// arrives next and is dropped as stale unless the counter has already moved, and
// what is dropped with it is the user's own words.
test("a kind this build has never heard of still moves the turn on", () => {
  const after = fold([
    { kind: "state", turn: 1, running: true, reason: "opened" },
    { kind: "speech-end", turn: 1, text: "第一句", silentMs: 1250 },
    { kind: "barge-in-v2", turn: 5 } as unknown as ConversationEvent,
    { kind: "final", turn: 5, text: "第五句", range: { startMs: 0, endMs: 10 } },
  ]);
  expect(after.turn).toBe(5);
  expect(after.heard).toContain("第五句");
});

// The default branch is only half of what this event promised over `dictation`.
// A kind this build knows, carrying a payload it does not, throws on the
// microphone's own callback unless every field is checked before it is read.
test("a known kind with a payload this build cannot read changes nothing", () => {
  const before = fold([
    { kind: "state", turn: 3, running: true, reason: "opened" },
    { kind: "level", turn: 3, value: 0.5 },
    { kind: "speech-end", turn: 3, text: "说过的话", silentMs: 1250 },
  ]);
  const broken = [
    { kind: "speech-end", turn: 3 },
    { kind: "final", turn: 3 },
    { kind: "level", turn: 3 },
    { kind: "state", turn: 3 },
    { kind: "speech-stop", turn: 3 },
    { kind: "level", turn: 3, value: "loud" },
    { kind: "state", turn: 3, running: "yes", reason: "opened" },
  ];
  for (const e of broken) {
    const after = applyConversationEvent(before, e as unknown as ConversationEvent);
    expect(after.level).toBe(0.5);
    expect(after.heard).toBe("说过的话");
    expect(after.running).toBe(true);
    // Declared `SpeechCut | null`, and a view that draws the orb from `level`
    // would otherwise be computing with undefined.
    expect(after.cut === null || typeof after.cut === "object").toBe(true);
    expect(Number.isFinite(after.level)).toBe(true);
  }
});

// A stop without a position is still a stop: the duck it came out of is over,
// and only the position is lost.
test("a stop with no position still ends the duck", () => {
  const after = fold([
    { kind: "state", turn: 1, running: true, reason: "opened" },
    { kind: "speech-duck", turn: 1 },
    { kind: "speech-stop", turn: 1 } as unknown as ConversationEvent,
  ]);
  expect(after.ducked).toBe(false);
  expect(after.cut).toBeNull();
});
