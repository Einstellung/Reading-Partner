// Settings, third tab: the things that need a key from someone else. All of it
// is optional — the app works without any of it, one feature quieter each time.
//
// The note at the top is about the two voice keys, which live in
// credentials.json and never sync (ai/credentials.ts). The Semantic Scholar key
// is an ordinary setting and does sync, so the note names what it covers rather
// than claiming all three.

import { type Settings } from "../../../platform/app/settings";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";
import VoiceInputCard from "./VoiceInputCard";
import DictationLanguageCard from "./DictationLanguageCard";
import SpeechKeyCard from "./SpeechKeyCard";
import MigrationCard from "./MigrationCard";
import ProfileLinesCard from "./ProfileLinesCard";
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
        Keys for outside services, each of them optional. The two voice keys are kept with this
        device's credentials and never sync, so every device needs its own.
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

        <SettingsSection title="Voice output">
          {/* Not under "Voice input" and not conditional: this is the other
              direction, and unlike the two cards above it is the same path on
              every host — the request is made in Rust (plugins/voice). */}
          <SpeechKeyCard />
        </SettingsSection>

        {/* Not a key and not optional in the same sense as the rest of this tab.
            It sits here because it is the one thing in Settings a reader runs
            once and never again, and because it goes away after 0.13. */}
        <SettingsSection title="Data migration">
          <MigrationCard />
          {/* Draws nothing once there is nothing left to carry across, which is
              the state every reader ends in. */}
          <ProfileLinesCard />
        </SettingsSection>
      </div>
    </>
  );
}
