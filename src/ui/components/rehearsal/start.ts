// Opening the microphone for a pass, in one place because both doors into a
// rehearsal need it (docs/44) and getting it wrong is silent: the source has to
// be recording before the reader starts talking, or the opening words are lost.
//
// A source that cannot be built is null, not a throw. A run with no words in it
// is a run (reading/rehearsal) — no STT key on the desktop and no dictation on
// the host are both ordinary states of this machine, and neither is a reason to
// refuse to put the note on screen.

import { cutSession, startSession, stopSession } from "../../../ai/voice";
import type { GlossarySource } from "../../../ai/voice/cleanup";
import { createTranscriptSource, type TranscriptSource } from "../../../reading/rehearsal";

// The talk's name and whatever proper names the caller can give in advance go in
// as the recognizer's hot words. The desktop's record-and-upload path has
// nowhere to put them and ignores them.
export function openTranscriptSource(glossary: GlossarySource): Promise<TranscriptSource | null> {
  return createTranscriptSource({
    session: { start: startSession, cut: cutSession, stop: stopSession },
    glossary,
  }).catch((e: unknown) => {
    console.warn("no transcript for this rehearsal", e);
    return null;
  });
}
