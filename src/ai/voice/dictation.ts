// On-device dictation (docs/15), the touch half of voice input. iOS transcribes
// as the user speaks (SpeechAnalyzer, behind the voice plugin) and pushes
// partial results out as events; nothing is uploaded and there is no key to
// configure, which is what makes hold-to-talk on a phone worth having where the
// desktop record -> STT -> polish pipeline is not.
//
// The webview side is a binding and a transcript. The commands and the event
// name are the contract with the native side:
//
//   plugin:voice|start_dictation      { locale?, contextualStrings? }
//   plugin:voice|stop_dictation       -> { transcript }
//   plugin:voice|cancel_dictation
//   plugin:voice|release_microphone
//   plugin event ("voice", "dictation")   payload: DictationEvent
//
// A DictationSource is an interface so the gesture and the transcript can be
// tested with a fake one on a machine that has no plugin at all.

import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { hasOnDeviceDictation } from "../../platform/app/platform";

export type DictationEvent =
  // The tail that is not settled yet. Each one replaces the last in full — it is
  // a re-guess of the same speech, not more of it.
  | { kind: "volatile"; text: string }
  // A settled stretch, appended to the transcript. It also consumes the volatile
  // tail: what was hypothesised is what just settled.
  | { kind: "final"; text: string }
  // Input level 0..1, for the meter. Carries no text and never reaches the
  // transcript.
  | { kind: "level"; value: number }
  // Where the press went, once. Sent after the hold is over and read by nothing
  // in the product; the bench writes it into its file (src/smoke/bench-journal.ts).
  | { kind: "timing"; timing: DictationTiming };

// One hold's segments, as the plugin measured them
// (plugins/voice/ios/Sources/DictationTiming.swift). It is a measurement and not
// a contract: the step names are whatever the native side marked, so a build
// that marks one more step needs nothing here.
//
// Numbers and states only. There is no field it could carry speech in, which is
// deliberate — the same rule the native side's logging follows.
export interface DictationTiming {
  // True when the microphone was inherited from the hold before it instead of
  // built for this one. False on the first hold of a voice mode.
  reused: boolean;
  // Why it was built rather than inherited; null when it was inherited.
  reuseSkipped: string | null;
  // Where the indicator probe was standing when the finger went down: a stage
  // name, or "never", "off", "unread" (see src/smoke/indicator-probe.ts).
  probeStage: string;
  // Whether a probe had been in the audio stack since the previous hold, which
  // is what decides whether this press was refused. Not the same question as
  // probeStage: putting a probe back on "off" tears the stack down too.
  probeTouched: boolean;
  // Milliseconds from the press to each step of the start: session, inputNode,
  // voiceProcessing, microphoneFormat, capturing, firstBuffer, running and the
  // recognizer's own steps between them.
  steps: Record<string, number>;
  // Milliseconds from the release to each step of the teardown. A different zero
  // from `steps`.
  teardown: Record<string, number>;
  // What the pre-roll was holding when the recognizer took over, or null on a
  // hold that never got that far.
  preroll: {
    buffers: number;
    ms: number;
    droppedMs: number;
    handoverMs: number;
  } | null;
}

export interface DictationSource {
  start(onEvent: (e: DictationEvent) => void): Promise<void>;
  // Finish and return the whole transcript: everything already final plus
  // whatever the recognizer flushes on the way out.
  stop(): Promise<string>;
  cancel(): Promise<void>;
}

export interface DictationOptions {
  // BCP-47. Left unset the native side follows the device's own setting.
  locale?: string;
  // Proper names to bias recognition towards — the book's title and outline,
  // same glossary the desktop cleanup pass gets.
  contextualStrings?: string[];
}

export { hasOnDeviceDictation };

// --- transcript ------------------------------------------------------------

export interface Transcript {
  // Settled stretches in the order they arrived.
  readonly finals: readonly string[];
  // The current unsettled tail, or "" when there is none.
  readonly volatile: string;
}

export const EMPTY_TRANSCRIPT: Transcript = { finals: [], volatile: "" };

// A space goes into a seam unless a CJK character sits on either side of it.
// Chinese and Japanese are written without them and a recognizer emits its
// stretches unpadded, so joining "今天" and "很好" with a space would be wrong;
// two English stretches without one would be a different word. Fullwidth
// punctuation counts as CJK ("好，" + "然后" takes no space), and a seam that
// already has whitespace on one side is left alone.
const CJK =
  /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/;

export function joinSpeech(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const seam =
    /\s$/.test(left) || /^\s/.test(right) || CJK.test(left.slice(-1)) || CJK.test(right[0])
      ? ""
      : " ";
  return left + seam + right;
}

// The text to show or send right now: the settled stretches, then the tail.
export function transcriptText(t: Transcript): string {
  return [...t.finals, t.volatile].reduce(joinSpeech, "").trim();
}

export function applyDictationEvent(t: Transcript, e: DictationEvent): Transcript {
  switch (e.kind) {
    // Neither carries words. A timing arrives once the hold is over, after the
    // last final, so folding it in as a no-op is all there is to do with it.
    case "level":
    case "timing":
      return t;
    case "volatile":
      return { finals: t.finals, volatile: e.text.trim() };
    case "final": {
      const text = e.text.trim();
      // A final drops the tail whether or not it carries text: the hypothesis it
      // replaces is settled either way.
      if (!text) return { finals: t.finals, volatile: "" };
      return { finals: [...t.finals, text], volatile: "" };
    }
  }
}

