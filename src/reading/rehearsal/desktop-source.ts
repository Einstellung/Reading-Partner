// The segmented source with the app's own STT behind it (docs/15, docs/43).
// Nothing here decides anything: the cutting rules are in segmented-source.ts
// and the transport is the voice line's.
//
// The recording session is a parameter rather than an import. The Rust commands
// behind it (start / cut / stop, one continuous capture, src-tauri/src/voice.rs)
// are wrapped in ai/voice/recorder.ts, and the call site that has the deck on
// screen is what hands them over — which is also what keeps every rule in this
// unit testable without a microphone.

import { loadSttConfig, sttFetch, transcribe } from "../../ai/voice";
import { createSegmentedTranscriptSource, type RecordingSession } from "./segmented-source";
import type { TranscriptSource } from "./source";

// Null when no STT key is set. The rehearsal then records pages and no words,
// which is a run (source.ts) and not a failure to report.
export async function createDesktopTranscriptSource(
  session: RecordingSession,
): Promise<TranscriptSource | null> {
  // Once for the run. A key edited halfway through a rehearsal is not worth a
  // reload per page turn.
  const config = await loadSttConfig();
  if (!config) return null;
  return createSegmentedTranscriptSource({
    session,
    transcribe: (wav) => transcribe(config, wav, sttFetch),
  });
}
