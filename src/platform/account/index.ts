// The account registration bound to the host (docs/platform/665): account.json
// in AppData, this device's identity and description, and the http plugin.
// platform/sync calls the two report functions; the consent screen calls
// setAccountConsent.

import { invoke } from "@tauri-apps/api/core";
import { version as osVersion } from "@tauri-apps/plugin-os";
import { appData } from "../app/appdata";
import { writeTextAtomic } from "../app/atomic-fs";
import { currentDeviceId } from "../app/device";
import { currentPlatform } from "../app/platform";
import { cleanTauriFetch } from "../app/tauri-fetch";
import { readAppVersion } from "../app/version";
import { ACCOUNT_ENDPOINT } from "./endpoint";
import {
  parseAccountState,
  reportAfterSignIn as reportAfterSignInWith,
  reportOnStartup as reportOnStartupWith,
  type AccountState,
  type DeviceInfo,
  type ReportDeps,
} from "./report";

const ACCOUNT_FILE = "account.json";

async function loadState(): Promise<AccountState> {
  try {
    if (!(await appData.exists(ACCOUNT_FILE))) return parseAccountState(null);
    return parseAccountState(JSON.parse(await appData.readText(ACCOUNT_FILE)));
  } catch {
    return parseAccountState(null);
  }
}

function saveState(state: AccountState): Promise<void> {
  return writeTextAtomic(ACCOUNT_FILE, JSON.stringify(state, null, 2));
}

function readOsVersion(): string | null {
  try {
    return osVersion() || null;
  } catch {
    return null;
  }
}

// The hardware model from the Rust side (src-tauri/src/device_model.rs), e.g.
// "iPad14,1". Null where the host has no answer.
async function readModel(): Promise<string | null> {
  try {
    return (await invoke<string | null>("device_model")) ?? null;
  } catch {
    return null;
  }
}

async function deviceInfo(): Promise<DeviceInfo | null> {
  const id = currentDeviceId();
  if (!id) return null;
  return {
    id,
    platform: currentPlatform(),
    osVersion: readOsVersion(),
    model: await readModel(),
    appVersion: await readAppVersion(),
  };
}

const deps: ReportDeps = {
  endpoint: ACCOUNT_ENDPOINT,
  loadState,
  saveState,
  deviceInfo,
  post: (url, body) =>
    cleanTauriFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }),
  now: Date.now,
};

export async function hasAccountConsent(): Promise<boolean> {
  return (await loadState()).consent;
}

// Whether the user has agreed to the privacy policy that covers the
// registration. Nothing is reported until this has been set to true.
export async function setAccountConsent(consent: boolean): Promise<void> {
  await saveState({ ...(await loadState()), consent });
}

export function reportAfterSignIn(idToken: string | null): Promise<boolean> {
  return reportAfterSignInWith(idToken, deps);
}

export function reportOnStartup(idToken: () => Promise<string | null>): Promise<boolean> {
  return reportOnStartupWith(idToken, deps);
}
