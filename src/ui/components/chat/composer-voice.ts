// The composer's voice input, the part that needs no React: whether a surface
// gets the mic, and which model polishes what it hears (Composer.tsx).

import type { CleanupModel } from '../../../ai/voice';
import type { ProviderId } from '../../../ai/providers';
import { toReasoning, type Settings } from '../../../platform/app/settings';

// Optional enrichment for the composer's built-in voice input. The mic is on by
// default; this only adds context. `glossary` seeds the STT cleanup pass with
// the current surface's proper names (book title + outline, article title) so
// mis-transcriptions of those terms get corrected. The cleanup model is derived
// from settings inside the composer, not passed here.
export interface ComposerVoice {
	glossary?: string;
}

// Resolve the `voice` prop against one host capability. The control is enabled
// unless a caller explicitly opts out with `voice={false}`, or the host cannot
// do it — on a phone the capture commands are not compiled in, so a mic there is
// a button whose only outcome is an error (see hasNativeRecorder).
//
// The composer asks this once for the recorder and once for on-device dictation.
// The two are exclusive in practice — a host either records for an STT round
// trip or dictates on device — but they are asked separately, so a host that
// grew both would show both rather than silently pick one.
export function resolveComposerVoice(
	voice: ComposerVoice | false | undefined,
	hostCan: boolean,
): { glossary: string } | null {
	if (voice === false || !hostCan) return null;
	return { glossary: voice?.glossary ?? '' };
}

// The cleanup model the composer's voice input runs on: the default chat model
// at the chat's thinking level. Null when no default provider/model is
// configured (the mic then skips the polish pass and keeps the raw transcript).
export function cleanupModelFromSettings(
	s: Pick<Settings, 'defaultProviderId' | 'defaultModelId' | 'chatThinking'>,
): CleanupModel | null {
	return s.defaultProviderId && s.defaultModelId
		? {
				providerId: s.defaultProviderId as ProviderId,
				modelId: s.defaultModelId,
				reasoning: toReasoning(s.chatThinking),
			}
		: null;
}
