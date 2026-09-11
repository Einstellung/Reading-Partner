// The full-duplex call, driven (docs/33 "被召唤的语音会话", docs/45). The state
// machine in voice-session.ts decides what a call does; this is what does it:
// it holds the native call open, feeds every event through the machine, and
// performs the effects that come back against three ports — the native bridge,
// one model turn, and the thread the conversation is kept in.
//
// Ports rather than imports, for the reason conversation.ts takes a bridge: the
// whole call then runs on a machine with no plugin, no microphone and no key,
// which is where it is developed. The live ones are in voice-call-live.ts.
//
// Two things worth knowing before reading it:
//
// 1. Effects are performed on one queue. A native command is a promise, an
//    effect list is ordered, and the effects a `speak_stop` answer or a model
//    delta produce belong BEHIND the ones already queued — a `record` that
//    overtook the `record` it corrects would leave the corrected text on disk.
//    Everything therefore goes through `enqueue`, including the feedback.
// 2. The opening line is a normal model turn. The session numbers user turns
//    from 1 (the native side's numbering) and has no notion of a model turn
//    without a user turn, so the greeting is kicked as a synthetic `speech-end`
//    for turn 0 carrying VOICE_OPENING_KICKOFF. Turn 0 is the turn before the
//    user's first, its user-side `record` is dropped on the way to the
//    transcript (the note is not something the reader said), and the reply it
//    produces is recorded and spoken like any other.

import type { TurnActivity } from "../../ai/activity";
import { VOICE_OPENING_KICKOFF } from "./call";
import { speechEnvelope } from "./conversation";
import type {
  ConversationEvent,
  ConversationReason,
  ConversationSource,
  SpeechEnvelope,
} from "./conversation";
import {
  createVoiceSession,
  type SessionEffect,
  type SessionPhase,
  type VoiceSession,
  type VoiceSessionConfig,
  type VoiceSessionSnapshot,
  type VoiceTurn,
} from "./voice-session";

/** The turn the opening line is asked as. Native turns start at 1. */
export const KICKOFF_TURN = 0;

/**
 * Why a call is not up. `reason` is the native side's word for it where there
 * is one; `message` is the sentence to show, and per docs/33 it says the call
 * has to be started again rather than offering to resume — there is no progress
 * to resume from.
 */
export interface VoiceCallError {
  reason: ConversationReason | "start-failed";
  message: string;
}

/** One model turn, run headlessly. */
export interface VoiceCallModel {
  /**
   * Answer `text` on the day's thread. Chunks go out through `onDelta` as the
   * model writes them — raw model text, never the spoken form. The promise
   * resolves when the turn ended on its own and rejects when it failed; once
   * `signal` aborts, however it settles is dropped.
   */
  ask(req: {
    turn: number;
    text: string;
    onDelta: (chunk: string) => void;
    /**
     * A tool of this turn went out or came back. Passed in the way `onDelta` is,
     * so the driver sees only its own turns' activity and a turn it has dropped
     * stops reporting.
     */
    onActivity: (event: TurnActivity) => void;
    signal: AbortSignal;
  }): Promise<void>;
}

/** Where the call's turns are kept. */
export interface VoiceCallTranscript {
  /** A new call is starting. Entries from here on belong to it, not the last one. */
  begin(): void;
  /**
   * Append the entry, or replace what this call already wrote for the same turn
   * and role — a recognizer result that settled late repairs the message it was
   * sent as, and a barge-in shortens the reply it cut.
   */
  record(entry: VoiceTurn): void;
}

export interface VoiceCallDeps {
  bridge: ConversationSource;
  model: VoiceCallModel;
  transcript: VoiceCallTranscript;
  /** The note the opening turn is asked with. */
  kickoff?: string;
  session?: Partial<VoiceSessionConfig>;
}

export interface VoiceCallSnapshot {
  phase: SessionPhase;
  error: VoiceCallError | null;
  /** The native call is up. */
  running: boolean;
  /** The turn of speech the player is on, or null when none is open. */
  utterance: number | null;
  session: VoiceSessionSnapshot;
}

