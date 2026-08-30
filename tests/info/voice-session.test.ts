// The full-duplex call, driven end to end on a machine with no plugin, no
// microphone and no key: a fake bridge under the native binding, a fake model
// stream over it, and the orchestrator between them (docs/45, docs/33
// M-voice-3).
//
// The two rules the project owner settled are what most of this file is about:
// a duck costs volume and nothing else, and what a barge-in leaves in the
// transcript is the model's own text cut at a sentence boundary.
//
// Run: bun test tests/info/voice-session.test.ts

import { expect, test } from "bun:test";
import {
  createNativeConversation,
  type ConversationBridge,
  type ConversationEvent,
  type ConversationSource,
} from "../../src/info/companion/conversation";
import {
  INTERRUPTED_MARK,
  createVoiceSession,
  type SessionEffect,
  type VoiceSession,
  type VoiceTurn,
} from "../../src/info/companion/voice-session";

// A reply with a boundary in the middle of it. The splitter can only freeze text
// that has something after the boundary, so a sentence goes out mid-stream only
// once the next one has started; the last one waits for the model to finish.
const REPLY = "好的，今天有三条要闻，第一条是这个。第二条明天再说。";
const CUT = { utterance: 1, sentence: 1, charOffset: 4, playedMs: 2100 };

interface Call {
  command: string;
  args?: Record<string, unknown>;
}

// The native side, faked: it records what was invoked and hands back an
// utterance number for speak_begin, which is all the orchestrator's effects ask
// of it.
function fakeCall(): { source: ConversationSource; calls: Call[] } {
  const calls: Call[] = [];
  const bridge: ConversationBridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      calls.push({ command, args });
      if (command === "plugin:voice|speak_begin") return 1 as T;
      if (command === "plugin:voice|speak_stop") {
        return { utterance: 0, sentence: 0, positionMs: 0, durationMs: 0 } as T;
      }
      return undefined as T;
    },
    async subscribe() {
      return { async unregister() {} };
    },
  };
  return { source: createNativeConversation({}, bridge), calls };
}

// The caller's half: perform the effects the machine hands back, in order, and
// keep the transcript the same way a thread would.
class Harness {
  readonly effects: SessionEffect[] = [];
  readonly transcript: VoiceTurn[] = [];
  readonly calls: Call[];
  private readonly call: ConversationSource;
  private aborted = new Set<number>();

  constructor(readonly session: VoiceSession = createVoiceSession()) {
    const fake = fakeCall();
    this.call = fake.source;
    this.calls = fake.calls;
  }

  private async perform(effects: SessionEffect[]): Promise<void> {
    this.effects.push(...effects);
    for (const e of effects) {
      switch (e.type) {
        case "speak-begin":
          await this.call.speakBegin();
          break;
        case "speak-push":
          await this.call.speakPush(e.text);
          break;
        case "speak-close":
          await this.call.speakClose();
          break;
        case "speak-stop":
          await this.call.speakStop();
          break;
        case "volume":
          await this.call.setVolume(e.value);
          break;
        case "abort":
          this.aborted.add(e.turn);
          break;
        case "record": {
          // Keyed by turn and role: a late final replaces what it repairs.
          const at = this.transcript.findIndex(
            (t) => t.turn === e.entry.turn && t.role === e.entry.role,
          );
          if (at >= 0) this.transcript[at] = e.entry;
          else this.transcript.push(e.entry);
          break;
        }
        default:
          break;
      }
    }
  }

  async event(e: ConversationEvent): Promise<void> {
    await this.perform(this.session.event(e));
  }

  async delta(turn: number, chunk: string): Promise<void> {
    await this.perform(this.session.delta(turn, chunk));
  }

  async done(turn: number): Promise<void> {
    await this.perform(this.session.done(turn));
  }

  async failed(turn: number): Promise<void> {
    await this.perform(this.session.failed(turn));
  }

