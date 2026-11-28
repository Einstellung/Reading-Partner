// The license gate bound to the host (docs/platform/713): the Supabase session
// from account.json, the http plugin, WebCrypto, license.json in AppData, the
// Google sign-in, and the window's foreground edge. Nothing here runs while
// LICENSING_ENABLED is false (config.ts): the gate is created, never started.

import { appData } from "../app/appdata";
import { writeTextAtomic } from "../app/atomic-fs";
import { observeAppLifecycle } from "../app/lifecycle";
import { cleanTauriFetch } from "../app/tauri-fetch";
import { ACCOUNT_BACKEND, accountSession } from "../account";
import {
  isGoogleConfigured,
  signInToGoogle,
  signOutOfGoogle,
  subscribeSyncStatus,
} from "../sync";
import { freshIdToken } from "../sync/auth";
import { checkLicense, requestAccountDeletion, type CheckDeps } from "./check";
import { LICENSE_PUBLIC_KEY, LICENSING_ENABLED } from "./config";
import { createLicenseGate } from "./gate";
import { purchaseHandlers } from "./store-handlers";

export { APPLE_SIGN_IN_AVAILABLE, LIFETIME_PRICE, LICENSING_ENABLED } from "./config";
export { lockActions, type GateView, type LockAction, type LockReason } from "./decide";
export type { ActionError, ActionResult, LicenseGate } from "./gate";

const LICENSE_FILE = "license.json";

const checkDeps: CheckDeps = {
  backend: ACCOUNT_BACKEND,
  publicKey: LICENSE_PUBLIC_KEY,
  signInAvailable: isGoogleConfigured(),
  session: (opts) => accountSession(freshIdToken, opts),
  fetch: (url, init) => cleanTauriFetch(url, init),
  subtle: globalThis.crypto.subtle,
  readCache: async () =>
    (await appData.exists(LICENSE_FILE)) ? appData.readText(LICENSE_FILE) : null,
  writeCache: (text) => writeTextAtomic(LICENSE_FILE, text),
  now: Date.now,
};

// Fires when the Google sign-in flips, not on every sync status change.
function observeSignIn(onChange: () => void): () => void {
  let last: boolean | null = null;
  return subscribeSyncStatus((status) => {
    if (last !== null && status.signedIn !== last) onChange();
    last = status.signedIn;
  });
}

export const licenseGate = createLicenseGate({
  enabled: LICENSING_ENABLED,
  check: () => checkLicense(checkDeps),
  now: Date.now,
  observeForeground: (onForeground) =>
    observeAppLifecycle(window, { onForeground, onBackground: () => {} }),
  observeSignIn,
  signIn: signInToGoogle,
  signOut: async () => {
    await signOutOfGoogle();
    await appData.remove(LICENSE_FILE).catch(() => {});
  },
  deleteAccount: () => requestAccountDeletion(checkDeps),
  purchases: purchaseHandlers,
});
