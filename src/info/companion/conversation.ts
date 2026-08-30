// The full-duplex call's binding to the native side (docs/45, docs/33
// M-voice-3). The microphone stays open while the companion speaks, so the
// native half decides who is talking on the audio thread — turn-detect.ts
// transliterated, or iOS 26's own SpeechDetector, whichever the probe settles
// on — and announces the verdicts here. The webview never sees a frame.
//
// Its own event name rather than a fifth `dictation` kind, for the reason the
// plugin's README states: the dictation reducer has no default branch, its four
// kinds are the whole vocabulary, and hold-to-talk is already on TestFlight. The
// reducer below DOES have a default branch, which is what lets the native side
// add a kind — a VAD that reports differently, a barge-in that carries one more
// number — without the webview holding `undefined` and throwing inside a
// callback nobody catches.
//
//   plugin:voice|start_conversation   { locale?, contextualStrings? }
//   plugin:voice|stop_conversation    -> —
//   plugin:voice|set_speech_volume    { value }        0..1
//   plugin:voice|speak_begin          -> utterance number
//   plugin:voice|speak_push           { text }
//   plugin:voice|speak_close
//   plugin:voice|speak_stop           -> SpeechStopped
//   plugin event ("voice", "conversation")   payload: ConversationEvent
//
// The four speak_* commands exist (plugins/voice/src/session.rs); the three
// conversation ones are this file's half of a contract the native side of
// M-voice-3 still has to meet.

import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { joinSpeech } from "../../ai/voice/dictation";
import { hasNativeSpeech } from "../../platform/app/platform";

// --- the events -------------------------------------------------------------

/**
 * Where a barge-in cut the companion off. The authority is the event, not
 * `speak_stop`'s answer: Swift stops the player the instant it hears the user,
 * long before an invoke could reach it, so by the time the command runs there is
 * nothing playing and it answers with the sentinel (plugins/voice/README.md).
 */
export interface SpeechCut {
  /** The speaking turn that was cut, as `speak_begin` numbered it. */
  utterance: number;
  /** Which sentence of that turn was playing, from 0. */
  sentence: number;
  /** How far into that sentence the playhead was, in characters. */
  charOffset: number;
  /** The same position in milliseconds. */
  playedMs: number;
}

/** The span of the call's audio timeline a recognizer result covers. */
export interface SpeechRange {
  startMs: number;
  endMs: number;
}

/** Why a conversation is up or down. */
export type ConversationReason =
  | "opened"
  | "closed"
  | "interrupted"
  | "released"
  | "lost"
  | "failed";

/**
 * One thing the native side has to say. Every event carries the turn it belongs
 * to: a call is a sequence of user turns, numbered from 1, and a late result can
 * arrive after the turn it belongs to is over.
 *
 * The four barge-in kinds are turn-detect.ts's vocabulary (`duck`, `stop`,
 * `resume`, `end`) with the same meanings, because on device that machine is
 * what emits them.
 */
export type ConversationEvent =
  // Someone crossed the line and it looks like the user. Drop the playback's
  // volume; tear nothing down. Not yet a turn.
  | { kind: "speech-duck"; turn: number }
  // It really is the user. The playback is already stopped on the native side;
  // `cut` says where, which is what truncates the reply in the transcript.
  | { kind: "speech-stop"; turn: number; cut: SpeechCut }
  // The duck was a false alarm and nothing was ever stopped. Put the volume back.
  | { kind: "speech-resume"; turn: number }
  // The user stopped talking: this is their turn, as the recognizer had it at
  // the moment the hangover expired. `silentMs` is the measured gap.
  | { kind: "speech-end"; turn: number; text: string; silentMs: number }
  // A stretch the recognizer settled after the turn had already been answered.
  // `range` is what says which turn it belongs to — a final can arrive a second
  // after the turn it completes was sent to the model.
  | { kind: "final"; turn: number; text: string; range: SpeechRange }
  // Input level 0..1, for the orb. Carries no text.
  | { kind: "level"; turn: number; value: number }
  // The call itself came up or went away. `reason` is why.
  | { kind: "state"; turn: number; running: boolean; reason: ConversationReason }
  // The turn's playback finished, whether it was said to the end (`done`), ran
  // out of audio (`underrun`), was cut off (`interrupted`) or lost the engine.
  | { kind: "spoken"; turn: number; utterance: number; reason: string };

// --- the reducer ------------------------------------------------------------

/** What the events add up to, for a view that has to draw the call. */
export interface ConversationState {
  /** The call is up. */
  readonly running: boolean;
  /** Why it is up or down. */
  readonly reason: ConversationReason | null;
  /** The highest turn number any event has carried. */
  readonly turn: number;
  /** Last input level 0..1. */
  readonly level: number;
  /** The playback's volume is down pending a verdict on who is talking. */
  readonly ducked: boolean;
  /** What the user's last finished turn said, late finals folded in. */
  readonly heard: string;
  /** Where the last barge-in cut the companion, or null if none has. */
  readonly cut: SpeechCut | null;
}

export const EMPTY_CONVERSATION: ConversationState = {
  running: false,
  reason: null,
  turn: 0,
  level: 0,
  ducked: false,
  heard: "",
  cut: null,
};

