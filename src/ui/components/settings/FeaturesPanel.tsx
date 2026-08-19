// Settings, second tab: what the app does with a book once a provider is
// connected. Grouped by where the switch is felt — everywhere, in the reader,
// in the briefing — with plain headings rather than another layer of folds.
//
// Two kinds of setting share this panel. The account's travel between devices
// (settings.json); this device's do not (device.json, docs/36) and are drawn
// only where they mean something: the role and the login item on a desktop, the
// collection switch on a collector.

import { hasAutostart } from "../../../platform/app/autostart";
import { roleIsChoosable, type DeviceRole, type DeviceSettings } from "../../../platform/app/device";
import { AI_LANGUAGE_OPTIONS, type AiLanguage, type Settings } from "../../../platform/app/settings";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import AutostartCard from "./AutostartCard";
import { CARD } from "./cardStyles";
import { ChoiceField, FieldGrid } from "./ChoiceField";
import { SETTINGS_PANEL, SettingsSection } from "./SettingsSection";

const ROLE_CHOICES = [
  { value: "collector", label: "Collector — read the sources here" },
  { value: "reader", label: "Reader — read what another machine collected" },
];

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
  return (
    <div className={SETTINGS_PANEL}>
      <SettingsSection title="General">
        <div className={CARD}>
          <FieldGrid>
            <ChoiceField
              label="AI output language"
              value={settings.aiLanguage}
              choices={AI_LANGUAGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) => onSettingsChange({ ...settings, aiLanguage: v as AiLanguage })}
            />
          </FieldGrid>
          <p className="m-0 text-xs text-[#777]">
            The language the AI writes chat replies, notes, slides, and the news briefing in. Auto
            follows the language you write in. Voice transcription always follows what you speak.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Reading">
        <div className={CARD}>
          <Label>
            <Checkbox
              checked={!!device?.fingerDraw}
              disabled={!device}
              onCheckedChange={(v) =>
                device && onDeviceChange({ ...device, fingerDraw: v === true })
              }
            />
            Draw with your finger
          </Label>
          <p className="m-0 text-xs text-[#777]">
            Off, a finger only moves the page and a stylus does the marking, whatever tool is
            selected. Turn it on for a device with no stylus, where the finger has to be able to
            highlight and draw. The navigation lock in the reader still overrides both. Whether
            there is a stylus is a property of this device, so this setting stays on it.
          </p>
        </div>
      </SettingsSection>

      {/* A reader collects nothing, so there is no schedule to switch off. */}
      {device?.role === "collector" && (
        <SettingsSection title="Briefing">
          <div className={CARD}>
            <Label>
              <Checkbox
                checked={device.backgroundCollect}
                onCheckedChange={(v) =>
                  onDeviceChange({ ...device, backgroundCollect: v === true })
                }
              />
              Collect from your sources on this computer
            </Label>
            <p className="m-0 text-xs text-[#777]">
              Each source is checked on its own schedule and what it published is kept until the
              day's briefing is built. Off, this machine stops collecting entirely and another
              collector, if you have one, takes over.
            </p>
          </div>
        </SettingsSection>
      )}

      {/* Nothing here syncs, and none of it exists on a phone. */}
      {device && (roleIsChoosable() || hasAutostart()) && (
        <SettingsSection title="This computer">
          {roleIsChoosable() && (
            <div className={CARD}>
              <FieldGrid>
                <ChoiceField
                  label="This machine is a"
                  value={device.role}
                  choices={ROLE_CHOICES}
                  onChange={(v) => onDeviceChange({ ...device, role: v as DeviceRole })}
                />
              </FieldGrid>
              <p className="m-0 text-xs text-[#777]">
                A collector reads your subscribed sites all day and publishes the briefing for your
                other devices; a reader shows what a collector published and never fetches from a
                site itself. Phones and tablets are always readers. If two machines collect, the
                one that has been running longest does the work.
              </p>
            </div>
          )}
          {hasAutostart() && <AutostartCard device={device} onDeviceChange={onDeviceChange} />}
        </SettingsSection>
      )}
    </div>
  );
}
