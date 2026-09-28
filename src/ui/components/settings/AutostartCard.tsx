// Start with the machine. A device setting, not an account one, so it does not
// go through the Settings object the rest of this panel writes — it rides the
// device.json state the panel already holds, and the OS registration is done
// here (platform/app/autostart.ts).

import { setAutostart } from "../../../platform/app/autostart";
import type { DeviceSettings } from "../../../platform/app/device";
import { useT } from "../../../i18n";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";

export default function AutostartCard({
  device,
  onDeviceChange,
}: {
  device: DeviceSettings;
  onDeviceChange: (next: DeviceSettings) => void;
}) {
  // The stored intent goes through the panel's state like every other device
  // setting; the login-item registration is the extra half only this switch has.
  const t = useT();
  const toggle = (next: boolean) => {
    onDeviceChange({ ...device, autostart: next });
    setAutostart(next).catch((e) => console.warn("failed to change autostart", e));
  };

  return (
    <div className={CARD}>
      <Label>
        <Checkbox checked={device.autostart} onCheckedChange={(v) => toggle(v === true)} />
        {t("settings.features.autostart")}
      </Label>
      <p className="m-0 text-xs text-faint-foreground">{t("settings.features.autostartHint")}</p>
    </div>
  );
}
