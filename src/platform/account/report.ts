// Account registration (docs/platform/665): after a Google sign-in, and on the
// first start of each day while signed in, the app sends the account's id_token
// and this device's description to our server. Only with the user's consent and
// only when the endpoint is set; a failure is dropped silently and never
// retried. Everything outside this file is injected, so the rules are tested
// without a host.

import { localDate } from "../std/day";

export interface DeviceInfo {
  id: string;
  platform: string;
  osVersion: string | null;
  model: string | null;
  appVersion: string;
}

// account.json, this device's own file: out of the sync range by omission, like
// device.json. Consent is asked for on the device that would do the sending.
export interface AccountState {
  consent: boolean;
  // The local day ("YYYY-MM-DD") a report last went out, attempted or not.
  lastReportDay: string | null;
}

export const DEFAULT_ACCOUNT_STATE: AccountState = { consent: false, lastReportDay: null };

export function parseAccountState(raw: unknown): AccountState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ACCOUNT_STATE };
  const r = raw as Record<string, unknown>;
  return {
    consent: r.consent === true,
    lastReportDay: typeof r.lastReportDay === "string" ? r.lastReportDay : null,
  };
}

export interface ReportDeps {
  endpoint: string;
  loadState: () => Promise<AccountState>;
  saveState: (state: AccountState) => Promise<void>;
  // Null when the device has no identity yet.
  deviceInfo: () => Promise<DeviceInfo | null>;
  post: (url: string, body: string) => Promise<unknown>;
  now: () => number;
}

export function registerUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/api/register`;
}

async function send(idToken: string, deps: ReportDeps): Promise<boolean> {
  const device = await deps.deviceInfo();
  if (!device) return false;
  await deps.post(registerUrl(deps.endpoint), JSON.stringify({ idToken, device }));
  return true;
}

// Right after a sign-in, with that sign-in's id_token. Returns whether a request
// went out; never throws.
export async function reportAfterSignIn(idToken: string | null, deps: ReportDeps): Promise<boolean> {
  try {
    if (!deps.endpoint || !idToken) return false;
    const state = await deps.loadState();
    if (!state.consent) return false;
    await deps.saveState({ ...state, lastReportDay: localDate(deps.now()) });
    return await send(idToken, deps);
  } catch {
    return false;
  }
}

// At startup on a signed-in device: once per local day. The day is marked
// before the request so a failure is not tried again until tomorrow. The
// id_token is fetched only once every other gate has passed, since getting one
// costs a token refresh. Returns whether a request went out; never throws.
export async function reportOnStartup(
  idToken: () => Promise<string | null>,
  deps: ReportDeps,
): Promise<boolean> {
  try {
    if (!deps.endpoint) return false;
    const state = await deps.loadState();
    const today = localDate(deps.now());
    if (!state.consent || state.lastReportDay === today) return false;
    await deps.saveState({ ...state, lastReportDay: today });
    const token = await idToken();
    if (!token) return false;
    return await send(token, deps);
  } catch {
    return false;
  }
}