  /** What `speak_stop` answered, fed back the way a caller has to. */
  async stopped(turn: number, sentence: number): Promise<void> {
    await this.perform(
      this.session.stopped(turn, { utterance: 1, sentence, positionMs: 0, durationMs: 0 }),
    );
  }

  ai(turn: number): VoiceTurn | undefined {
    return this.transcript.find((t) => t.turn === turn && t.role === "ai");
  }

  /** The model streams its answer in chunks of `size`. */
  async stream(turn: number, text: string, size = 3): Promise<void> {
    for (let i = 0; i < text.length; i += size) await this.delta(turn, text.slice(i, i + size));
  }

  of<T extends SessionEffect["type"]>(type: T): Extract<SessionEffect, { type: T }>[] {
    return this.effects.filter((e) => e.type === type) as Extract<SessionEffect, { type: T }>[];
  }

  types(): string[] {
    return this.effects.map((e) => e.type);
  }

  wasAborted(turn: number): boolean {
    return this.aborted.has(turn);
  }

  async open(): Promise<void> {
    await this.event({ kind: "state", turn: 0, running: true, reason: "opened" });
  }

  async userSaid(turn: number, text: string): Promise<void> {
    await this.event({ kind: "speech-end", turn, text, silentMs: 1250 });
  }
}

function lastVolume(h: Harness): SessionEffect | undefined {
  const all = h.of("volume");
  return all[all.length - 1];
}

// --- a whole turn -----------------------------------------------------------

test("a turn runs from the user's silence to the last sentence spoken", async () => {
  const h = new Harness();
  await h.open();
  expect(h.session.snapshot().phase).toBe("listening");

  await h.userSaid(1, "今天有什么");
  expect(h.of("ask")).toEqual([{ type: "ask", turn: 1, text: "今天有什么" }]);
  expect(h.session.snapshot().phase).toBe("thinking");

  await h.stream(1, REPLY);
  await h.done(1);

  expect(h.calls.map((c) => c.command)).toEqual([
    "plugin:voice|speak_begin",
    "plugin:voice|speak_push",
    "plugin:voice|speak_push",
    "plugin:voice|speak_push",
    "plugin:voice|speak_close",
  ]);
  expect(h.calls.filter((c) => c.args?.text).map((c) => c.args?.text)).toEqual([
    "好的，",
    "今天有三条要闻，第一条是这个。",
    "第二条明天再说。",
  ]);
  expect(h.session.snapshot().phase).toBe("speaking");

  await h.event({ kind: "spoken", turn: 1, utterance: 1, reason: "done" });
  expect(h.session.snapshot().phase).toBe("listening");
  expect(h.transcript).toEqual([
    { role: "user", turn: 1, text: "今天有什么", interrupted: false },
    { role: "ai", turn: 1, text: REPLY, interrupted: false },
  ]);
});

test("the first sentence of a turn is cut at the first soft boundary", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");

  // Nothing can be frozen while the boundary is still the last character.
  await h.delta(1, "好的，今天有三条要闻。");
  expect(h.of("speak-push")).toEqual([]);

  // The next character frees it, and the turn's first sentence is the comma's,
  // not twelve characters' worth.
  await h.delta(1, "第");
  expect(h.of("speak-push")).toEqual([
    { type: "speak-push", turn: 1, text: "好的，" },
    { type: "speak-push", turn: 1, text: "今天有三条要闻。" },
  ]);
  expect(h.session.snapshot().phase).toBe("speaking");
});

test("speak_begin is sent once, before the first sentence and not before that", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  expect(h.types()).not.toContain("speak-begin");

  await h.stream(1, REPLY);
  await h.done(1);
  expect(h.types().filter((t) => t === "speak-begin")).toHaveLength(1);
  expect(h.types().indexOf("speak-begin")).toBeLessThan(h.types().indexOf("speak-push"));
});

test("a reply with nothing in it never opens a turn of speech", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.done(1);

  expect(h.calls).toEqual([]);
  expect(h.session.snapshot().phase).toBe("listening");
});

