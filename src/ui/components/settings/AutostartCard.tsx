// Start with the machine. A device setting, not an account one, so it does not
// go through the Settings object the rest of this panel writes — it rides the
// device.json state the panel already holds, and the OS registration is done
// here (platform/app/autostart.ts).

import { setAutostart } from "../../../platform/app/autostart";
import type { DeviceSettings } from "../../../platform/app/device";
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
  const toggle = (next: boolean) => {
    onDeviceChange({ ...device, autostart: next });
    setAutostart(next).catch((e) => console.warn("failed to change autostart", e));
  };

  return (
    <div className={CARD}>
      <Label>
        <Checkbox checked={device.autostart} onCheckedChange={(v) => toggle(v === true)} />
        Start Reading Partner when this computer starts
      </Label>
      <p className="m-0 text-xs text-[#777]">
        Off by default. Turn it on for the machine you want collecting your sources all day —
        together with the tray, it means the briefing is being built whether or not you opened the
        app. This setting belongs to this computer and is not carried to your other devices.
      </p>
    </div>
  );
}
