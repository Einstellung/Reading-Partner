// Which machine hears the rehearsal. Decided once per pass, here rather than in
// the view: the two shapes want different things wired into them and the
// difference is not a button's business.
//
// The desktop records and sends the audio away (desktop-source.ts), so it takes
// the recorder session and needs an STT key. iOS transcribes on device
// (dictated-source.ts), so it takes nothing — it opens the microphone itself,
// no key, no upload. Neither is available everywhere, and no source at all is a
// legal run: what lands on disk is then the shape of the pass with its
// transcript empty (source.ts).

import {
  hasOnDeviceDictation,
  nativeDictation,
  releaseDictationMicrophone,
} from "../../ai/voice/dictation";
import { glossaryTerms, type GlossarySource } from "../../ai/voice/cleanup";
import { loadSettings } from "../../platform/app/settings";
import { createDesktopTranscriptSource } from "./desktop-source";
import { createDictatedTranscriptSource } from "./dictated-source";
import type { RecordingSession } from "./segmented-source";
import type { TranscriptSource } from "./source";

export interface TranscriptSourceHost {
  // Whether this host transcribes on device.
  onDevice: boolean;
  dictated(): Promise<TranscriptSource | null>;
  desktop(): Promise<TranscriptSource | null>;
}

// The branch, on its own so it can be checked without a host. On-device
// dictation and the desktop's record-and-upload are two independent paths and
// not each other's fallback (docs/15): a host that hears the retell itself never
// records a file to send anywhere, and one that cannot dictate has no
// recognizer to fall back to. So the choice is made once and nothing is retried
// down the other side.
export function chooseTranscriptSource(
  host: TranscriptSourceHost,
): Promise<TranscriptSource | null> {
  return host.onDevice ? host.dictated() : host.desktop();
}

export interface TranscriptSourceOptions {
  // The desktop recorder, wired by the caller (ai/voice/recorder.ts). Untouched
  // on a host that dictates on device — nothing is captured to a file there.
  session: RecordingSession;
  // The retell's proper names, built the same way the chat composer's glossary is
  // (ai/voice/cleanup.ts). The on-device recognizer takes them as hot words; the
  // desktop's round trip to an STT host has nowhere to put them and ignores
  // them.
  glossary?: GlossarySource;
}

// The source for the pass about to be given, or null when this host has no way
// to hear it.
export function createTranscriptSource(
  options: TranscriptSourceOptions,
): Promise<TranscriptSource | null> {
  return chooseTranscriptSource({
    onDevice: hasOnDeviceDictation(),
    dictated: async () => {
      // The language is the user's choice and not the device's (docs/15,
      // docs/pitfall/164): a recognizer given the wrong one does not transcribe
      // badly, it invents fluent sentences in the language it was given.
      // Settings that will not load leave it unset, which is the native side's
      // own fallback and not this file's.
      const locale = await loadSettings()
        .then((s) => s.dictationLocale)
        .catch(() => undefined);
      // Hot words. Which retell is being given is known before a word of it is
      // said, so the book's title and the outline's headings go in as
      // contextualStrings — the same list the desktop's cleanup prompt is
      // anchored on, one term at a time as the plugin takes them. Absent rather
      // than empty when there are none (plugins/voice/README.md).
      const terms = glossaryTerms(options.glossary ?? {});
      const dictation = nativeDictation({
        locale,
        contextualStrings: terms.length > 0 ? terms : undefined,
      });
      // Unreachable in production — the same gate answered `onDevice` a moment
      // ago — and a run with no words rather than a guess if the two ever part.
      if (!dictation) return null;
      // The composer releases the microphone when its bar goes away; a
      // rehearsal is the other thing that takes it, and it releases it the same
      // way when the pass is over.
      return createDictatedTranscriptSource({
        dictation,
        release: releaseDictationMicrophone,
      });
    },
    desktop: () => createDesktopTranscriptSource(options.session),
  });
}
