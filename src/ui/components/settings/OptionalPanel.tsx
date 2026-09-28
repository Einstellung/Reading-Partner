// Settings, third tab: the things that need a key from someone else. All of it
// is optional — the app works without any of it, one feature quieter each time.
//
// The note at the top is about the two voice keys, which live in
// credentials.json and never sync (ai/auth/credentials.ts). The Semantic Scholar key
// is an ordinary setting and does sync, so the note names what it covers rather
// than claiming all three.

import { type Settings } from "../../../platform/app/settings";
import { useT } from "../../../i18n";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";
import VoiceInputCard from "./VoiceInputCard";
import DictationLanguageCard from "./DictationLanguageCard";
import SpeechKeyCard from "./SpeechKeyCard";
import { hasOnDeviceDictation } from "../../../platform/app/platform";

export default function OptionalPanel({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  const t = useT();
  return (
    <>
      <p className="mt-0 mb-5 text-xs text-faint-foreground">{t("settings.optional.intro")}</p>

      <div className={SETTINGS_PANEL}>
        {/* Not a key, and the one thing on this tab that costs nothing to turn
            on. Off, the app has no meals screen and no entry to one; the data
            it has already written stays where it is (docs/73). */}
        <SettingsSection title={t("settings.optional.meals")}>
          <div className={CARD}>
            <Label>
              <Switch
                checked={settings.meals}
                onCheckedChange={(v) => onSettingsChange({ ...settings, meals: v === true })}
              />
              {t("settings.optional.meals")}
            </Label>
            <p className="m-0 text-xs text-faint-foreground">{t("settings.optional.mealsHint")}</p>
          </div>

        </SettingsSection>

        <SettingsSection title={t("settings.optional.lessonPrep")}>
          <div className={CARD}>
            <Label layout="stack">
              {t("settings.optional.s2Key")}
              <Input
                type="password"
                placeholder={t("settings.optional.s2Placeholder")}
                value={settings.semanticScholarApiKey ?? ""}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    semanticScholarApiKey: e.target.value.trim() || null,
                  })
                }
              />
            </Label>
            <p className="m-0 text-xs text-faint-foreground">{t("settings.optional.s2Hint")}</p>
          </div>
        </SettingsSection>

        <SettingsSection title={t("settings.optional.voiceInput")}>
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

        <SettingsSection title={t("settings.optional.voiceOutput")}>
          {/* Not under "Voice input" and not conditional: this is the other
              direction, and unlike the two cards above it is the same path on
              every host — the request is made in Rust (plugins/voice). */}
          <SpeechKeyCard />
        </SettingsSection>
      </div>
    </>
  );
}
