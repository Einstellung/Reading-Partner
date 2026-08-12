// Start with the machine. A device setting, not an account one, so it does not
// go through the Settings object the rest of this panel writes — it reads and
// writes device.json itself (platform/app/autostart.ts).

import { useEffect, useState } from "react";
import { setAutostart } from "../../../platform/app/autostart";
import { loadDeviceSettings } from "../../../platform/app/device";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { CARD } from "./cardStyles";

export default function AutostartCard() {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    loadDeviceSettings()
      .then((device) => {
        if (!live) return;
        setOn(device.autostart);
        setReady(true);
      })
      .catch(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const toggle = (next: boolean) => {
    setOn(next);
    setAutostart(next).catch((e) => console.warn("failed to change autostart", e));
  };

  return (
    <div className={CARD}>
      <Label>
        <Checkbox
          checked={on}
          disabled={!ready}
          onCheckedChange={(v) => toggle(v === true)}
        />
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
