// Settings, second tab: what the app does with a book once a provider is
// connected. Grouped by where the switch is felt — everywhere, in the reader,
// in the briefing — with plain headings rather than another layer of folds.
//
// Three kinds of setting share this panel, and the difference is where each is
// written. The account's travel between devices (settings.json); this device's
// do not (device.json, docs/36) and are drawn only where they mean something —
// the role and the login item on a desktop, the collection switch on a
// collector; and the paper background is neither, because it has to be readable
// before the first frame is painted (base/paper-tint.ts).

import { hasAutostart } from "../../../platform/app/autostart";
import { roleIsChoosable, type DeviceRole, type DeviceSettings } from "../../../platform/app/device";
import { AI_LANGUAGE_OPTIONS, type AiLanguage, type Settings } from "../../../platform/app/settings";
import { useT } from "../../../i18n";
import { setPaperTint, usePaperTint } from "../base/usePaperTint";
import { setPhoneDisplay, usePhoneDisplay } from "../base/usePhoneDisplay";
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
  phoneReader,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  // Null until device.json has been read. The device cards hold until it lands
  // rather than drawing a checkbox on a default that is about to change.
  device: DeviceSettings | null;
  onDeviceChange: (next: DeviceSettings) => void;
  // The phone shell: its reader's marks switch is drawn here too (docs/82).
  phoneReader?: boolean;
}) {
  const phoneDisplay = usePhoneDisplay();
  // Neither settings.json nor device.json: the tint is kept in localStorage and
  // says why in ui/components/base/paper-tint.ts. It is drawn here anyway,
  // beside the other switches that belong to this machine.
  const paperTint = usePaperTint();
  const t = useT();
  // The languages are named in themselves, as a language picker does; only
  // "auto" is a sentence and needs translating.
  const languageChoices = AI_LANGUAGE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.value === "auto" ? t("settings.features.languageAuto") : o.label,
  }));
  const roleChoices = [
    { value: "collector", label: t("settings.features.roleCollector") },
    { value: "reader", label: t("settings.features.roleReader") },
  ];

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
            <Checkbox
              checked={!!device?.fingerDraw}
              disabled={!device}
              onCheckedChange={(v) =>
                device && onDeviceChange({ ...device, fingerDraw: v === true })
              }
            />
            {t("settings.features.fingerDraw")}
          </Label>
          <p className="m-0 text-xs text-faint-foreground">{t("settings.features.fingerDrawHint")}</p>
        </div>
        {/* The same switch as the reader's Aa sheet, and like it this phone's. */}
        {phoneReader && (
          <div className={CARD}>
            <Label>
              <Checkbox
                checked={phoneDisplay.showMarks}
                onCheckedChange={(v) => setPhoneDisplay({ ...phoneDisplay, showMarks: v === true })}
              />
              {t("settings.features.showMarks")}
            </Label>
            <p className="m-0 text-xs text-faint-foreground">{t("settings.features.showMarksHint")}</p>
          </div>
        )}
      </SettingsSection>

      {/* A reader collects nothing, so there is no schedule to switch off. */}
      {device?.role === "collector" && (
        <SettingsSection title={t("settings.features.briefing")}>
          <div className={CARD}>
            <Label>
              <Checkbox
                checked={device.backgroundCollect}
                onCheckedChange={(v) =>
                  onDeviceChange({ ...device, backgroundCollect: v === true })
                }
              />
              {t("settings.features.collect")}
            </Label>
            <p className="m-0 text-xs text-faint-foreground">{t("settings.features.collectHint")}</p>
          </div>
        </SettingsSection>
      )}

      {/* Nothing here syncs, and none of it exists on a phone. */}
      {device && (roleIsChoosable() || hasAutostart()) && (
        <SettingsSection title={t("settings.features.thisComputer")}>
          {roleIsChoosable() && (
            <div className={CARD}>
              <FieldGrid>
                <ChoiceField
                  label={t("settings.features.role")}
                  value={device.role}
                  choices={roleChoices}
                  onChange={(v) => onDeviceChange({ ...device, role: v as DeviceRole })}
                />
              </FieldGrid>
              <p className="m-0 text-xs text-faint-foreground">{t("settings.features.roleHint")}</p>
            </div>
          )}
          {hasAutostart() && <AutostartCard device={device} onDeviceChange={onDeviceChange} />}
        </SettingsSection>
      )}
    </div>
  );
}