export interface VoiceCall {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribePhase(cb: (phase: SessionPhase) => void): () => void;
  /**
   * Input level 0..1. A callback and not state on purpose: the orb draws it on
   * an animation frame (docs/45) and a level event arrives many times a second.
   */
  subscribeLevel(cb: (level: number) => void): () => void;
  /**
   * The sentence the companion is about to say, as a shape (docs/45). A
   * callback for the reason the level is one, and `null` for the one thing a
   * queue of future sentences has to be told: none of them will be heard, so
   * whatever is still queued is dropped. A barge-in and the end of a call both
   * send it.
   */
  subscribeEnvelope(cb: (envelope: SpeechEnvelope | null) => void): () => void;
  subscribeError(cb: (error: VoiceCallError | null) => void): () => void;
  /**
   * The tool calls the call's turns make (docs/66 "四段"): the one signal that
   * says the soul is looking at the desk rather than at the reader. Starts are
   * balanced by ends even when the turn that opened them is dropped.
   */
  subscribeActivity(cb: (event: TurnActivity) => void): () => void;
  snapshot(): VoiceCallSnapshot;
  /** Resolves once every queued effect has been performed. For tests and stop(). */
  settled(): Promise<void>;
}

/**
 * What the orb sees (docs/45). The hook returns this and nothing else, so the
 * component can be built against it without knowing there is a state machine.
 */
export interface VoiceCallView {
  phase: SessionPhase;
  error: VoiceCallError | null;
  start: () => void;
  stop: () => void;
  subscribeLevel: (cb: (level: number) => void) => () => void;
  subscribeEnvelope: (cb: (envelope: SpeechEnvelope | null) => void) => () => void;
}

