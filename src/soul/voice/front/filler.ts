// The pre-synthesised line the program plays when the front handed something
// off and said nothing (docs/companion/136 "级联前台的一次回复"). LOCAL
// STAND-IN: the clip cache is being written on hv/tts-first-frame. Until it
// lands, `fillerNotConnected` plays nothing and the cascade front speaks the
// same line through the ordinary TTS path instead.

export type FillerKind = "thinking";

export interface FillerPort {
  /** Play the clip. False when there is none to play, and the caller says it some other way. */
  play(kind: FillerKind, locale: string): Promise<boolean>;
}

export function fillerNotConnected(): FillerPort {
  return { play: async () => false };
}

/** The line itself, for a front with no clip to play. */
export function fillerLine(kind: FillerKind, locale: string): string {
  void kind;
  return locale.startsWith("zh") ? "我去想想。" : "Let me think about that.";
}
