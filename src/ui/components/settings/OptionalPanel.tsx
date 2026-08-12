// Settings, third tab: the things that need a key from someone else. All of it
// is optional — the app works without any of it, one feature quieter each time.
//
// The note at the top is about the two credential keys (voice, illustrations),
// which live in credentials.json and never sync (ai/credentials.ts). The
// Semantic Scholar key is an ordinary setting and does sync, so the note names
// what it covers rather than claiming all three.

import { type Settings } from "../../../platform/app/settings";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";
import IllustrationsCard from "./IllustrationsCard";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";
import VoiceInputCard from "./VoiceInputCard";

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
        Keys for outside services, each of them optional. The transcription and image keys are kept
        with this device's credentials and never sync, so every device needs its own.
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
          <VoiceInputCard settings={settings} onSettingsChange={onSettingsChange} />
        </SettingsSection>

        <SettingsSection title="Illustrations">
          <IllustrationsCard settings={settings} onSettingsChange={onSettingsChange} />
        </SettingsSection>
      </div>
    </>
  );
}