// --- the two stages ---------------------------------------------------------

test("a duck lowers the volume and touches nothing else", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);

  const before = h.effects.length;
  await h.event({ kind: "speech-duck", turn: 2 });
  const after = h.effects.slice(before);

  expect(after).toEqual([{ type: "volume", value: 0.25 }]);
  expect(h.wasAborted(1)).toBe(false);
  expect(h.session.snapshot().asked).toBe(1);
  expect(h.session.snapshot().phase).toBe("speaking");
  expect(h.calls.map((c) => c.command)).not.toContain("plugin:voice|speak_stop");
});

test("a resume puts the volume back and undoes nothing", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "speech-duck", turn: 2 });
  await h.event({ kind: "speech-resume", turn: 2 });

  expect(h.of("volume")).toEqual([
    { type: "volume", value: 0.25 },
    { type: "volume", value: 1 },
  ]);
  expect(h.wasAborted(1)).toBe(false);
  expect(h.calls.map((c) => c.command)).not.toContain("plugin:voice|speak_stop");

  // The model was never cut off, so the rest of the answer is still spoken.
  await h.stream(1, "还有第三条。");
  await h.done(1);
  expect(h.calls.filter((c) => c.args?.text).map((c) => c.args?.text)).toEqual([
    "好的，",
    "今天有三条要闻，第一条是这个。",
    "第二条明天再说。",
    "还有第三条。",
  ]);
  expect(h.calls.map((c) => c.command)).toContain("plugin:voice|speak_close");
});

test("only a confirmed stop aborts the model and cuts the speech", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);

  await h.event({ kind: "speech-duck", turn: 2 });
  await h.event({ kind: "speech-stop", turn: 2, cut: CUT });

  expect(h.wasAborted(1)).toBe(true);
  expect(h.calls.map((c) => c.command)).toContain("plugin:voice|speak_stop");
  const volumes = h.of("volume");
  expect(volumes[volumes.length - 1]).toEqual({ type: "volume", value: 1 });
  expect(h.session.snapshot().phase).toBe("listening");
  expect(h.session.snapshot().asked).toBe(null);
});

test("what the transcript keeps is the raw text, cut at the sentence boundary", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "speech-duck", turn: 2 });
  await h.event({ kind: "speech-stop", turn: 2, cut: CUT });

  const reply = h.transcript.find((t) => t.role === "ai");
  expect(reply).toEqual({
    role: "ai",
    turn: 1,
    // The sentence the user cut into is kept whole, and the line after it says
    // it was only half said.
    text: `好的，今天有三条要闻，第一条是这个。\n${INTERRUPTED_MARK}`,
    interrupted: true,
  });
});

test("the transcript keeps what the model wrote, not what the reader was handed", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "涨了多少");
  await h.stream(1, "英伟达涨了 3.5%；分析师说这是 2026 年以来最大的一次。");
  await h.event({ kind: "speech-stop", turn: 2, cut: { ...CUT, sentence: 0 } });

  const reply = h.transcript.find((t) => t.role === "ai");
  // "百分之三点五" is what was synthesised; "3.5%" is what is kept.
  expect(h.calls.find((c) => c.args?.text)?.args?.text).toBe("英伟达涨了百分之三点五；");
  expect(reply?.text).toBe(`英伟达涨了 3.5%；\n${INTERRUPTED_MARK}`);
});

test("a stop before a word was spoken leaves no reply in the transcript", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.delta(1, "好的");
  await h.event({ kind: "speech-stop", turn: 2, cut: { ...CUT, sentence: 0 } });

  expect(h.wasAborted(1)).toBe(true);
  expect(h.transcript.filter((t) => t.role === "ai")).toEqual([]);
  // Nothing was ducked and no turn of speech was ever opened, so the native side
  // is asked for nothing at all.
  expect(h.calls).toEqual([]);
});

