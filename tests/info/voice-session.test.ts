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
  expect(reply?.text).toBe(`英伟达涨了 3.5%\n${INTERRUPTED_MARK}`);
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
