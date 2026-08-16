// On-device dictation (docs/15), the touch half of voice input. iOS transcribes
// as the user speaks (SpeechAnalyzer, behind the voice plugin) and pushes
// partial results out as events; nothing is uploaded and there is no key to
// configure, which is what makes hold-to-talk on a phone worth having where the
// desktop record -> STT -> polish pipeline is not.
//
// The webview side is a binding and a transcript. The commands and the event
// name are the contract with the native side:
//
//   plugin:voice|start_dictation   { locale?, contextualStrings? }
//   plugin:voice|stop_dictation    -> { transcript }
//   plugin:voice|cancel_dictation
//   event "voice://dictation"      payload: DictationEvent
//
// A DictationSource is an interface so the gesture and the transcript can be
// tested with a fake one on a machine that has no plugin at all.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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
  | { kind: "level"; value: number };

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
    case "level":
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

const DICTATION_EVENT = "voice://dictation";

// The plugin, wrapped. One listener per run, dropped by both stop and cancel, so
// a second hold never sees the first one's events. A start that fails drops the
// listener too — otherwise a missing plugin would leak one per press.
class NativeDictation implements DictationSource {
  private unlisten: UnlistenFn | null = null;

  constructor(private readonly options: DictationOptions) {}

  async start(onEvent: (e: DictationEvent) => void): Promise<void> {
    this.unlisten = await listen<DictationEvent>(DICTATION_EVENT, (e) => onEvent(e.payload));
    try {
      await invoke<void>("plugin:voice|start_dictation", {
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
      const res = await invoke<{ transcript: string }>("plugin:voice|stop_dictation");
      return res?.transcript ?? "";
    } finally {
      this.drop();
    }
  }

  async cancel(): Promise<void> {
    this.drop();
    await invoke<void>("plugin:voice|cancel_dictation");
  }

  private drop(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}

// The host's dictation, or null where there is none.
export function nativeDictation(options: DictationOptions = {}): DictationSource | null {
  if (!hasOnDeviceDictation()) return null;
  return new NativeDictation(options);
}