test("deltas that land after the abort are dropped", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "speech-stop", turn: 2, cut: CUT });

  const before = h.calls.length;
  await h.delta(1, "还有第四条。");
  await h.done(1);
  expect(h.calls.length).toBe(before);
});

test("the next turn starts clean after a barge-in", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "speech-stop", turn: 2, cut: CUT });
  await h.userSaid(2, "第二个问题");

  const asks = h.of("ask");
  expect(asks[asks.length - 1]).toEqual({ type: "ask", turn: 2, text: "第二个问题" });
  expect(h.session.snapshot().asked).toBe(2);
  expect(h.session.snapshot().spoken).toBe(0);

  await h.stream(2, "第二个回答。");
  await h.done(2);
  const reply = h.transcript.find((t) => t.turn === 2 && t.role === "ai");
  await h.event({ kind: "spoken", turn: 2, utterance: 2, reason: "done" });
  expect(reply).toBeUndefined();
  expect(h.transcript.filter((t) => t.role === "ai").map((t) => t.turn)).toEqual([1, 2]);
});

// --- the late result --------------------------------------------------------

test("a final that settles after the turn was sent repairs the message", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.event({
    kind: "final",
    turn: 1,
    text: "值得读的",
    range: { startMs: 0, endMs: 900 },
  });

  expect(h.transcript).toEqual([
    { role: "user", turn: 1, text: "今天有什么值得读的", interrupted: false },
  ]);
  // Repairing the transcript is all it does: the model is already answering.
  expect(h.of("ask")).toHaveLength(1);
});

test("a final for a turn that was never asked changes nothing", async () => {
  const h = new Harness();
  await h.open();
  await h.event({ kind: "final", turn: 7, text: "无主的一句", range: { startMs: 0, endMs: 10 } });
  expect(h.transcript).toEqual([]);
});

// --- the call itself --------------------------------------------------------

test("a call that goes away takes the turn in flight with it", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "state", turn: 1, running: false, reason: "lost" });

  expect(h.wasAborted(1)).toBe(true);
  expect(h.calls.map((c) => c.command)).toContain("plugin:voice|speak_stop");
  expect(h.session.snapshot().phase).toBe("idle");
  expect(h.transcript.find((t) => t.role === "ai")?.interrupted).toBe(true);
});

test("a level event asks for nothing", async () => {
  const h = new Harness();
  await h.open();
  const before = h.effects.length;
  await h.event({ kind: "level", turn: 1, value: 0.7 });
  expect(h.effects.length).toBe(before);
});

test("a kind this build has never heard of asks for nothing", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  const before = h.effects.length;
  await h.event({ kind: "vad-hint", turn: 2, probability: 0.9 } as unknown as ConversationEvent);
  expect(h.effects.length).toBe(before);
  expect(h.session.snapshot().phase).toBe("speaking");
});

// --- what the transcript is allowed to claim ---------------------------------

// The model wrote four sentences and the user cut in on the second. What goes in
// the transcript is the first two. The third and fourth were never played, and a
// source map that lost its footing on a clause opening with a bracket used to
// hand them over as if they had been.
test("a sentence that was never played does not enter the transcript", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "怎么回事");
  await h.stream(1, "结论。（补充）原文说的是另一回事。所以要小心。明天再说。");
  await h.event({ kind: "speech-stop", turn: 2, cut: { ...CUT, sentence: 1 } });

  const kept = h.ai(1)?.text ?? "";
  expect(kept).toContain("结论。");
  expect(kept).toContain("原文说的是另一回事。");
  expect(kept).not.toContain("所以要小心");
  expect(kept).not.toContain("明天再说");
});

// The model was still writing its first sentence when the user spoke again.
// Nothing reached the synthesiser, so nothing was heard, so there is no reply.
test("a draft nobody heard a word of is not stored as a reply", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.delta(1, "今天有三条消息");
  expect(h.session.snapshot().spoken).toBe(0);

  await h.userSaid(2, "算了");
  expect(h.ai(1)).toBeUndefined();
  expect(h.of("record").some((r) => r.entry.role === "ai")).toBe(false);
});

