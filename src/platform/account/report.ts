// Account registration (docs/platform/665): after a Google sign-in, and on the
// first start of each day while signed in, the app gets a Supabase session for
// the Google account and reports this device through it. Only with consent
// (on unless turned off) and only when the backend is set; a failure is dropped
// silently and never retried that day. Everything outside this file and
// supabase.ts is injected, so the rules are tested without a host.

import { localDate } from "../std/day";
import {
  exchangeIdToken,
  parseStoredSession,
  refreshSession,
  reportDevice,
  type DeviceInfo,
  type FetchLike,
  type SupabaseBackend,
  type SupabaseSession,
} from "./supabase";

export type { DeviceInfo } from "./supabase";

// account.json, this device's own file: out of the sync range by omission, like
// device.json. Consent is asked for on the device that would do the sending,
// and the Supabase session is this device's credential.
export interface AccountState {
  consent: boolean;
  // The local day ("YYYY-MM-DD") a report last went out, attempted or not.
  lastReportDay: string | null;
  session: SupabaseSession | null;
}

export const DEFAULT_ACCOUNT_STATE: AccountState = {
  consent: true,
  lastReportDay: null,
  session: null,
};

export function parseAccountState(raw: unknown): AccountState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ACCOUNT_STATE };
  const r = raw as Record<string, unknown>;
  return {
    // Only an explicit false turns reporting off.
    consent: r.consent !== false,
    lastReportDay: typeof r.lastReportDay === "string" ? r.lastReportDay : null,
    session: parseStoredSession(r.session),
  };
}

export interface ReportDeps {
  backend: SupabaseBackend;
  loadState: () => Promise<AccountState>;
  saveState: (state: AccountState) => Promise<void>;
  // Null when the device has no identity yet.
  deviceInfo: () => Promise<DeviceInfo | null>;
  fetch: FetchLike;
  now: () => number;
}

async function storeSession(session: SupabaseSession | null, deps: ReportDeps): Promise<void> {
  await deps.saveState({ ...(await deps.loadState()), session });
}

async function send(session: SupabaseSession, deps: ReportDeps): Promise<boolean> {
  const device = await deps.deviceInfo();
  if (!device) return false;
  await reportDevice(deps.backend, session, device, deps.fetch);
  return true;
}

async function sessionFromIdToken(idToken: string, deps: ReportDeps): Promise<SupabaseSession> {
  const session = await exchangeIdToken(deps.backend, idToken, deps.fetch, deps.now());
  await storeSession(session, deps);
  return session;
}

// Right after a sign-in, with that sign-in's id_token. Returns whether the
// device report was accepted; never throws.
export async function reportAfterSignIn(idToken: string | null, deps: ReportDeps): Promise<boolean> {
  try {
    if (!deps.backend.url || !idToken) return false;
    const state = await deps.loadState();
    if (!state.consent) return false;
    await deps.saveState({ ...state, lastReportDay: localDate(deps.now()) });
    return await send(await sessionFromIdToken(idToken, deps), deps);
  } catch {
    return false;
  }
}

// At startup on a signed-in device: once per local day. The day is marked
// before any request so a failure is not tried again until tomorrow. The stored
// session is refreshed (its refresh token rotates, so the new one is kept right
// away); without one, or when the refresh fails, a fresh Google id_token is
// exchanged again. That id_token is fetched only then, since getting one costs
// a Google token refresh. Returns whether the device report was accepted;
// never throws.
export async function reportOnStartup(
  idToken: () => Promise<string | null>,
  deps: ReportDeps,
): Promise<boolean> {
  try {
    if (!deps.backend.url) return false;
    const state = await deps.loadState();
    const today = localDate(deps.now());
    if (!state.consent || state.lastReportDay === today) return false;
    await deps.saveState({ ...state, lastReportDay: today });

    let session: SupabaseSession | null = null;
    if (state.session) {
      try {
        session = await refreshSession(deps.backend, state.session.refreshToken, deps.fetch, deps.now());
        await storeSession(session, deps);
      } catch {
        session = null;
      }
    }
    if (!session) {
      const token = await idToken();
      if (!token) return false;
      session = await sessionFromIdToken(token, deps);
    }
    return await send(session, deps);
  } catch {
    return false;
  }
}

// On signing out of Google: the Supabase session belongs to that account.
export async function clearSession(deps: Pick<ReportDeps, "loadState" | "saveState">): Promise<void> {
  const state = await deps.loadState();
  if (state.session) await deps.saveState({ ...state, session: null });
}
