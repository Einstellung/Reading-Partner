// Settings, second tab: what the app does with a book once a provider is
// connected. Grouped by where the switch is felt — everywhere, in the reader,
// on this computer — with plain headings rather than another layer of folds.
//
// Three kinds of setting share this panel, and the difference is where each is
// written. The account's travel between devices (settings.json); this device's
// do not (device.json, docs/36) and are drawn only where they mean something —
// the login item on a desktop; and the paper background is neither, because it has to be readable
// before the first frame is painted (base/paper-tint.ts).

import { hasAutostart } from "../../../platform/app/autostart";
import type { DeviceSettings } from "../../../platform/app/device";
import { AI_LANGUAGE_OPTIONS, companionNameOf, type AiLanguage, type Settings } from "../../../platform/app/settings";
import { useT } from "../../../i18n";
import { setPaperTint, usePaperTint } from "../base/usePaperTint";
import CompanionNameField from "./CompanionNameField";
import { setCompanionShown, useCompanionShown } from "../companion/use-companion-shown";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import AutostartCard from "./AutostartCard";
import { CARD } from "./cardStyles";
import { ChoiceField, FieldGrid } from "./ChoiceField";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";

export default function FeaturesPanel({
  settings,
  onSettingsChange,
  device,
  onDeviceChange,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  // Null until device.json has been read. The device cards hold until it lands
  // rather than drawing a checkbox on a default that is about to change.
  device: DeviceSettings | null;
  onDeviceChange: (next: DeviceSettings) => void;
}) {
  // Neither settings.json nor device.json: the tint is kept in localStorage and
  // says why in ui/components/base/paper-tint.ts. It is drawn here anyway,
  // beside the other switches that belong to this machine.
  const paperTint = usePaperTint();
  // Also localStorage and also this device's: the same value the sidebar's
  // wordmark and the reader's More menu switch (companion/use-companion-shown.ts).
  const companionShown = useCompanionShown();
  const t = useT();
  const companionName = companionNameOf(settings);
  // The languages are named in themselves, as a language picker does; only
  // "auto" is a sentence and needs translating.
  const languageChoices = AI_LANGUAGE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.value === "auto" ? t("settings.features.languageAuto") : o.label,
  }));

  return (
    <div className={SETTINGS_PANEL}>
      <SettingsSection title={t("settings.features.general")}>
        <div className={CARD}>
          <FieldGrid>
            <ChoiceField
              label={t("settings.features.language")}
              value={settings.aiLanguage}
              choices={languageChoices}
              onChange={(v) => onSettingsChange({ ...settings, aiLanguage: v as AiLanguage })}
            />
          </FieldGrid>
          <p className="m-0 text-xs text-faint-foreground">{t("settings.features.languageHint")}</p>
        </div>

        <div className={CARD}>
          <Label>
            <Checkbox checked={paperTint} onCheckedChange={(v) => setPaperTint(v === true)} />
            {t("settings.features.paper")}
          </Label>
          <p className="m-0 text-xs text-faint-foreground">{t("settings.features.paperHint")}</p>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.features.reading")}>
        <div className={CARD}>
          <Label>
            <Checkbox checked={companionShown} onCheckedChange={(v) => setCompanionShown(v === true)} />
            {t("settings.features.companionShow", { name: companionName })}
          </Label>
          <p className="m-0 text-xs text-faint-foreground">{t("settings.features.companionShowHint", { name: companionName })}</p>
        </div>

        <CompanionNameField settings={settings} onSettingsChange={onSettingsChange} />
      </SettingsSection>

      {/* Nothing here syncs, and none of it exists on a phone. */}
      {device && hasAutostart() && (
        <SettingsSection title={t("settings.features.thisComputer")}>
          <AutostartCard device={device} onDeviceChange={onDeviceChange} />
        </SettingsSection>
      )}
    </div>
  );
}
