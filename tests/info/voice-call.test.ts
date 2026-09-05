// The driver behind the full-duplex call: the state machine bound to a native
// bridge, a model turn and a transcript, all three faked (docs/45, docs/33
// M-voice-3). What voice-session.test.ts holds down is what the machine
// decides; what this holds down is that the effects reach the right port, in
// order, and that the pieces the driver adds on top — the opening turn, the
// abortable model round, the level callback, the endings — behave.
//
// Run: bun test tests/info/voice-call.test.ts

import { expect, test } from "bun:test";
import { VOICE_OPENING_KICKOFF } from "../../src/info/companion/call";
import type {
  ConversationEvent,
  ConversationSource,
  SpeechStopped,
} from "../../src/info/companion/conversation";
import {
  KICKOFF_TURN,
  createVoiceCall,
  type VoiceCall,
  type VoiceCallModel,
  type VoiceCallTranscript,
} from "../../src/info/companion/voice-call";
import { INTERRUPTED_MARK, type VoiceTurn } from "../../src/info/companion/voice-session";

// Three sentences as the splitter cuts them (a fullwidth comma is a boundary),
// so two go out mid-stream and the last waits for the model to finish.
const S0 = "好的，";
const S1 = "今天有三条要闻，第一条是这个。";
const S2 = "第二条明天再说。";
const REPLY = S0 + S1 + S2;

