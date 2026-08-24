// Public sync surface for the shell. Owns the single engine instance and the
// in-memory status the Settings page and shelf subscribe to. Nothing here runs
// unless Google is configured and the user is signed in with auto-sync (or they
// press Sync now).
//
// "Not running" is a state of its own, not the absence of one: whether the
// engine started and why it did not are both part of the status, and health.ts
// turns them into what the user is told.
//
// This is also where the engine meets the host: the shell it was mounted in
// (which decides whether books travel at all) and the window's foreground and
// background edges, both kept out of the pass itself.

import { observeAppLifecycle } from "../app/lifecycle";
import type { Shell } from "../app/shell";
import { DriveBackend } from "./driveBackend";
import { SyncEngine, type EngineDeps } from "./engine";
import { dispatchPull } from "./pull-routes";
import { tauriSyncFs } from "./syncFs";
import { tauriBookFs } from "./books";
import { tauriBaseStore, tauriTrashJournal } from "./localStore";
import { isGoogleConfigured } from "./googleConfig";
import {
  currentEmail,
  getAccessToken,
  isSignedIn,
  signIn,
  signOut,
} from "./auth";
import { nextGraceSince, syncStartAction } from "./health";
import {
  emptyState,
  loadState,
  recordPassResult,
  saveState,
  type SyncState,
} from "./state";

export { isGoogleConfigured } from "./googleConfig";
export {
  syncHealth,
  SYNC_GRACE_MS,
  SYNC_STALE_MS,
  type SyncAlert,
  type SyncHealth,
  type SyncHealthReport,
} from "./health";

// Written into sync-state.json when auto-sync is on and the engine cannot run.
// A null lastError next to autoSync:true reads as healthy, which is what let a
// stopped sync go unnoticed for four days (docs/pitfall/51).
export const SIGNED_OUT_STOP_REASON =
  "Auto-sync is on but this device is signed out of Google";

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  autoSync: boolean;
  // The ticking engine is started. Distinguishes "syncing" from "auto-sync is
  // on and nothing is running".
  engineStarted: boolean;
  running: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  // When the current sync setup started running (health.ts), or null before
  // initSync has run.
  graceSince: number | null;
}

let state: SyncState = emptyState();
let engine: SyncEngine | null = null;
let initialized = false;
let signedIn = false;
let email: string | null = null;
let engineStarted = false;
let graceSince: number | null = null;
// Which shell mounted us, as the shell itself reports it in initSync. Not
// re-detected here: the form factor was decided once at mount (docs/22), and
// asking the window a second time could answer differently. Desktop until told
// otherwise — the shell that syncs everything.
let shell: Shell = "desktop";
// Undo for the foreground/background hooks, bound only while the engine ticks.
let unobserveLifecycle: (() => void) | null = null;

const statusListeners = new Set<(s: SyncStatus) => void>();

function buildStatus(): SyncStatus {
  const s = engine?.status();
  return {
    configured: isGoogleConfigured(),
    signedIn,
    email,
    autoSync: state.autoSync,
    engineStarted,
    running: s?.running ?? false,
    lastSyncAt: s?.lastSyncAt ?? state.lastSyncAt,
    lastError: s?.lastError ?? state.lastError,
    graceSince,
  };
}

function notify(): void {
  const s = buildStatus();
  for (const l of statusListeners) l(s);
}

// Everything the engine is handed, as a value the test can hold: the pass is
// headless, so every way it reaches the rest of the app is one of these fields.
// `onPulled` is the one the whole pull-route table hangs off — a pass that stops
// announcing what it wrote leaves every route unfired and nothing anywhere
// throws, which is the silence tests/platform/sync/pull-coverage.test.ts exists
// to prevent, and it could not see this line.
//
// The shell is a parameter rather than the module's own, so the books decision
// can be asked both ways without mounting anything.
export function engineDeps(forShell: Shell): EngineDeps {
  const backend = new DriveBackend({
    getToken: getAccessToken,
    ids: state.drive,
    persistIds: () => saveState(state),
  });
  return {
    backend,
    fs: tauriSyncFs,
    books: tauriBookFs,
    // The phone never opens a book, so it mirrors none (docs/22). Decided here
    // rather than in the engine: the pass stays headless, and the one thing it
    // would need — which shell is running — is something the caller already
    // knows.
    booksPolicy: forShell === "phone" ? "off" : "mirror",
    base: tauriBaseStore,
    trash: tauriTrashJournal,
    snapshot: state.snapshot,
    purge: state.purge,
    restoredLastSyncAt: state.lastSyncAt,
    onPulled: (paths) => dispatchPull(paths),
    onStatus: (r) => {
      recordPassResult(state, r);
      void saveState(state);
      notify();
    },
    onSignedOut: () => void handleSignedOut(),
  };
}

function makeEngine(): SyncEngine {
  return new SyncEngine(engineDeps(shell));
}

function ensureEngine(): SyncEngine {
  if (!engine) engine = makeEngine();
  return engine;
}

// The ticking engine and the lifecycle hooks go up and down together: the hooks
// run passes, so leaving them bound after the user turned auto-sync off would
// keep syncing a device that asked not to be synced. They read `engine` at call
// time — a signed-out engine is replaced, not reused.
function startEngine(): void {
  // A setup that starts now gets the whole grace window before its missing
  // first pass is called a fault; a start on an already ticking engine leaves
  // the anchor where it is (health.ts).
  graceSince = nextGraceSince(graceSince, engineStarted, Date.now());
  ensureEngine().start();
  engineStarted = true;
  unobserveLifecycle ??= observeAppLifecycle(window, {
    onForeground: () => void engine?.onForeground(),
    onBackground: () => void engine?.onBackground(),
  });
}