const ENDED: Partial<Record<ConversationReason, string>> = {
  // docs/33 "交互": a call to Siri, an alarm or an incoming call kills it, and
  // what the user is owed on the way back is the truth and a way to start again.
  interrupted: "The call was interrupted. Tap to start it again.",
  lost: "The call was lost. Tap to start it again.",
  failed: "The call stopped. Tap to start it again.",
};

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function createVoiceCall(deps: VoiceCallDeps): VoiceCall {
  const phaseListeners = new Set<(p: SessionPhase) => void>();
  const levelListeners = new Set<(v: number) => void>();
  const envelopeListeners = new Set<(e: SpeechEnvelope | null) => void>();
  const errorListeners = new Set<(e: VoiceCallError | null) => void>();
  const activityListeners = new Set<(e: TurnActivity) => void>();

  // A fresh machine per call. A restart is a new call and not a resumption
  // (docs/33), and the native side numbers its turns from 1 again — a machine
  // carried over from the last call would read those as stale and drop them.
  let session: VoiceSession = createVoiceSession(deps.session);
  let phase: SessionPhase = "idle";
  let error: VoiceCallError | null = null;
  let running = false;
  let greeted = false;
  let utterance: number | null = null;
  // The model turns in flight, by turn. An `abort` effect drops one; a turn that
  // settles after being dropped is a stream that was already in the air and is
  // not fed back.
  const asks = new Map<number, AbortController>();
  // The tools each turn has open. A turn dropped mid-tool would otherwise leave
  // a start with no end, and the body reading this counts one against the other
  // — Lumen would go on staring at the desk for the rest of the call.
  const openTools = new Map<number, string[]>();

  let tail: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): void {
    // Run whichever way the one before it went: an effect that failed is one
    // native command that did not happen, not the end of the call.
    tail = tail.then(work, work).catch((e) => {
      console.error("voice call effect failed", e);
    });
  }

  /** Feed the machine and perform what it answers, behind everything queued. */
  function feed(step: () => SessionEffect[]): void {
    enqueue(async () => {
      await perform(step());
    });
  }

  function setPhase(to: SessionPhase): void {
    if (phase === to) return;
    phase = to;
    for (const cb of phaseListeners) cb(to);
  }

  function setError(e: VoiceCallError | null): void {
    error = e;
    for (const cb of errorListeners) cb(e);
  }

  function emitLevel(v: number): void {
    for (const cb of levelListeners) cb(v);
  }

  function emitActivity(e: TurnActivity): void {
    for (const cb of activityListeners) cb(e);
  }

  function noteActivity(turn: number, e: TurnActivity): void {
    const open = openTools.get(turn) ?? [];
    if (e.phase === "start") {
      open.push(e.name);
      openTools.set(turn, open);
    } else {
      const at = open.lastIndexOf(e.name);
      if (at < 0) return;
      open.splice(at, 1);
      if (open.length === 0) openTools.delete(turn);
    }
    emitActivity(e);
  }

  /** Close whatever this turn still has out. A no-op for a turn with nothing open. */
  function closeTurn(turn: number): void {
    const open = openTools.get(turn);
    if (!open) return;
    openTools.delete(turn);
    for (const name of open) emitActivity({ kind: "tool", name, phase: "end" });
  }

  function emitEnvelope(e: SpeechEnvelope | null): void {
    for (const cb of envelopeListeners) cb(e);
  }

  function startAsk(turn: number, text: string): void {
    const controller = new AbortController();
    asks.set(turn, controller);
    const live = () => asks.get(turn) === controller;
    void deps.model
      .ask({
        turn,
        text,
        signal: controller.signal,
        onDelta: (chunk) => {
          if (live()) feed(() => session.delta(turn, chunk));
        },
        onActivity: (e) => {
          if (live()) noteActivity(turn, e);
        },
      })
      .then(
        () => {
          closeTurn(turn);
          if (!live()) return;
          asks.delete(turn);
          feed(() => session.done(turn));
        },
        (e) => {
          closeTurn(turn);
          if (!live()) return;
          asks.delete(turn);
          console.error("voice call model turn failed", e);
          feed(() => session.failed(turn));
        },
      );
  }

  // One effect. Everything that can reject is a native command; what to do when
  // one does is decided by the loop below.
  async function performOne(e: SessionEffect): Promise<void> {
    switch (e.type) {
      case "ask":
        // Not awaited: the turn streams alongside the rest of the effects,
        // which is what the `thinking` orb behind it is for.
        startAsk(e.turn, e.text);
        break;
      case "abort":
        asks.get(e.turn)?.abort();
        asks.delete(e.turn);
        closeTurn(e.turn);
        break;
      case "speak-begin":
        utterance = await deps.bridge.speakBegin();
        break;
      case "speak-push":
        await deps.bridge.speakPush(e.text);
        break;
      case "speak-close":
        await deps.bridge.speakClose();
        break;
      case "speak-stop": {
        const at = await deps.bridge.speakStop();
        utterance = null;
        // Behind the rest of this batch: the record it may correct is in it.
        feed(() => session.stopped(e.turn, at));
        break;
      }
      case "volume":
        await deps.bridge.setVolume(e.value);
        break;
      case "orb":
        setPhase(e.phase);
        break;
      case "record":
        // Everything but the note the greeting was asked with. It is the
        // driver's sentence, not the reader's, and it is never rendered.
        if (!(e.entry.role === "user" && e.entry.turn === KICKOFF_TURN)) {
          deps.transcript.record(e.entry);
        }
        break;
    }
  }

  // A batch, effect by effect. A failure stops that one effect and nothing
  // else, which is the rule `enqueue` already applies between batches: an
  // effect that failed is one native command that did not happen, not the end
  // of the call. Applying it per batch instead is what made a stuck player cost
  // the transcript — a cut is `abort`, `speak-stop`, `record` in that order
  // (voice-session.ts), `speak_stop` is a command that really can reject
  // (plugins/voice/src/session.rs), and the reply the user did hear was then
  // never written down. Endings are when the player is most likely to be stuck,
  // which is when the last reply is the one at stake.
  async function perform(effects: SessionEffect[]): Promise<void> {
    for (const e of effects) {
      try {
        await performOne(e);
      } catch (err) {
        console.error("voice call effect failed", err);
      }
    }
  }

  // The opening line (docs/33 "不播稿"): a one-sentence take on today's briefing
  // and a question, not the briefing read out. Kicked once the native side says
  // the call is up rather than on start(), so the `state` event's own
  // `listening` cannot land on top of the `thinking` the greeting just set.
  async function greet(): Promise<void> {
    if (greeted) return;
    greeted = true;
    await perform(
      session.event({
        kind: "speech-end",
        turn: KICKOFF_TURN,
        text: deps.kickoff ?? VOICE_OPENING_KICKOFF,
        silentMs: 0,
      }),
    );
  }

  // The call went away. Foreground-only v1: nothing reconnects, and the reason
  // is what the UI has to say about it.
  async function ended(reason: ConversationReason | undefined): Promise<void> {
    if (!running) return;
    running = false;
    emitLevel(0);
    for (const [t, c] of asks) {
      c.abort();
      closeTurn(t);
    }
    asks.clear();
    const said = typeof reason === "string" ? ENDED[reason] : undefined;
    if (said) setError({ reason: reason as ConversationReason, message: said });
    // The native call is down but the listener is not: another start would then
    // get every event twice.
    try {
      await deps.bridge.stop();
    } catch (e) {
      console.error("voice call teardown failed", e);
    }
  }

  function onEvent(e: ConversationEvent): void {
    // Straight through, off the queue: the orb reads levels on an animation
    // frame and a level that waited behind a speak_push is a level too late.
    if (e?.kind === "level") {
      const v = finite(e.value);
      if (v !== null) emitLevel(v);
    }
    // Off the queue for the same reason, and for one more: an envelope says
    // when its sentence starts counting from the moment it arrived, so a hop
    // through the effect queue is a mouth that late.
    if (e?.kind === "envelope") {
      const envelope = speechEnvelope(e);
      if (envelope !== null) emitEnvelope(envelope);
    }
    // The player is already stopped on the native side, so every sentence
    // queued ahead of the cut is a sentence nobody will hear.
    if (e?.kind === "speech-stop") emitEnvelope(null);
    if (e?.kind === "state" && e.running === false) emitEnvelope(null);
    enqueue(async () => {
      await perform(session.event(e));
      if (e?.kind !== "state" || typeof e.running !== "boolean") return;
      if (e.running) await greet();
      else await ended(e.reason);
    });
  }

  async function settled(): Promise<void> {
    // Work queued by the work being awaited lands behind it, so one await is
    // not enough: drain until the tail stops moving.
    for (;;) {
      const at = tail;
      await at;
      if (tail === at) return;
    }
  }

  return {
    async start(): Promise<void> {
      if (running) return;
      session = createVoiceSession(deps.session);
      greeted = false;
      utterance = null;
      setPhase("idle");
      setError(null);
      deps.transcript.begin();
      running = true;
      try {
        await deps.bridge.start(onEvent);
      } catch (e) {
        running = false;
        setError({ reason: "start-failed", message: describe(e) });
      }
    },

    async stop(): Promise<void> {
      if (!running) return;
      running = false;
      // Told to the machine as a call that went away, which is what it is: the
      // model round is aborted, the player is stopped, and what the user did
      // hear is kept rather than lost. Then the native side is told, in that
      // order — `speak_stop` needs the call it is stopping.
      const at = session.snapshot().turn;
      feed(() => session.event({ kind: "state", turn: at, running: false, reason: "closed" }));
      await settled();
      for (const [t, c] of asks) {
        c.abort();
        closeTurn(t);
      }
      asks.clear();
      emitLevel(0);
      emitEnvelope(null);
      await deps.bridge.stop();
    },

    subscribePhase(cb) {
      phaseListeners.add(cb);
      return () => {
        phaseListeners.delete(cb);
      };
    },

    subscribeLevel(cb) {
      levelListeners.add(cb);
      return () => {
        levelListeners.delete(cb);
      };
    },

    subscribeEnvelope(cb) {
      envelopeListeners.add(cb);
      return () => {
        envelopeListeners.delete(cb);
      };
    },

    subscribeError(cb) {
      errorListeners.add(cb);
      return () => {
        errorListeners.delete(cb);
      };
    },

    subscribeActivity(cb) {
      activityListeners.add(cb);
      return () => {
        activityListeners.delete(cb);
      };
    },

    snapshot(): VoiceCallSnapshot {
      return { phase, error, running, utterance, session: session.snapshot() };
    },

    settled,
  };
}
