// The one string that crosses from the call to the body (use-voice-call.ts):
// the two reasons the corner has a sentence for go over as keys, and every
// other failure goes over as its own message. A start that iOS refused lands in
// the second group, and it is the group that used to arrive nowhere — the
// corner drew no line at all until the call that failed to start got one.
//
// Run: bun test.

import { expect, test } from "bun:test";

import { voiceCallHandle } from "../../../../src/ui/components/lumen/use-voice-call";
import { orbErrorLine } from "../../../../src/ui/components/orb/orb";
import type { VoiceCallError, VoiceCallView } from "../../../../src/soul/voice/voice-call";

function view(error: VoiceCallError | null): VoiceCallView {
	return {
		phase: "idle",
		error,
		start: () => {},
		stop: () => {},
		subscribeLevel: () => () => {},
		subscribeEnvelope: () => () => {},
	};
}

test("a reason the corner has a line for crosses as the key", () => {
	expect(voiceCallHandle(view({ reason: "interrupted", message: "x" })).error).toBe("interrupted");
	expect(voiceCallHandle(view({ reason: "lost", message: "x" })).error).toBe("lost");
});

test("a start that failed crosses as its own sentence, and shows as one", () => {
	const handle = voiceCallHandle(view({ reason: "start-failed", message: "The microphone is off." }));
	expect(orbErrorLine(handle.error)).toBe("The microphone is off.");
});

test("a call that is fine has no line", () => {
	expect(orbErrorLine(voiceCallHandle(view(null)).error)).toBe(null);
});