function stopEngine(): void {
  engine?.stop();
  engineStarted = false;
  unobserveLifecycle?.();
  unobserveLifecycle = null;
}

// A dead refresh token surfaced mid-pass: drop to signed-out but keep all local
// data and the toggle preference (docs/13). The UI prompts for re-login.
async function handleSignedOut(): Promise<void> {
  stopEngine();
  engine = null;
  signedIn = false;
  email = null;
  await signOut().catch(() => {});
  notify();
}

// `shell` is the form factor the entry point mounted (docs/22). It decides
// whether the books channel runs; everything else syncs the same on every
// device.
export async function initSync(mounted: Shell): Promise<void> {
  if (initialized) return;
  initialized = true;
  shell = mounted;
  const queued = state.purge;
  state = await loadState();
  // A purge requested before the file was read (the shells kick both off on the
  // way up and neither waits for the other) is merged in rather than dropped:
  // the module's own state object is replaced here, and whatever was queued on
  // the old one is the only record that the request was ever made.
  if (queued.length > 0) {
    state.purge = [...new Set([...state.purge, ...queued])];
    await saveState(state);
  }
  signedIn = await isSignedIn();
  email = await currentEmail();
  // Covers the paths that start no engine; startEngine sets its own anchor.
  graceSince = Date.now();
  const action = syncStartAction({
    configured: isGoogleConfigured(),
    signedIn,
    autoSync: state.autoSync,
    lastSyncAt: state.lastSyncAt,
  });
  if (action === "start") {
    startEngine();
  } else if (action === "record-stopped") {
    // Say it on disk rather than leaving a state that reads as healthy.
    state.lastError = SIGNED_OUT_STOP_REASON;
    await saveState(state);
  }
  notify();
}

export function subscribeSyncStatus(cb: (s: SyncStatus) => void): () => void {
  statusListeners.add(cb);
  cb(buildStatus());
  return () => statusListeners.delete(cb);
}

export async function signInToGoogle(): Promise<void> {
  await signIn();
  signedIn = true;
  email = await currentEmail();
  // Auto-sync defaults on after the first sign-in (docs/13).
  state.autoSync = true;
  // Drop any recorded reason the engine was not running; it is running now.
  state.lastError = null;
  await saveState(state);
  startEngine();
  notify();
}

export async function signOutOfGoogle(): Promise<void> {
  stopEngine();
  engine = null;
  await signOut();
  signedIn = false;
  email = null;
  // Reset the Drive ids and last-sync snapshot so a different account signing in
  // later starts clean; local data is untouched.
  state.drive = emptyState().drive;
  state.snapshot = {};
  // The queue names files in the Drive this device is signing out of. Another
  // account's Drive never held them, and a delete aimed at it would be this
  // build deleting a file it knows nothing about.
  state.purge = [];
  state.lastSyncAt = null;
  state.lastError = null;
  await saveState(state);
  notify();
}

export async function setAutoSyncEnabled(on: boolean): Promise<void> {
  state.autoSync = on;
  // Turning it off leaves nothing to report; turning it on with the engine
  // running lets the first pass set the truth.
  if (!on) state.lastError = null;
  await saveState(state);
  if (on && signedIn && isGoogleConfigured()) startEngine();
  else stopEngine();
  notify();
}

// Say that these paths must not exist in the remote any more, and let the next
// pass take them out (engine.ts). For a build that has retired a file format
// outright: the local copies are the caller's to delete, and this is the half a
// device cannot do by deleting anything, because a sync propagates no file
// deletion of its own (reconcile.ts, docs/13) — a file dropped locally is simply
// left alone in Drive, where it outlives the code that could read it and comes
// back down onto any device whose snapshot does not cover it.
//
// Queued rather than done here: the request arrives when the app starts, which
// says nothing about whether this device is online, signed in, or syncing at
// all. It survives on disk until a pass gets to it, and costs nothing on a
// device that never signs in.
export async function requestRemotePurge(paths: readonly string[]): Promise<void> {
  const next = paths.filter((p) => !state.purge.includes(p));
  if (next.length === 0) return;
  state.purge.push(...next);
  // Before init the module's state is a placeholder that loadState is about to
  // replace; writing it out would put an empty snapshot and autoSync:false over
  // the real file. initSync merges the queue forward instead.
  if (initialized) await saveState(state);
  if (engineStarted) void engine?.syncNow().catch(() => {});
}

export async function syncNow(): Promise<void> {
  if (!signedIn || !isGoogleConfigured()) throw new Error("Sign in to Google to sync");
  await ensureEngine().syncNow();
  if (state.autoSync) startEngine();
}

// Everything this module keeps for the life of the process, put back to how the
// first import left it. `initialized` is the one that makes a rebuild necessary
// rather than tidy: initSync returns immediately once it is true, so the second
// case to call it in a process runs against whatever the first one signed in as.
//
// The engine and the lifecycle hooks are stopped first, and the status listeners
// are dropped last: a subscriber from an earlier case would otherwise be told
// about a sync it has nothing to do with.
export function resetSyncForTests(): void {
  stopEngine();
  engine = null;
  state = emptyState();
  initialized = false;
  signedIn = false;
  email = null;
  graceSince = null;
  shell = "desktop";
  statusListeners.clear();
}
