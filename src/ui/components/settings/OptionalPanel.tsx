// Settings, third tab: the things that need a key from someone else. All of it
// is optional — the app works without any of it, one feature quieter each time.
//
// The note at the top is about the transcription key, which lives in
// credentials.json and never syncs (ai/credentials.ts). The Semantic Scholar key
// is an ordinary setting and does sync, so the note names what it covers rather
// than claiming both.

import { type Settings } from "../../../platform/app/settings";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";
import VoiceInputCard from "./VoiceInputCard";
import DictationLanguageCard from "./DictationLanguageCard";
import { hasOnDeviceDictation } from "../../../platform/app/platform";

export default function OptionalPanel({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  return (
    <>
      <p className="mt-0 mb-5 text-xs text-[#777]">
        Keys for outside services, each of them optional. The transcription key is kept with this
        device's credentials and never syncs, so every device needs its own.
      </p>

      <div className={SETTINGS_PANEL}>
        <SettingsSection title="Lesson prep">
          <div className={CARD}>
            <Label layout="stack">
              Semantic Scholar API key
              <Input
                type="password"
                placeholder="Optional"
                value={settings.semanticScholarApiKey ?? ""}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    semanticScholarApiKey: e.target.value.trim() || null,
                  })
                }
              />
            </Label>
            <p className="m-0 text-xs text-[#777]">
              A free key from semanticscholar.org avoids the shared rate limits that make paper
              fetching stall.
            </p>
          </div>
        </SettingsSection>

        <SettingsSection title="Voice input">
          {/* One card per voice path, and only the one this machine has. They are
              deliberately separate features (platform.ts): the desktop records a
              WAV and ships it to an STT host, the phone transcribes on device
              with no key at all, and neither is a fallback for the other. */}
          {hasOnDeviceDictation() ? (
            <DictationLanguageCard settings={settings} onSettingsChange={onSettingsChange} />
          ) : (
            <VoiceInputCard settings={settings} onSettingsChange={onSettingsChange} />
          )}
        </SettingsSection>
      </div>
    </>
  );
}
