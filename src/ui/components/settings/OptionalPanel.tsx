// Settings, third tab: the things that need a key from someone else. All of it
// is optional — the app works without any of it, one feature quieter each time.
//
// The note at the top is about the two voice keys, which live in
// credentials.json and never sync (ai/auth/credentials.ts). The Semantic Scholar key
// is an ordinary setting and does sync, so the note names what it covers rather
// than claiming all three.

import { useSyncExternalStore } from "react";
import { type Settings } from "../../../platform/app/settings";
import { useT } from "../../../i18n";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";
import VoiceInputCard from "./VoiceInputCard";
import DictationLanguageCard from "./DictationLanguageCard";
import OnDeviceVoiceCard from "./OnDeviceVoiceCard";
import { hasNativeSpeech, hasOnDeviceDictation } from "../../../platform/app/platform";
import { subscribeVoiceCapability } from "../../../platform/app/voice-capability";
import { isCallVoice } from "./on-device-voice";

export default function OptionalPanel({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
}) {
  const t = useT();
  const speaks = useSyncExternalStore(subscribeVoiceCapability, hasNativeSpeech);
  return (
    <>
      <p className="mt-0 mb-5 text-xs text-faint-foreground">{t("settings.optional.intro")}</p>

      {/* Meals used to have its switch here; it is the Meals experiment now
          (settings/ExperimentsPanel). */}
      <div className={SETTINGS_PANEL}>
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
          <div className={CARD}>
            <Label layout="stack">
              {t("settings.optional.openAlexKey")}
              <Input
                type="password"
                placeholder={t("settings.optional.openAlexPlaceholder")}
                value={settings.openAlexApiKey ?? ""}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    openAlexApiKey: e.target.value.trim() || null,
                  })
                }
              />
            </Label>
            <p className="m-0 text-xs text-faint-foreground">{t("settings.optional.openAlexHint")}</p>
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

        {/* Not under "Voice input": this is the other direction. Only a host
            that speaks (iOS, plugins/voice) has it: the voice runs on the
            device and needs its weights downloaded once. Elsewhere nothing
            reads answers aloud, so there is nothing to set. */}
        {speaks && (
          <SettingsSection
            title={t(isCallVoice() ? "settings.optional.voiceCall" : "settings.optional.voiceOutput")}
          >
            <OnDeviceVoiceCard />
          </SettingsSection>
        )}
      </div>
    </>
  );
}