test("a call that drops mid-draft stores no reply either", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.delta(1, "半句话还没说完");
  await h.event({ kind: "state", turn: 1, running: false, reason: "lost" });
  expect(h.ai(1)).toBeUndefined();
});

// The stream arrives faster than the speaker can say it, so the sentence count
// is not the playhead. With no event to witness the stop the machine can only
// guess the last sentence it handed over; `stopped` is how the guess is
// corrected, and the corrected entry replaces the guessed one.
test("the player's own answer corrects a cut that had to guess", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "说五句");
  await h.delta(1, "第一句。第二句。第三句。第四句。第五句。");
  expect(h.session.snapshot().spoken).toBe(4);

  await h.userSaid(2, "停");
  expect(h.ai(1)?.text).toBe(`第一句。第二句。第三句。第四句。\n${INTERRUPTED_MARK}`);

  await h.stopped(1, 0);
  expect(h.ai(1)?.text).toBe(`第一句。\n${INTERRUPTED_MARK}`);
  expect(h.ai(1)?.interrupted).toBe(true);
});

test("a stop the event already witnessed is not second-guessed", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "说五句");
  await h.delta(1, "第一句。第二句。第三句。第四句。第五句。");
  await h.event({ kind: "speech-stop", turn: 2, cut: { ...CUT, sentence: 2 } });
  const witnessed = h.ai(1)?.text;

  await h.stopped(1, 0);
  expect(h.ai(1)?.text).toBe(witnessed);
});

// The recognizer had nothing at the moment the hangover expired and settled a
// second later. That final is the whole of the user's turn, and the only chance
// it has of being answered.
test("a turn the recognizer settled late is still asked", async () => {
  const h = new Harness();
  await h.open();
  await h.event({ kind: "speech-end", turn: 1, text: "", silentMs: 700 });
  expect(h.of("ask")).toEqual([]);

  await h.event({
    kind: "final",
    turn: 1,
    text: "帮我看看今天的新闻",
    range: { startMs: 0, endMs: 900 },
  });
  expect(h.of("ask")).toEqual([{ type: "ask", turn: 1, text: "帮我看看今天的新闻" }]);
  expect(h.transcript.find((t) => t.role === "user")?.text).toBe("帮我看看今天的新闻");
  expect(h.session.snapshot().phase).toBe("thinking");
});

test("a late final for a turn that was already asked only repairs it", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "帮我看看");
  await h.event({ kind: "final", turn: 1, text: "今天的新闻", range: { startMs: 0, endMs: 900 } });
  expect(h.of("ask")).toEqual([{ type: "ask", turn: 1, text: "帮我看看" }]);
  expect(h.transcript.find((t) => t.role === "user")?.text).toBe("帮我看看今天的新闻");
});

// --- the volume the player is left on ----------------------------------------

test("a call that drops while ducked puts the volume back first", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "speech-duck", turn: 2 });
  expect(lastVolume(h)).toEqual({ type: "volume", value: 0.25 });

  await h.event({ kind: "state", turn: 2, running: false, reason: "lost" });
  expect(lastVolume(h)).toEqual({ type: "volume", value: 1 });
  expect(h.session.snapshot().ducked).toBe(false);
});

test("the duck volume is a parameter", async () => {
  const h = new Harness(createVoiceSession({ duckVolume: 0.4 }));
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "speech-duck", turn: 2 });
  expect(lastVolume(h)).toEqual({ type: "volume", value: 0.4 });
});

// --- a model turn that ended early -------------------------------------------

// "第二" never became a sentence and never reached the synthesiser, so it was
// never said. The reply stops at the sentence that was, and is not marked
// half-said: it ends on a boundary, it is only short.
test("a failed model turn keeps only what reached the synthesiser", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "说点什么");
  await h.delta(1, "第一句。第二");
  await h.failed(1);
  await h.event({ kind: "spoken", turn: 1, utterance: 1, reason: "done" });

  expect(h.ai(1)?.text).toBe("第一句。");
  expect(h.ai(1)?.interrupted).toBe(false);
  expect(h.session.snapshot().phase).toBe("listening");
});

