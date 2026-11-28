// The account registration bound to the host (docs/platform/665): account.json
// in AppData, this device's identity and description, and the http plugin.
// platform/sync calls the two report functions and clears the session on
// sign-out; a consent screen would call setAccountConsent; the license check
// (platform/license, docs/platform/713) asks for a session through
// accountSession.

import { invoke } from "@tauri-apps/api/core";
import { version as osVersion } from "@tauri-apps/plugin-os";
import { appData } from "../app/appdata";
import { writeTextAtomic } from "../app/atomic-fs";
import { currentDeviceId } from "../app/device";
import { currentPlatform } from "../app/platform";
import { cleanTauriFetch } from "../app/tauri-fetch";
import { readAppVersion } from "../app/version";
import { ACCOUNT_BACKEND } from "./endpoint";
import {
  clearSession,
  parseAccountState,
  reportAfterSignIn as reportAfterSignInWith,
  reportOnStartup as reportOnStartupWith,
  type AccountState,
  type DeviceInfo,
  type ReportDeps,
} from "./report";
import { ensureSession, type SessionOutcome } from "./session";
import type { SupabaseSession } from "./supabase";

export { ACCOUNT_BACKEND } from "./endpoint";
export { functionUrl, type FetchLike, type SupabaseBackend, type SupabaseSession } from "./supabase";
export type { SessionOutcome } from "./session";

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
  backend: ACCOUNT_BACKEND,
  loadState,
  saveState,
  deviceInfo,
  fetch: (url, init) => cleanTauriFetch(url, init),
  now: Date.now,
};

export async function hasAccountConsent(): Promise<boolean> {
  return (await loadState()).consent;
}

// Whether the registration may run. On unless this has been set to false.
export async function setAccountConsent(consent: boolean): Promise<void> {
  await saveState({ ...(await loadState()), consent });
}

export function reportAfterSignIn(idToken: string | null): Promise<boolean> {
  return reportAfterSignInWith(idToken, deps);
}

export function reportOnStartup(idToken: () => Promise<string | null>): Promise<boolean> {
  return reportOnStartupWith(idToken, deps);
}

async function storeSession(session: SupabaseSession): Promise<void> {
  await saveState({ ...(await loadState()), session });
}

// A usable Supabase session regardless of consent (session.ts). `idToken` is
// platform/sync's freshIdToken, handed in because sync imports this directory.
// Never throws.
export function accountSession(
  idToken: () => Promise<string | null>,
  opts: { forceRefresh?: boolean } = {},
): Promise<SessionOutcome> {
  return ensureSession(
    {
      backend: ACCOUNT_BACKEND,
      loadSession: async () => (await loadState()).session,
      storeSession,
      idToken,
      fetch: deps.fetch,
      now: deps.now,
    },
    opts,
  );
}

// Drops the stored Supabase session. Never throws.
export async function clearAccountSession(): Promise<void> {
  await clearSession(deps).catch(() => {});
}
