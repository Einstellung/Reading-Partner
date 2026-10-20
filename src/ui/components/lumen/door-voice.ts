// Voice chat with Lumen, as the door conversation and the corner read it
// (docs/68, 2026-10-20). Entered from the round waveform button beside the
// door's composer; the call itself is soul/voice/voice-call.ts and is held at
// shell level (LumenCorner), so it outlives the panel it was started from.
//
// No React here: what the button says, what the voice bar reads, and when a
// card that needs a tap pulls the panel up mid-call.

import type { SessionPhase } from "../../../soul/voice/voice-session";

/** Whether the waveform button can start a call, and why not where it cannot. */
export type VoiceEntry = { kind: "ready" } | { kind: "off"; reason: "no-device" };

/**
 * The entry, from whether the host can speak at all (the native audio path).
 * Every screen can start a call: one with nothing published to talk about
 * holds it at the door (voice-call-mode.ts).
 */
export function voiceEntry(speaks: boolean): VoiceEntry {
	return speaks ? { kind: "ready" } : { kind: "off", reason: "no-device" };
}

/** The one line a greyed button shows when tapped. */
export function voiceOffLine(_reason: "no-device"): "shell.door.voiceNoDevice" {
	return "shell.door.voiceNoDevice";
}

/**
 * What the voice bar reads for a phase. Idle is the moment between the tap and
 * the microphone opening, and is read as listening: that is what comes next.
 */
export function voicePhaseLine(
	phase: SessionPhase,
): "shell.door.voiceListening" | "shell.door.voiceThinking" | "shell.door.voiceSpeaking" {
	if (phase === "thinking") return "shell.door.voiceThinking";
	if (phase === "speaking") return "shell.door.voiceSpeaking";
	return "shell.door.voiceListening";
}

/**
 * The first box item in `items` that was not among `seen`: something arrived
 * that wants a tap. Null when nothing new is there.
 */
export function arrivedItem<T extends { id: string }>(seen: ReadonlySet<string>, items: readonly T[]): T | null {
	return items.find((item) => !seen.has(item.id)) ?? null;
}

/** A message appended to the door conversation that carries a card for the reader to answer. */
export function carriesCard(message: { parts?: readonly { type: string }[] }): boolean {
	return message.parts?.some((part) => part.type === "card") ?? false;
}
