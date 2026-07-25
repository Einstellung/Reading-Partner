// Public sync surface for the shell. Owns the single engine instance and the
// in-memory status the Settings page and shelf subscribe to. Nothing here runs
// unless Google is configured and the user is signed in with auto-sync (or they
// press Sync now).

import { DriveBackend } from "./driveBackend";
import { SyncEngine } from "./engine";
import { tauriSyncFs } from "./syncFs";
import { tauriBookFs } from "./books";
import { isGoogleConfigured } from "./googleConfig";
import {
  currentEmail,
  getAccessToken,
  isSignedIn,
  signIn,
  signOut,
} from "./auth";
import { emptyState, loadState, saveState, type SyncState } from "./state";

export { isGoogleConfigured } from "./googleConfig";

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  autoSync: boolean;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

let state: SyncState = emptyState();
let engine: SyncEngine | null = null;
let initialized = false;
let signedIn = false;
let email: string | null = null;

const statusListeners = new Set<(s: SyncStatus) => void>();
const pulledListeners = new Set<(paths: string[]) => void>();

function buildStatus(): SyncStatus {
  const s = engine?.status();
  return {
    configured: isGoogleConfigured(),
    signedIn,
    email,
    autoSync: state.autoSync,
    running: s?.running ?? false,
    lastSyncAt: s?.lastSyncAt ?? state.lastSyncAt,
    lastError: s?.lastError ?? state.lastError,
  };
}

function notify(): void {
  const s = buildStatus();
  for (const l of statusListeners) l(s);
}

function makeEngine(): SyncEngine {
  const backend = new DriveBackend({
    getToken: getAccessToken,
    ids: state.drive,
    persistIds: () => saveState(state),
  });
  return new SyncEngine({
    backend,
    fs: tauriSyncFs,
    books: tauriBookFs,
    snapshot: state.snapshot,
    onPulled: (paths) => {
      for (const l of pulledListeners) l(paths);
    },
    onStatus: (r) => {
      state.lastSyncAt = r.lastSyncAt;
      state.lastError = r.lastError;
      void saveState(state);
      notify();
    },
    onSignedOut: () => void handleSignedOut(),
  });
}

function ensureEngine(): SyncEngine {
  if (!engine) engine = makeEngine();
  return engine;
}

// A dead refresh token surfaced mid-pass: drop to signed-out but keep all local
// data and the toggle preference (docs/13). The UI prompts for re-login.
async function handleSignedOut(): Promise<void> {
  engine?.stop();
  engine = null;
  signedIn = false;
  email = null;
  await signOut().catch(() => {});
  notify();
}

export async function initSync(): Promise<void> {
  if (initialized) return;
  initialized = true;
  state = await loadState();
  signedIn = await isSignedIn();
  email = await currentEmail();
  if (isGoogleConfigured() && signedIn && state.autoSync) ensureEngine().start();
  notify();
}

export function subscribeSyncStatus(cb: (s: SyncStatus) => void): () => void {
  statusListeners.add(cb);
  cb(buildStatus());
  return () => statusListeners.delete(cb);
}

// Files written by a pull. The shell refreshes the shelf on topics/library
// changes and drops stale per-book caches.
export function onSyncPulled(cb: (paths: string[]) => void): () => void {
  pulledListeners.add(cb);
  return () => pulledListeners.delete(cb);
}

export async function signInToGoogle(): Promise<void> {
  await signIn();
  signedIn = true;
  email = await currentEmail();
  // Auto-sync defaults on after the first sign-in (docs/13).
  state.autoSync = true;
  await saveState(state);
  ensureEngine().start();
  notify();
}

export async function signOutOfGoogle(): Promise<void> {
  engine?.stop();
  engine = null;
  await signOut();
  signedIn = false;
  email = null;
  // Reset the Drive ids and last-sync snapshot so a different account signing in
  // later starts clean; local data is untouched.
  state.drive = emptyState().drive;
  state.snapshot = {};
  state.lastSyncAt = null;
  state.lastError = null;
  await saveState(state);
  notify();
}

export async function setAutoSyncEnabled(on: boolean): Promise<void> {
  state.autoSync = on;
  await saveState(state);
  if (on && signedIn && isGoogleConfigured()) ensureEngine().start();
  else engine?.stop();
  notify();
}

export async function syncNow(): Promise<void> {
  if (!signedIn || !isGoogleConfigured()) throw new Error("Sign in to Google to sync");
  const e = ensureEngine();
  await e.syncNow();
  if (state.autoSync) e.start();
}
