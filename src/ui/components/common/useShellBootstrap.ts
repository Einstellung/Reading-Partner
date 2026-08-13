// What both shells (App, PhoneApp) do on the way up, and nothing about what
// either of them draws: the account settings, this machine's own settings,
// which providers can actually be called, the sync-health verdict, and the one
// store-error channel that is silent until someone subscribes to it.
//
// A .ts file, like useSyncHealth beside it: no JSX here, so the phone rewrite of
// the .tsx layer leaves it alone. The four pure/async pieces are exported on
// their own because that is where the behaviour is — a hook the test can only
// render is a hook whose rules are untested.
//
// What stays in the shells: what a sync pull refreshes (a shelf here, kept
// articles there) and everything the values are drawn with.

import { useCallback, useEffect, useRef, useState } from "react";
import { onStoreError } from "../../../platform/app/store-errors";
import {
  registerPullRoute,
  type PullMatcher,
} from "../../../platform/sync/pull-routes";
import {
  initDeviceSettings,
  saveDeviceSettings,
  type DeviceSettings,
} from "../../../platform/app/device";
import {
  DEFAULT_SETTINGS,
  flushSettings,
  loadSettings,
  saveSettings,
  SETTINGS_FILE,
  settingsPullAction,
  type Settings,
} from "../../../platform/app/settings";
import { enforceKnownModel, listProviders, type ProviderInfo } from "../../../ai/aiClient";
import type { SyncHealthReport } from "../../../platform/sync";
import type { ToastKind } from "./toast-list";
import { useSyncHealth } from "./useSyncHealth";

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

// The store, as the two functions below use it. Both take it as an argument so
// their tests can hand them a fake instead of rewriting the module registry
// (pitfall 119).
export interface SettingsAccess {
  load: () => Promise<Settings>;
  save: (settings: Settings) => void;
  flush: () => Promise<void>;
}

const SETTINGS_STORE: SettingsAccess = {
  load: loadSettings,
  save: saveSettings,
  flush: flushSettings,
};

// The settings a shell starts on. A stored default model the provider's catalog
// no longer carries is corrected here and written back once, with a sentence for
// the user: the app keeps working on a model that resolves, and the swap is
// never silent.
export async function loadShellSettings(
  store: SettingsAccess = SETTINGS_STORE,
): Promise<{ settings: Settings; notice: string | null }> {
  const { settings, notice } = enforceKnownModel(await store.load());
  if (notice) store.save(settings);
  return { settings, notice };
}

// The read a pull asks for, taken when the settings panel is out of the way.
// The flush first is the whole of it: saveSettings holds a change for 500ms, so
// a user who edits a field and closes the panel inside that window would
// otherwise be handed the file as it was before the edit — this shell would sit
// on a copy without it, and its next save would take the edit off disk again.
// That is the clobber settingsPullAction exists to close, reached by closing the
// panel quickly instead of by dropping the read.
//
// What the flush cannot recover: this shell's pending copy was read before the
// pull, so writing it out does undo the field the pull merged in. The user's own
// edit wins over the remote one, which is the right way round, and shell and
// disk agree afterwards either way.
export async function pulledSettings(store: SettingsAccess = SETTINGS_STORE): Promise<Settings> {
  await store.flush();
  return store.load();
}

// The sync-health message to show, or null. Once per app start and then never
// again: the point is a user who believes sync is running finding out, not being
// nagged about it every time the verdict is re-evaluated.
export function healthToastMessage(report: SyncHealthReport, alreadyToasted: boolean): string | null {
  if (alreadyToasted || report.alert !== "alert") return null;
  return report.message;
}

// Both shells hold settings.json whole in memory and save it whole, so a field
// another device changed has to be read back or the next save undoes it. The
// route is registered by the hook rather than by each shell: it is the hook that
// knows whether the panel is open, which is the only thing the read waits for.
export const SETTINGS_PULL_ROUTE: PullMatcher = {
  id: "settings",
  matches: (path) => path === SETTINGS_FILE,
};

export interface ShellBootstrap {
  settings: Settings;
  // A settings change the user made: set and persist.
  applySettings: (settings: Settings) => void;
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
    // The failure paths that must not be silent (pitfall 09). One subscription
    // for all of them: every store reports through store-errors.ts, which has
    // already decided what each failure costs the user — a sentence for a lost
    // write, nothing but a log line for a derived cache that will be rebuilt.
    const unsubErrors = onStoreError(({ message }) => {
      if (message) pushToast("warn", message);
    });

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
    return unsubErrors;
  }, [pushToast]);

  // Refresh provider connection state on mount and whenever Settings closes.
  useEffect(() => {
    if (!settingsOpen) listProviders().then(setProvidersInfo).catch(() => {});
  }, [settingsOpen]);

  const adoptPulledSettings = useCallback(() => {
    pulledSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(
    () =>
      registerPullRoute({
        ...SETTINGS_PULL_ROUTE,
        onPulled: (paths) => {
          const action = settingsPullAction(paths, settingsOpenRef.current);
          if (action === "adopt") adoptPulledSettings();
          else if (action === "defer") pendingPullRef.current = true;
        },
      }),
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
    device,
    applyDevice,
    configured: isConfigured(settings, providersInfo),
    syncReport,
  };
}
