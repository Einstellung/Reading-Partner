// The pre-synthesised lines the program says on its own (docs/companion/136
// "级联前台的一次回复"): "thinking" when the front handed something off and said
// nothing, "lost" when its reply failed before it said anything. The lines are
// made natively when a call opens (`prime`) and played from memory
// (plugins/voice/src/tts/cues.rs); the ids here mirror the table there.

import { invoke } from "@tauri-apps/api/core";
import { PRIME_SPEECH_CUES, SPEAK_CUE } from "../conversation";

export type FillerKind = "thinking" | "lost";

export interface FillerPort {
  /** Play the clip. False when there is none to play, and the caller says it some other way. */
  play(kind: FillerKind, locale: string): Promise<boolean>;
}

/** A filler whose lines are made ahead of need. */
export interface CueFiller extends FillerPort {
  /** Make the lines for this locale. Called when a call opens. */
  prime(locale: string): Promise<void>;
}

export type CueInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function fillerNotConnected(): FillerPort {
  return { play: async () => false };
}

/** The cue table's language: Chinese for any zh locale, English for the rest. */
export function cueLang(locale: string): "zh" | "en" {
  return locale.startsWith("zh") ? "zh" : "en";
}

const CUE_OF: Record<FillerKind, string> = { thinking: "think", lost: "lost" };

export function cueId(kind: FillerKind, locale: string): string {
  return `${cueLang(locale)}/${CUE_OF[kind]}`;
}

/** The filler over the voice plugin's `prime_speech_cues` and `speak_cue`. */
export function createCueFiller(call: CueInvoke): CueFiller {
  return {
    async play(kind, locale) {
      try {
        await call(SPEAK_CUE, { id: cueId(kind, locale) });
        return true;
      } catch (e) {
        console.warn("RP-FRONT filler cue failed", e);
        return false;
      }
    },
    async prime(locale) {
      await call(PRIME_SPEECH_CUES, { lang: cueLang(locale) });
    },
  };
}

/** The filler on a host with the voice plugin. */
export function nativeFiller(): CueFiller {
  return createCueFiller((command, args) => invoke(command, args));
}

/** The line itself, for a front with no clip to play. */
export function fillerLine(kind: FillerKind, locale: string): string {
  return LINES[kind][cueLang(locale)];
}

// The same text as the cue table in cues.rs.
const LINES: Record<FillerKind, Record<"zh" | "en", string>> = {
  thinking: { zh: "我去想想。", en: "Let me think about that." },
  lost: { zh: "刚才没连上，你再说一遍。", en: "Sorry, I lost that. Could you say it again?" },
};

/** What the front says when its reply only called a run back. True whether or not the run was still out. */
export function ackLine(locale: string): string {
  return cueLang(locale) === "zh" ? "好的。" : "Okay.";
}