// --- who says a turn of speech is over ---------------------------------------

// The relay marks a sentence `last` only once nothing is pending, in flight or
// ready. A sentence whose synthesis failed never becomes ready, so a turn that
// loses its final sentence never marks one and the player reports `underrun` —
// the same event a starved queue sends. Waiting for one that says `done` would
// hold the floor for the rest of the call.
test("a turn that ends on underrun still hands the floor back", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.done(1);
  await h.event({ kind: "spoken", turn: 1, utterance: 1, reason: "underrun" });

  expect(h.session.snapshot().phase).toBe("listening");
  expect(h.ai(1)?.text).toBe(REPLY);
});

// A queue that ran dry with the model still writing is a gap in the audio, not
// the end of a turn: the next sentence is on its way.
test("a queue that runs dry mid-stream does not end the turn", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.delta(1, "第一句。第二");
  await h.event({ kind: "spoken", turn: 1, utterance: 1, reason: "underrun" });
  expect(h.session.snapshot().phase).toBe("speaking");

  await h.delta(1, "句。第三句。");
  await h.done(1);
  expect(h.session.snapshot().phase).toBe("speaking");
  await h.event({ kind: "spoken", turn: 1, utterance: 1, reason: "done" });
  expect(h.session.snapshot().phase).toBe("listening");
});

// Unless nothing follows it. The model turn ended with nothing left to hand
// over, so the silence the player already reported was the end of the speech,
// and no second one is coming to say so.
test("a turn whose tail never arrives does not hold the floor", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.delta(1, "第一句。第二");
  await h.event({ kind: "spoken", turn: 1, utterance: 1, reason: "underrun" });
  await h.failed(1);

  expect(h.session.snapshot().phase).toBe("listening");
  expect(h.ai(1)?.text).toBe("第一句。");
});

// --- a payload that is not what its kind promises -----------------------------

// The reason this event is not a fifth `dictation` kind: a native build can
// change a payload, and the webview must not throw inside the microphone's own
// callback. A default branch alone does not do that — every one of these
// carries a kind this build knows.
test("an event missing what its kind promises is ignored, not thrown on", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  const before = h.effects.length;

  const broken = [
    { kind: "speech-end", turn: 1 },
    { kind: "final", turn: 1 },
    { kind: "level", turn: 1 },
    { kind: "state", turn: 1 },
    { kind: "speech-end", turn: 1, text: null },
    { kind: "final", turn: 1, text: 7 },
  ];
  for (const e of broken) await h.event(e as unknown as ConversationEvent);

  // Nothing asked for, and the companion is still talking: a field that was not
  // there is not grounds for tearing a live turn down.
  expect(h.effects.length).toBe(before);
  expect(h.session.snapshot().phase).toBe("speaking");
});

// An empty string is not a broken payload. It is the recognizer having nothing
// at the moment the hangover expired, which is a turn like any other.
test("a speech-end with an empty string is a turn, not a broken payload", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.userSaid(2, "");

  expect(h.session.snapshot().phase).toBe("listening");
  expect(h.ai(1)?.interrupted).toBe(true);
});

// A stop with no position is still a stop: the user is talking over the
// companion whether or not the payload said where the playhead was.
test("a stop with no position still stops", async () => {
  const h = new Harness();
  await h.open();
  await h.userSaid(1, "今天有什么");
  await h.stream(1, REPLY);
  await h.event({ kind: "speech-stop", turn: 2 } as unknown as ConversationEvent);

  expect(h.session.snapshot().phase).toBe("listening");
  expect(h.ai(1)?.interrupted).toBe(true);
  expect(h.wasAborted(1)).toBe(true);
});
