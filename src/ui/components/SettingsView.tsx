// Settings: the shell around three tabs. What each of them holds is argued in
// settings/AccountPanel, settings/FeaturesPanel and settings/OptionalPanel; this
// file is the frame, the tab strip, and the footer.
//
// A full-screen Dialog (docs/30, fourth pass): the shell still mounts and
// unmounts it, so `open` is constant and onOpenChange only ever reports the
// close Radix decides on — Escape. What the dialog buys is the focus trap, an
// aria-hidden screen behind, and that Escape.
//
// The height chain. The page box is `fixed inset-0` with a scroller of its own,
// so the column inside it takes `h-full` and becomes a flex column: title row
// and footer fixed, the tabs in between as `min-h-0 flex-1`, and the panel the
// only thing that scrolls. Drop the `min-h-0` anywhere along that chain and the
// flex item refuses to shrink below its content, the page scroller takes over,
// and the tab strip scrolls away with the panel.
//
// The layout is breakpoints, not two components: the strip is a column beside
// the panel from `sm` up and a row above it below that, and both shapes are the
// same three triggers. Radix's `orientation` is a prop and cannot follow a media
// query, so it stays vertical — that decides which arrow keys walk the strip,
// and the wide shape is the one with a keyboard on it.

import { useEffect, useState } from "react";

import { LICENSE_NAME, readAppVersion, UNPACKAGED_VERSION } from "../../platform/app/version";
import { type Settings } from "../../platform/app/settings";
import { cn } from "./lib/utils";
import AccountPanel from "./settings/AccountPanel";
import FeaturesPanel from "./settings/FeaturesPanel";
import OptionalPanel from "./settings/OptionalPanel";
import { Button } from "./ui/button";
import { Dialog, DialogFullScreenContent, DialogTitle } from "./ui/dialog";
import { OVERLAY_SAFE } from "./ui/overlay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

interface SettingsViewProps {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  onClose: () => void;
}

const TAB_PANEL = "min-h-0 min-w-0 flex-1 overflow-y-auto";

export default function SettingsView({ settings, onSettingsChange, onClose }: SettingsViewProps) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogFullScreenContent aria-describedby={undefined}>
        {/* The page is fixed, so the shell's safe-area padding does not reach
            it and the title row and Done would sit under the notch
            (docs/pitfall/74). OVERLAY_SAFE.fullscreen is that inset, on the
            column rather than on the page, so the white still runs to the edge
            of the screen. */}
        <div
          className={cn(
            OVERLAY_SAFE.fullscreen,
            "mx-auto flex h-full w-[min(680px,100%)] flex-col",
          )}
        >
          <div className="mb-6 flex shrink-0 items-center justify-between">
            {/* The classes belong on DialogTitle, not on the <h1>: asChild
                merges the two className strings by concatenating them, so a
                class written on the child does not displace the default it
                contradicts — it only races it in the stylesheet. On DialogTitle
                they go through cn() and the default is gone. */}
            <DialogTitle asChild className="m-0 text-[22px] leading-normal font-bold">
              <h1>Settings</h1>
            </DialogTitle>
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>

          <Tabs
            defaultValue="account"
            orientation="vertical"
            className="min-h-0 flex-1 flex-col sm:flex-row sm:gap-5"
          >
            <TabsList className="shrink-0 sm:w-40 sm:flex-col sm:items-stretch sm:self-start">
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="features">Features</TabsTrigger>
              <TabsTrigger value="optional">Optional</TabsTrigger>
            </TabsList>

            <TabsContent value="account" className={TAB_PANEL}>
              <AccountPanel settings={settings} onSettingsChange={onSettingsChange} />
            </TabsContent>
            <TabsContent value="features" className={TAB_PANEL}>
              <FeaturesPanel settings={settings} onSettingsChange={onSettingsChange} />
            </TabsContent>
            <TabsContent value="optional" className={TAB_PANEL}>
              <OptionalPanel settings={settings} onSettingsChange={onSettingsChange} />
            </TabsContent>
          </Tabs>

          <VersionLine />
        </div>
      </DialogFullScreenContent>
    </Dialog>
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
    <p className="m-0 shrink-0 pt-4 text-center text-xs text-[#999]">
      Reading Partner {version} · {LICENSE_NAME}
    </p>
  );
}