export function applyConversationEvent(
  s: ConversationState,
  e: ConversationEvent,
): ConversationState {
  // Every kind carries one, and an event from a turn that has already been
  // superseded must not wind the counter back.
  const turn = Math.max(s.turn, typeof e?.turn === "number" ? e.turn : 0);
  switch (e?.kind) {
    case "speech-duck":
      return { ...s, turn, ducked: true };
    case "speech-resume":
      return { ...s, turn, ducked: false };
    case "speech-stop":
      return { ...s, turn, ducked: false, cut: e.cut };
    case "speech-end":
      return { ...s, turn, ducked: false, heard: e.text.trim() };
    case "final": {
      const text = e.text.trim();
      // A final for the turn on the floor extends what was heard; one for an
      // older turn is the orchestrator's business (it repairs the message it
      // already sent) and changes nothing on screen.
      if (!text || e.turn !== s.turn) return { ...s, turn };
      return { ...s, turn, heard: joinSpeech(s.heard, text) };
    }
    case "level":
      return { ...s, turn, level: e.value };
    case "state":
      return {
        ...s,
        turn,
        running: e.running,
        reason: e.reason,
        // A call that went away is not holding a duck.
        ducked: e.running ? s.ducked : false,
        level: e.running ? s.level : 0,
      };
    case "spoken":
      return { ...s, turn };
    // A kind this build has never heard of. The whole reason the call has an
    // event of its own: the native side can grow one without a webview that
    // predates it throwing on the microphone's own callback.
    default:
      return s;
  }
}

// --- the host's side --------------------------------------------------------

export const VOICE_PLUGIN = "voice";
export const CONVERSATION_EVENT = "conversation";

export const START_CONVERSATION = "plugin:voice|start_conversation";
export const STOP_CONVERSATION = "plugin:voice|stop_conversation";
export const SET_SPEECH_VOLUME = "plugin:voice|set_speech_volume";
export const SPEAK_BEGIN = "plugin:voice|speak_begin";
export const SPEAK_PUSH = "plugin:voice|speak_push";
export const SPEAK_CLOSE = "plugin:voice|speak_close";
export const SPEAK_STOP = "plugin:voice|speak_stop";

/** `speak_stop`'s answer. A sentinel on the barge-in path; see SpeechCut. */
export interface SpeechStopped {
  utterance: number;
  sentence: number;
  positionMs: number;
  durationMs: number;
}

export interface ConversationOptions {
  /** BCP-47. Unset follows the device, which is what mis-transcribes Chinese. */
  locale?: string;
  /** Proper names to bias recognition towards. */
  contextualStrings?: string[];
}

// The commands and the one subscription as parameters rather than imports, for
// the reason dictation.ts takes a bridge: off iOS there is no plugin, so the
// command strings, the argument keys and the event name are otherwise checked by
// nothing until a device build. Injected rather than mocked because mock.module
// rewrites the whole worker's registry and does not roll back (pitfall 119).
export interface ConversationBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  subscribe(
    plugin: string,
    event: string,
    cb: (e: ConversationEvent) => void,
  ): Promise<{ unregister(): Promise<void> }>;
}

/**
 * The native call. Everything the session orchestrator's effects are executed
 * against; it holds no state of its own beyond the one listener.
 */
export interface ConversationSource {
  start(onEvent: (e: ConversationEvent) => void): Promise<void>;
  stop(): Promise<void>;
  /** Playback volume 0..1. The duck lowers it; the resume puts it back. */
  setVolume(value: number): Promise<void>;
  /** Open a turn of speech; the answer is its utterance number. */
  speakBegin(): Promise<number>;
  speakPush(text: string): Promise<void>;
  speakClose(): Promise<void>;
  speakStop(): Promise<SpeechStopped>;
}

class NativeConversation implements ConversationSource {
  private listener: { unregister(): Promise<void> } | null = null;

  constructor(
    private readonly options: ConversationOptions,
    private readonly bridge: ConversationBridge,
  ) {}

  async start(onEvent: (e: ConversationEvent) => void): Promise<void> {
    this.listener = await this.bridge.subscribe(VOICE_PLUGIN, CONVERSATION_EVENT, onEvent);
    try {
      await this.bridge.invoke<void>(START_CONVERSATION, {
        locale: this.options.locale,
        contextualStrings: this.options.contextualStrings,
      });
    } catch (e) {
      this.drop();
      throw e;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.bridge.invoke<void>(STOP_CONVERSATION);
    } finally {
      this.drop();
    }
  }

  async setVolume(value: number): Promise<void> {
    await this.bridge.invoke<void>(SET_SPEECH_VOLUME, { value });
  }

  async speakBegin(): Promise<number> {
    return (await this.bridge.invoke<number>(SPEAK_BEGIN)) ?? 0;
  }

  async speakPush(text: string): Promise<void> {
    await this.bridge.invoke<void>(SPEAK_PUSH, { text });
  }

  async speakClose(): Promise<void> {
    await this.bridge.invoke<void>(SPEAK_CLOSE);
  }

  async speakStop(): Promise<SpeechStopped> {
    return await this.bridge.invoke<SpeechStopped>(SPEAK_STOP);
  }

  private drop(): void {
    void this.listener?.unregister().catch(() => {});
    this.listener = null;
  }
}

/** For tests and for anything that has its own transport. */
export function createNativeConversation(
  options: ConversationOptions,
  bridge: ConversationBridge,
): ConversationSource {
  return new NativeConversation(options, bridge);
}

const tauriBridge: ConversationBridge = {
  invoke: (command, args) => invoke(command, args),
  subscribe: (plugin, event, cb) => addPluginListener<ConversationEvent>(plugin, event, cb),
};

/** The host's call, or null where there is no plugin to hold one. */
export function nativeConversation(
  options: ConversationOptions = {},
): ConversationSource | null {
  if (!hasNativeSpeech()) return null;
  return new NativeConversation(options, tauriBridge);
}
