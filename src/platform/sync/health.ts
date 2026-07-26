// What the app should say about sync, decided from the sync state alone.
//
// The state this exists for: auto-sync reads on, the credentials file is gone,
// so the engine never starts — and nothing anywhere says so. lastError stays
// null because no pass ever ran to fail, the Settings card shows the generic
// "sign in" pitch, and the user keeps working for days believing the data is
// mirrored (docs/pitfall/51).
//
// The other half of the design is what stays quiet. Never configured, auto-sync
// off, and a deliberate sign-out are not failures and get no dot and no toast.
// A deliberate sign-out is told apart from a lost credential by lastSyncAt:
// signOutOfGoogle clears it, a credential that disappears under a running setup
// leaves it behind. One failed pass is a notice (usually just offline); only a
// state that will not fix itself is an alert.

export type SyncHealth =
  // initSync has not finished; nothing is known yet.
  | "unknown"
  // No Google client in the build. Not a failure.
  | "not-configured"
  // Signed out and nothing was ever synced from this device. The user's choice.
  | "signed-out"
  // Signed in, auto-sync deliberately off. The user's choice.
  | "auto-sync-off"
  // Auto-sync on, first pass not finished yet.
  | "pending"
  | "ok"
  // A pass failed but a recent one succeeded. Usually offline.
  | "failing"
  // Auto-sync on, engine running, and this device has never completed a pass.
  // Told apart from "stalled" because there is no duration to report: a device
  // signed in ten minutes ago has the same lastSyncAt as one that has been
  // failing for a month, and claiming a day either way is a made-up fact.
  | "never-synced"
  // Auto-sync on, engine running, no successful pass for a long time.
  | "stalled"
  // Auto-sync on, no credentials: nothing is syncing and nothing will.
  | "credentials-missing"
  // Auto-sync on, signed in, engine not running anyway.
  | "engine-stopped";

// none: say nothing. notice: a dot on the Settings affordance. alert: the dot
// plus one toast per app start.
export type SyncAlert = "none" | "notice" | "alert";

export interface SyncHealthInput {
  configured: boolean;
  signedIn: boolean;
  autoSync: boolean;
  // Whether the ticking engine is actually started.
  engineStarted: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  // When initSync ran, or null before it did.
  startedAt: number | null;
  now: number;
}

export interface SyncHealthReport {
  health: SyncHealth;
  alert: SyncAlert;
  // One user-facing line, or null when there is nothing to say.
  message: string | null;
}

// How long after startup before a stale lastSyncAt counts as a fault. The app
// may have been closed for a week, which makes lastSyncAt old through no fault
// of the engine; the first pass runs immediately on start, so anything still
// unsynced this long after startup is a real failure.
export const SYNC_GRACE_MS = 10 * 60_000;

// How long without a successful pass counts as stalled. Well past a closed lid
// or an afternoon of bad wifi, well inside the four days the reported outage
// went unnoticed.
export const SYNC_STALE_MS = 24 * 60 * 60_000;

function quiet(health: SyncHealth): SyncHealthReport {
  return { health, alert: "none", message: null };
}

export function syncHealth(input: SyncHealthInput): SyncHealthReport {
  const { configured, signedIn, autoSync, engineStarted, lastSyncAt, lastError, startedAt, now } =
    input;

  if (startedAt === null) return quiet("unknown");
  if (!configured) return quiet("not-configured");

  if (!signedIn) {
    // Auto-sync on and this device has synced before: the credentials went away
    // under a setup that believes it is syncing.
    if (autoSync && lastSyncAt !== null) {
      return {
        health: "credentials-missing",
        alert: "alert",
        message: "Auto-sync is on but this device is signed out of Google — nothing is syncing.",
      };
    }
    return quiet("signed-out");
  }

  if (!autoSync) return quiet("auto-sync-off");

  if (!engineStarted) {
    return {
      health: "engine-stopped",
      alert: "alert",
      message: "Auto-sync is on but the sync engine is not running.",
    };
  }

  const settled = now - startedAt >= SYNC_GRACE_MS;

  if (settled && lastSyncAt === null) {
    return {
      health: "never-synced",
      alert: "alert",
      message: lastError
        ? `This device has never completed a sync. Last error: ${lastError}`
        : "This device has never completed a sync.",
    };
  }

  if (settled && lastSyncAt !== null && now - lastSyncAt >= SYNC_STALE_MS) {
    return {
      health: "stalled",
      alert: "alert",
      message: lastError
        ? `No sync has succeeded for over a day. Last error: ${lastError}`
        : "No sync has succeeded for over a day.",
    };
  }

  if (lastError) {
    return { health: "failing", alert: "notice", message: `Last sync failed: ${lastError}` };
  }

  if (lastSyncAt === null) return quiet("pending");
  return quiet("ok");
}

// What startup should do with the engine.
export type SyncStartAction =
  // Credentials and the toggle agree: run.
  | "start"
  // Auto-sync is on, there are no credentials, and this device has synced
  // before. Nothing will run, and no pass will ever record why, so startup has
  // to write the reason itself.
  | "record-stopped"
  // Nothing to run and nothing to report.
  | "idle";

export function syncStartAction(state: {
  configured: boolean;
  signedIn: boolean;
  autoSync: boolean;
  lastSyncAt: number | null;
}): SyncStartAction {
  if (!state.configured || !state.autoSync) return "idle";
  if (state.signedIn) return "start";
  return state.lastSyncAt === null ? "idle" : "record-stopped";
}
