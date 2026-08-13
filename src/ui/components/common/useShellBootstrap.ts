// What both shells (App, PhoneApp) do on the way up, and nothing about what
// either of them draws: the account settings, this machine's own settings,
// which providers can actually be called, the sync-health verdict, and the six
// store error hooks that are silent until someone registers them.
//
// A .ts file, like useSyncHealth beside it: no JSX here, so the phone rewrite of
// the .tsx layer leaves it alone. The four pure/async pieces are exported on
// their own because that is where the behaviour is — a hook the test can only
// render is a hook whose rules are untested.
//
// What stays in the shells: what a sync pull refreshes (a shelf here, kept
// articles there) and everything the values are drawn with.

import { useCallback, useEffect, useRef, useState } from "react";
import { onSaveError } from "../../../platform/app/annotations";
import { onCorruptFile, type CorruptFileReport } from "../../../platform/app/atomic-fs";
import {
  initDeviceSettings,
  saveDeviceSettings,
  type DeviceSettings,
} from "../../../platform/app/device";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  onSettingsSaveError,
  saveSettings,
  settingsPullAction,
  type Settings,
} from "../../../platform/app/settings";
import { onThreadSaveError } from "../../../platform/app/threads";
import { enforceKnownModel, listProviders, type ProviderInfo } from "../../../ai/aiClient";
import { onFulltextError } from "../../../fulltext";
import { onFiguresError } from "../../../reading/figures";
import type { SyncHealthReport } from "../../../platform/sync";
import type { ToastKind } from "./toast-list";
import { useSyncHealth } from "./useSyncHealth";

// A data file that could not be read, said out loud: a reset shelf or a lost
// provider config must never look like the app forgot on its own. The two
// branches are different promises — one file was moved aside, the other is
// still where it was and will not be written over.
export function corruptFileMessage({ file, savedAs }: CorruptFileReport): string {
  return savedAs
    ? `${file} was unreadable and has been set aside as ${savedAs}`
    : `${file} could not be read; it is left untouched and won't be overwritten`;
}

// Whether the default provider/model actually resolves to something callable.
// A provider id that is no longer in the catalog is as unusable as no provider
// at all, so it counts as unconfigured rather than as a broken call later.
export function isConfigured(settings: Settings, providersInfo: ProviderInfo[]): boolean {
  return !!(
    settings.defaultProviderId &&
    settings.defaultModelId &&
    providersInfo.find((p) => p.id === settings.defaultProviderId)?.configured
  );
}

// The settings a shell starts on. A stored default model the provider's catalog
// no longer carries is corrected here and written back once, with a sentence for
// the user: the app keeps working on a model that resolves, and the swap is
// never silent.
export async function loadShellSettings(): Promise<{ settings: Settings; notice: string | null }> {
  const { settings, notice } = enforceKnownModel(await loadSettings());
  if (notice) saveSettings(settings);
  return { settings, notice };
}

// The sync-health message to show, or null. Once per app start and then never
// again: the point is a user who believes sync is running finding out, not being
// nagged about it every time the verdict is re-evaluated.
export function healthToastMessage(report: SyncHealthReport, alreadyToasted: boolean): string | null {
  if (alreadyToasted || report.alert !== "alert") return null;
  return report.message;
}

export interface ShellBootstrap {
  settings: Settings;
  // A settings change the user made: set and persist.
  applySettings: (settings: Settings) => void;
  // The paths a sync pull just wrote. Where settings.json is among them the
  // copy this shell holds is read back, now or once the settings panel closes
  // (settingsPullAction). Everything else a pull refreshes is the shell's own.
  settingsPulled: (paths: readonly string[]) => void;
  device: DeviceSettings | null;
  applyDevice: (device: DeviceSettings) => void;
  configured: boolean;
  syncReport: SyncHealthReport;
}