interface Call {
  command: string;
  args?: Record<string, unknown>;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class Harness {
  readonly calls: Call[] = [];
  readonly asked: { turn: number; text: string }[] = [];
  readonly transcript: VoiceTurn[] = [];
  readonly levels: number[] = [];
  readonly epochs: number[] = [];
  readonly call: VoiceCall;

  private listener: ((e: ConversationEvent) => void) | null = null;
  private startError: Error | null = null;
  private stopAnswer: SpeechStopped = { utterance: 1, sentence: 0, positionMs: 0, durationMs: 0 };
  private runs = new Map<
    number,
    { onDelta: (c: string) => void; settle: (e?: Error) => void; signal: AbortSignal }
  >();

  constructor() {
    const bridge: ConversationSource = {
      start: async (onEvent) => {
        this.calls.push({ command: "start" });
        if (this.startError) throw this.startError;
        this.listener = onEvent;
      },
      stop: async () => {
        this.calls.push({ command: "stop" });
        this.listener = null;
      },
      setVolume: async (value) => {
        this.calls.push({ command: "volume", args: { value } });
      },
      speakBegin: async () => {
        this.calls.push({ command: "speak_begin" });
        return 7;
      },
      speakPush: async (text) => {
        this.calls.push({ command: "speak_push", args: { text } });
      },
      speakClose: async () => {
        this.calls.push({ command: "speak_close" });
      },
      speakStop: async () => {
        this.calls.push({ command: "speak_stop" });
        return this.stopAnswer;
      },
    };

    const model: VoiceCallModel = {
      ask: ({ turn, text, onDelta, signal }) => {
        this.asked.push({ turn, text });
        return new Promise<void>((resolve, reject) => {
          this.runs.set(turn, {
            onDelta,
            signal,
            settle: (e) => (e ? reject(e) : resolve()),
          });
        });
      },
    };

    const transcript: VoiceCallTranscript = {
      begin: () => {
        this.epochs.push(this.transcript.length);
      },
      record: (entry) => {
        const at = this.transcript.findIndex(
          (t) => t.turn === entry.turn && t.role === entry.role,
        );
        if (at >= 0) this.transcript[at] = entry;
        else this.transcript.push(entry);
      },
    };

    this.call = createVoiceCall({ bridge, model, transcript });
    this.call.subscribeLevel((v) => this.levels.push(v));
  }

  failStart(e: Error): void {
    this.startError = e;
  }

  answerStopAt(sentence: number): void {
    this.stopAnswer = { utterance: 1, sentence, positionMs: 0, durationMs: 0 };
  }

  get subscribed(): boolean {
    return this.listener !== null;
  }

  aborted(turn: number): boolean {
    return this.runs.get(turn)?.signal.aborted ?? false;
  }

  async emit(e: ConversationEvent): Promise<void> {
    this.listener?.(e);
    await this.settle();
  }

  async settle(): Promise<void> {
    await flush();
    await this.call.settled();
  }

  /** Open the call the way the native side does, greeting and all. */
  async open(): Promise<void> {
    await this.call.start();
    await this.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  }

  async userSaid(turn: number, text: string): Promise<void> {
    await this.emit({ kind: "speech-end", turn, text, silentMs: 1250 });
  }

  async stream(turn: number, text: string, size = 4): Promise<void> {
    const run = this.runs.get(turn);
    if (!run) throw new Error(`no model turn ${turn}`);
    for (let i = 0; i < text.length; i += size) run.onDelta(text.slice(i, i + size));
    await this.settle();
  }

  async finish(turn: number): Promise<void> {
    this.runs.get(turn)?.settle();
    await this.settle();
  }

  async fail(turn: number, message = "the model fell over"): Promise<void> {
    this.runs.get(turn)?.settle(new Error(message));
    await this.settle();
  }

  commands(name: string): Call[] {
    return this.calls.filter((c) => c.command === name);
  }

  pushed(): string[] {
    return this.commands("speak_push").map((c) => String(c.args?.text ?? ""));
  }

  entry(turn: number, role: "user" | "ai"): VoiceTurn | undefined {
    return this.transcript.find((t) => t.turn === turn && t.role === role);
  }
}

// --- the opening line -------------------------------------------------------

test("the call opens with a spoken greeting nobody asked for out loud", async () => {
  const h = new Harness();
  await h.open();

  // Asked as turn 0 with the kickoff note, once the native side said the call
  // is up — not on start(), where the `running: true` that follows would put
  // the orb back to listening on top of the greeting's thinking.
  expect(h.asked).toEqual([{ turn: KICKOFF_TURN, text: VOICE_OPENING_KICKOFF }]);
  expect(h.call.snapshot().phase).toBe("thinking");

  await h.stream(KICKOFF_TURN, REPLY);
  await h.finish(KICKOFF_TURN);

  // Spoken through the same speak_* path as any other reply.
  expect(h.pushed()).toEqual([S0, S1, S2]);
  expect(h.commands("speak_begin")).toHaveLength(1);
  expect(h.commands("speak_close")).toHaveLength(1);
  expect(h.call.snapshot().utterance).toBe(7);

  // The note is the driver's sentence, not the reader's: it is never written
  // down. What the companion said is, once the player has said it.
  await h.emit({ kind: "spoken", turn: 0, utterance: 7, reason: "done" });
  expect(h.entry(KICKOFF_TURN, "user")).toBeUndefined();
  expect(h.entry(KICKOFF_TURN, "ai")?.text).toBe(REPLY);
});

test("the greeting is kicked once, however many state events arrive", async () => {
  const h = new Harness();
  await h.open();
  await h.emit({ kind: "state", turn: 0, running: true, reason: "opened" });
  expect(h.asked).toHaveLength(1);
});

// --- a user's turn ----------------------------------------------------------

test("a user turn is recorded, asked, spoken sentence by sentence and closed", async () => {
  const h = new Harness();
  await h.open();
  await h.finish(KICKOFF_TURN); // the greeting said nothing; the floor goes back

  await h.userSaid(1, "今天有什么");
  expect(h.entry(1, "user")?.text).toBe("今天有什么");
  expect(h.asked[1]).toEqual({ turn: 1, text: "今天有什么" });
  expect(h.call.snapshot().phase).toBe("thinking");

  // The first sentence goes out while the model is still writing the second.
  await h.stream(1, S0 + S1 + "第二条");
  expect(h.pushed()).toEqual([S0, S1]);
  expect(h.call.snapshot().phase).toBe("speaking");

  await h.stream(1, "明天再说。");
  await h.finish(1);
  expect(h.pushed()).toEqual([S0, S1, S2]);
  expect(h.commands("speak_close")).toHaveLength(1);

  // The player runs out with the turn closed: that was the end of the speech.
  await h.emit({ kind: "spoken", turn: 1, utterance: 7, reason: "done" });
  expect(h.call.snapshot().phase).toBe("listening");
  expect(h.entry(1, "ai")).toEqual({ role: "ai", turn: 1, text: REPLY, interrupted: false });
});

// --- barge-in ---------------------------------------------------------------

test("a duck costs volume and nothing else", async () => {
  const h = new Harness();
  await h.open();
  await h.stream(KICKOFF_TURN, REPLY);

  await h.emit({ kind: "speech-duck", turn: 1 });
  expect(h.commands("volume").map((c) => c.args?.value)).toEqual([0.25]);
  expect(h.commands("speak_stop")).toHaveLength(0);
  expect(h.aborted(KICKOFF_TURN)).toBe(false);

  await h.emit({ kind: "speech-resume", turn: 1 });
  expect(h.commands("volume").map((c) => c.args?.value)).toEqual([0.25, 1]);
  expect(h.aborted(KICKOFF_TURN)).toBe(false);
});

test("a confirmed barge-in aborts the model, stops the player and marks the reply", async () => {
  const h = new Harness();
  await h.open();
  await h.stream(KICKOFF_TURN, REPLY); // one sentence handed over, one pending

  await h.emit({ kind: "speech-duck", turn: 1 });
  await h.emit({
    kind: "speech-stop",
    turn: 1,
    cut: { utterance: 7, sentence: 0, charOffset: 4, playedMs: 900 },
  });

  expect(h.aborted(KICKOFF_TURN)).toBe(true);
  expect(h.commands("speak_stop")).toHaveLength(1);
  expect(h.entry(KICKOFF_TURN, "ai")?.text).toBe(`${S0}\n${INTERRUPTED_MARK}`);
  expect(h.entry(KICKOFF_TURN, "ai")?.interrupted).toBe(true);
  // The duck that led here is over, so the next turn does not open quiet.
  expect(h.commands("volume").map((c) => c.args?.value)).toEqual([0.25, 1]);
  expect(h.call.snapshot().phase).toBe("listening");

  // Late deltas from the stream that was already in the air change nothing.
  const before = h.pushed().length;
  await h.stream(KICKOFF_TURN, "还有第三条。");
  expect(h.pushed()).toHaveLength(before);
});

test("what speak_stop answers replaces the entry the unwitnessed cut guessed", async () => {
  const h = new Harness();
  h.answerStopAt(0); // the player only ever got through the first sentence
  await h.open();
  await h.stream(KICKOFF_TURN, REPLY);
  await h.finish(KICKOFF_TURN); // both sentences handed over, turn closed

  // The user talks with no barge-in ever confirmed: nobody says where the
  // playhead was, so the reply is cut at the last sentence handed over and
  // corrected when the player answers.
  await h.userSaid(1, "等一下");
  expect(h.entry(KICKOFF_TURN, "ai")?.text).toBe(`${S0}\n${INTERRUPTED_MARK}`);
  expect(h.commands("speak_stop")).toHaveLength(1);
});

// --- the model falls over ---------------------------------------------------

test("a failed turn keeps what was handed over and gives the floor back", async () => {
  const h = new Harness();
  await h.open();
  await h.stream(KICKOFF_TURN, S0 + S1 + "第二条");
  await h.fail(KICKOFF_TURN);

  // What reached the synthesiser is worth hearing, so the turn is closed rather
  // than stopped, and the transcript stops there without being marked.
  expect(h.commands("speak_close")).toHaveLength(1);
  expect(h.commands("speak_stop")).toHaveLength(0);
  await h.emit({ kind: "spoken", turn: 0, utterance: 7, reason: "done" });
  expect(h.entry(KICKOFF_TURN, "ai")).toEqual({
    role: "ai",
    turn: KICKOFF_TURN,
    text: S0 + S1,
    interrupted: false,
  });
  expect(h.call.snapshot().phase).toBe("listening");
});

test("a turn that failed before a word was spoken leaves nothing behind", async () => {
  const h = new Harness();
  await h.open();
  await h.fail(KICKOFF_TURN);
  expect(h.commands("speak_begin")).toHaveLength(0);
  expect(h.transcript).toHaveLength(0);
  expect(h.call.snapshot().phase).toBe("listening");
});

// --- endings ----------------------------------------------------------------

test("stop hangs up: the model is aborted, the player stopped, the call closed", async () => {
  const h = new Harness();
  await h.open();
  await h.stream(KICKOFF_TURN, REPLY);

  await h.call.stop();
  expect(h.aborted(KICKOFF_TURN)).toBe(true);
  // speak_stop while the call is still up, then the call.
  expect(h.calls.map((c) => c.command).slice(-2)).toEqual(["speak_stop", "stop"]);
  expect(h.subscribed).toBe(false);
  expect(h.call.snapshot().phase).toBe("idle");
  expect(h.call.snapshot().error).toBeNull();
  // What the user did hear is kept rather than lost.
  expect(h.entry(KICKOFF_TURN, "ai")?.interrupted).toBe(true);
});

test("a call that went away ends and says why", async () => {
  const h = new Harness();
  const seen: (string | null)[] = [];
  h.call.subscribeError((e) => seen.push(e?.reason ?? null));
  await h.open();
  await h.stream(KICKOFF_TURN, REPLY);

  await h.emit({ kind: "state", turn: 1, running: false, reason: "interrupted" });

  expect(h.call.snapshot().running).toBe(false);
  expect(h.call.snapshot().phase).toBe("idle");
  expect(h.call.snapshot().error?.reason).toBe("interrupted");
  expect(h.call.snapshot().error?.message).toContain("Tap to start it again");
  expect(seen).toEqual([null, "interrupted"]);
  // The listener goes with it: a second call must not get every event twice.
  expect(h.subscribed).toBe(false);
  expect(h.aborted(KICKOFF_TURN)).toBe(true);
  expect(h.levels[h.levels.length - 1]).toBe(0);
});

test("a call closed on purpose is not an error", async () => {
  const h = new Harness();
  await h.open();
  await h.emit({ kind: "state", turn: 1, running: false, reason: "closed" });
  expect(h.call.snapshot().error).toBeNull();
  expect(h.call.snapshot().phase).toBe("idle");
});

test("a start the plugin refuses is reported and leaves nothing running", async () => {
  const h = new Harness();
  h.failStart(new Error("the microphone is busy"));
  await h.call.start();
  expect(h.call.snapshot().running).toBe(false);
  expect(h.call.snapshot().error).toEqual({
    reason: "start-failed",
    message: "the microphone is busy",
  });
  expect(h.asked).toHaveLength(0);
});

// --- the orb's two streams --------------------------------------------------

test("levels reach the callback as they arrive, off the effect queue", async () => {
  const h = new Harness();
  await h.open();
  const off = h.call.subscribeLevel((v) => h.levels.push(-v));

  // Synchronous: nothing is awaited between the event and the callback, which
  // is what lets the orb read it on an animation frame.
  h.emit({ kind: "level", turn: 1, value: 0.4 });
  expect(h.levels.slice(-2)).toEqual([0.4, -0.4]);

  h.emit({ kind: "level", turn: 1, value: Number.NaN });
  expect(h.levels.slice(-2)).toEqual([0.4, -0.4]);

  off();
  h.emit({ kind: "level", turn: 1, value: 0.6 });
  expect(h.levels[h.levels.length - 1]).toBe(0.6);
  await h.settle();
});

test("the phase listener sees the call move", async () => {
  const h = new Harness();
  const phases: string[] = [];
  h.call.subscribePhase((p) => phases.push(p));
  await h.open();
  await h.stream(KICKOFF_TURN, REPLY);
  await h.finish(KICKOFF_TURN);
  await h.emit({ kind: "spoken", turn: 0, utterance: 7, reason: "done" });
  expect(phases).toEqual(["listening", "thinking", "speaking", "listening"]);
});

// --- a second call ----------------------------------------------------------

test("a restart is a new call: a fresh machine and a fresh transcript epoch", async () => {
  const h = new Harness();
  await h.open();
  await h.stream(KICKOFF_TURN, REPLY);
  await h.finish(KICKOFF_TURN);
  await h.emit({ kind: "spoken", turn: 0, utterance: 7, reason: "done" });
  await h.userSaid(1, "第一通电话");
  await h.call.stop();

  await h.open();
  // Turn numbering starts over with the native side's, so the transcript is
  // told the epoch changed rather than replacing the last call's turn 1.
  expect(h.epochs).toEqual([0, 2]);
  expect(h.call.snapshot().session.turn).toBe(0);
  expect(h.asked[h.asked.length - 1]).toEqual({ turn: KICKOFF_TURN, text: VOICE_OPENING_KICKOFF });
});
