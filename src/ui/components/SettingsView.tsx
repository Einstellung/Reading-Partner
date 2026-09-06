// Settings: a page of the content area, with the sidebar still beside it and
// the Settings row at its foot lit (docs/51). What each of the three tabs holds
// is argued in settings/AccountPanel, settings/FeaturesPanel and
// settings/OptionalPanel; this file is the page, the sub-nav, and the footer.
//
// The page is a screen like Today and the briefing: `absolute inset-0` over the
// column beside the sidebar, one scroller, nothing fixed. Escape and the
// sidebar are the way out, so there is no Done button — App puts the previous
// screen back (docs/51).
//
// SettingsBody is exported for SettingsDialog, the full-screen form the phone
// and the reader still use: neither of them has a sidebar to show a page
// beside.
//
// The sub-nav is breakpoints, not two components: a 200px column of rows from
// `lg` up, a scrollable row of chips below it, and both shapes are the same
// three triggers. Radix's `orientation` is a prop and cannot follow a media
// query, so it stays vertical — that decides which arrow keys walk the strip,
// and the wide shape is the one with a keyboard on it.

import { useEffect, useState } from "react";

import { LICENSE_NAME, readAppVersion, UNPACKAGED_VERSION } from "../../platform/app/version";
import { type Settings } from "../../platform/app/settings";
import { type DeviceSettings } from "../../platform/app/device";
import AccountPanel from "./settings/AccountPanel";
import FeaturesPanel from "./settings/FeaturesPanel";
import OptionalPanel from "./settings/OptionalPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface SettingsBodyProps {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  // This machine's own settings (docs/36), null until device.json has been read.
  // A second file with second rules, so it travels as its own pair rather than
  // being folded into Settings.
  device: DeviceSettings | null;
  onDeviceChange: (next: DeviceSettings) => void;
}

// The column the page is set in, the same measurements as Today's (Vestibule):
// 32px top and bottom, 40px sides on a landscape tablet and 32 on a portrait
// one, where the sidebar has already taken 52px. No max width on the whole
// page — the cards column carries its own.
const PAGE = "w-full px-8 py-8 lg:px-10";
const EYEBROW = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

// The sub-nav. Wide: a 200px column of rows. Narrow: a row of chips that
// scrolls sideways rather than wrapping, so the cards keep the top of the page.
// The list's own pill fill and padding come off in both shapes.
const SUBNAV =
  "shrink-0 justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 " +
  "lg:w-[200px] lg:flex-col lg:items-stretch lg:overflow-visible";

// A row of that column, or a chip of that strip. `flex-none` displaces the
// primitive's `flex-1`, which in a column would divide the sub-nav's height
// between the three of them and in the strip would stretch the chips instead of
// letting them scroll. The active one takes the neutral chip fill the sidebar
// and the reader's panels use, so every list of destinations in the app reads
// alike.
const SUBNAV_ROW =
  "min-h-11 flex-none justify-start rounded-md px-3 text-[14px] font-normal text-muted-foreground " +
  "data-[state=active]:bg-secondary data-[state=active]:font-medium " +
  "data-[state=active]:text-secondary-foreground data-[state=active]:shadow-none";

const TABS = [
  { value: "account", label: "Account" },
  { value: "features", label: "Features" },
  { value: "optional", label: "Optional" },
];

export default function SettingsView(props: SettingsBodyProps) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-background">
      <div className={PAGE}>
        <div className={EYEBROW}>Settings</div>
        <h1 className="mb-6 mt-1 font-display text-[30px] font-semibold text-foreground">
          Settings
        </h1>
        <SettingsBody {...props} />
      </div>
    </div>
  );
}

// The sub-nav and the cards, in both forms of the page. The version line sits
// under the cards rather than under the whole thing: it belongs to the column
// it follows.
export function SettingsBody({
  settings,
  onSettingsChange,
  device,
  onDeviceChange,
}: SettingsBodyProps) {
  return (
    <Tabs
      defaultValue="account"
      orientation="vertical"
      className="flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:gap-8"
    >
      <TabsList className={SUBNAV}>
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className={SUBNAV_ROW}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="min-w-0 max-w-[720px] flex-1">
        <TabsContent value="account">
          <AccountPanel settings={settings} onSettingsChange={onSettingsChange} />
        </TabsContent>
        <TabsContent value="features">
          <FeaturesPanel
            settings={settings}
            onSettingsChange={onSettingsChange}
            device={device}
            onDeviceChange={onDeviceChange}
          />
        </TabsContent>
        <TabsContent value="optional">
          <OptionalPanel settings={settings} onSettingsChange={onSettingsChange} />
        </TabsContent>

        <VersionLine />
      </div>
    </Tabs>
  );
}

// The version of the bundle this is running in, plus the licence it ships under.
// Async because only the host knows the version; until it answers, and in a
// browser where nothing will, the label stands in.
function VersionLine() {
  const [version, setVersion] = useState(UNPACKAGED_VERSION);

  useEffect(() => {
    let live = true;
    void readAppVersion().then((v) => {
      if (live) setVersion(v);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <p className="m-0 pt-4 text-xs text-faint-foreground">
      Reading Partner {version} · {LICENSE_NAME}
    </p>
  );
}