export function useShellBootstrap({
  settingsOpen,
  pushToast,
}: {
  // Whether the settings panel is on screen. The provider list is re-read when
  // it closes, since that is when a credential may just have been entered.
  settingsOpen: boolean;
  pushToast: (kind: ToastKind, message: string) => void;
}): ShellBootstrap {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  // This machine's own settings (docs/36), null until device.json has been read.
  // Separate state from `settings` because it is a separate file with separate
  // rules: it never syncs, and it is what says whether this machine collects.
  const [device, setDevice] = useState<DeviceSettings | null>(null);
  const [providersInfo, setProvidersInfo] = useState<ProviderInfo[]>([]);
  // A pull that arrived with the settings panel open. Held rather than dropped:
  // dropping it leaves this shell holding the pre-pull copy, whose next save
  // undoes the merge — the same clobber, narrowed to "the panel was open".
  const pendingPullRef = useRef(false);
  // Read inside the pull callback, which the shells register once and must not
  // have to re-register every time the panel opens.
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;

  useEffect(() => {
    // The failure paths that must not be silent (pitfall 09). Each store keeps
    // one handler, so this is the only place a shell registers them.
    onCorruptFile((report) => pushToast("warn", corruptFileMessage(report)));
    onSettingsSaveError((e) => {
      console.error("failed to persist settings", e);
      pushToast("warn", "Settings could not be saved");
    });
    onSaveError((e) => {
      console.error("failed to persist annotations", e);
      pushToast("warn", "Annotations could not be saved");
    });
    onThreadSaveError((e) => {
      console.error("failed to persist thread", e);
      pushToast("warn", "AI conversation could not be saved");
    });
    // The two derived caches only warn: both are re-extracted from the document
    // when they are missing, so a persistence failure costs work, not data.
    onFulltextError((e) => console.warn("failed to persist fulltext cache", e));
    onFiguresError((e) => console.warn("failed to persist figure index", e));

    loadShellSettings()
      .then(({ settings: next, notice }) => {
        setSettings(next);
        if (notice) pushToast("warn", notice);
      })
      .catch(() => {});
    // This machine's own file (docs/36). Read once here: it decides the role,
    // and everything the role decides waits on it.
    initDeviceSettings()
      .then(setDevice)
      .catch((e) => console.warn("failed to read device settings", e));
  }, [pushToast]);

  // Refresh provider connection state on mount and whenever Settings closes.
  useEffect(() => {
    if (!settingsOpen) listProviders().then(setProvidersInfo).catch(() => {});
  }, [settingsOpen]);

  const adoptPulledSettings = useCallback(() => {
    loadSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  const settingsPulled = useCallback(
    (paths: readonly string[]) => {
      const action = settingsPullAction(paths, settingsOpenRef.current);
      if (action === "adopt") adoptPulledSettings();
      else if (action === "defer") pendingPullRef.current = true;
    },
    [adoptPulledSettings],
  );

  // The deferred read, taken the moment the panel is out of the way.
  useEffect(() => {
    if (settingsOpen || !pendingPullRef.current) return;
    pendingPullRef.current = false;
    adoptPulledSettings();
  }, [settingsOpen, adoptPulledSettings]);

  const syncReport = useSyncHealth();
  const syncToastedRef = useRef(false);
  useEffect(() => {
    const message = healthToastMessage(syncReport, syncToastedRef.current);
    if (!message) return;
    syncToastedRef.current = true;
    pushToast("warn", message);
  }, [syncReport, pushToast]);

  // A change the user made, in either file. The device file is written straight
  // through and is not debounced, so a failure there is worth a warning and
  // nothing more — nothing else in the app is waiting on it.
  const applySettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const applyDevice = useCallback((next: DeviceSettings) => {
    setDevice(next);
    saveDeviceSettings(next).catch((e) => console.warn("failed to persist device settings", e));
  }, []);

  return {
    settings,
    applySettings,
    settingsPulled,
    device,
    applyDevice,
    configured: isConfigured(settings, providersInfo),
    syncReport,
  };
}