// The whole stream folded at once. What the machine does incrementally, for
// tests and for anything holding a recording.
export function assembleTranscript(events: readonly DictationEvent[]): string {
  return transcriptText(events.reduce(applyDictationEvent, EMPTY_TRANSCRIPT));
}

// --- the host's source ------------------------------------------------------

// The plugin's own listener bus, not the global one. A Swift plugin can only
// `trigger` into channels registered by `register_listener`, which is what
// addPluginListener creates; there is no way to emit a global app event from
// Swift, so `listen("voice://dictation")` would have subscribed to something
// nobody can ever fire — silently, since listen() on a dead name throws nothing.
// Exported because the interactive bench (src/smoke/dictation-bench.tsx)
// subscribes a second listener to the same stream, to show a run's level and
// event counts beside the bar without going through the gesture. Tauri's Swift
// Plugin keeps one array of channels per event name and `trigger` fans out to
// all of them, so a passive listener is additive: it sees every event and takes
// none away from the composer's.
export const VOICE_PLUGIN = "voice";
export const DICTATION_EVENT = "dictation";

// The four commands and the one subscription, as parameters rather than
// imports. Under bun `nativeDictation()` returns null, so nothing in this file
// below the transcript would otherwise be exercised at all — and the command
// strings, the argument keys, the `{transcript}` shape and the event name are
// exactly the kind of thing a typo hides in until a device build. Injecting the
// bridge lets the test check them without `mock.module`, which rewrites the
// whole worker's module registry and does not roll back (docs/pitfall/119).
export interface DictationBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  subscribe(
    plugin: string,
    event: string,
    cb: (e: DictationEvent) => void,
  ): Promise<{ unregister(): Promise<void> }>;
}

// The plugin, wrapped. One listener per run, dropped by both stop and cancel, so
// a second hold never sees the first one's events. A start that fails drops the
// listener too — otherwise a missing plugin would leak one per press.
class NativeDictation implements DictationSource {
  private listener: { unregister(): Promise<void> } | null = null;

  constructor(
    private readonly options: DictationOptions,
    private readonly bridge: DictationBridge,
  ) {}

  async start(onEvent: (e: DictationEvent) => void): Promise<void> {
    this.listener = await this.bridge.subscribe(VOICE_PLUGIN, DICTATION_EVENT, onEvent);
    try {
      await this.bridge.invoke<void>("plugin:voice|start_dictation", {
        locale: this.options.locale,
        contextualStrings: this.options.contextualStrings,
      });
    } catch (e) {
      this.drop();
      throw e;
    }
  }

  async stop(): Promise<string> {
    try {
      const res = await this.bridge.invoke<{ transcript: string }>("plugin:voice|stop_dictation");
      return res?.transcript ?? "";
    } finally {
      this.drop();
    }
  }

  async cancel(): Promise<void> {
    this.drop();
    await this.bridge.invoke<void>("plugin:voice|cancel_dictation");
  }

  private drop(): void {
    // unregister() is a round trip of its own and its rejection is nobody's
    // business here: the listener is already off this object either way.
    void this.listener?.unregister().catch(() => {});
    this.listener = null;
  }
}

// For tests and for anything that has its own transport.
export function createNativeDictation(
  options: DictationOptions,
  bridge: DictationBridge,
): DictationSource {
  return new NativeDictation(options, bridge);
}

const tauriBridge: DictationBridge = {
  invoke: (command, args) => invoke(command, args),
  subscribe: (plugin, event, cb) => addPluginListener<DictationEvent>(plugin, event, cb),
};

// The host's dictation, or null where there is none.
export function nativeDictation(options: DictationOptions = {}): DictationSource | null {
  if (!hasOnDeviceDictation()) return null;
  return new NativeDictation(options, tauriBridge);
}

// Voice mode is over, so the microphone goes. The native side keeps the audio
// stack standing between holds — that is what makes the second press of a voice
// mode 300 ms instead of a second — and the orange indicator stays lit for as
// long as it does. Nothing else puts it out, so this is called the moment the
// bar goes away: back to the keyboard, out of the chat, or unmounted under the
// user.
//
// Never rejects. It runs in an unmount cleanup, where there is nobody left to
// show a failure to, and off iOS it is a no-op: hasOnDeviceDictation() is the
// same gate the bar itself is behind.
export async function releaseDictationMicrophone(bridge?: DictationBridge): Promise<void> {
  // No bridge is the composer's call and the host decides, the same way
  // nativeDictation() decides. A bridge means the caller is the transport and
  // has decided already, which is what lets the command string be checked
  // somewhere other than a device build.
  const transport = bridge ?? (hasOnDeviceDictation() ? tauriBridge : null);
  if (!transport) return;
  try {
    await transport.invoke<void>("plugin:voice|release_microphone");
  } catch {
    // The stack it would have torn down is torn down by the next thing that
    // takes the microphone, and by the process ending. Neither is worth an
    // error in a component that no longer exists.
  }
}
