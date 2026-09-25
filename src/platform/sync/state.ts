// Sync's own local state: AppData/sync-state.json. Never synced (it is the
// bookkeeping that drives syncing). Holds the Drive folder/file ids so the app
// tracks files by id across a user rename (docs/13), the last-sync snapshot the
// reconcile loop compares against, the auto-sync toggle, and the last result.
//
// The auto-sync toggle lives here, not in settings.json, on purpose: settings.json
// is itself synced, so keeping the toggle local sidesteps the "turn sync off,
// and the old on-value syncs back and turns it on again" loop. Sync enablement is
// a per-device choice anyway.

import { appData } from "../app/appdata";
import { writeTextAtomic } from "../app/atomic-fs";
import type { Snapshot } from "./reconcile";

const STATE_FILE = "sync-state.json";

export interface DriveIds {
  folderId?: string;
  dataFolderId?: string;
  booksFolderId?: string;
  // manifest.json is read once, to seed appProperties onto files uploaded
  // before those existed (driveBackend.ts). Kept so that read costs one
  // request.
  manifestFileId?: string;
  // AppData-relative path -> Drive file id, for the data channel.
  fileIds: Record<string, string>;
  // content hash -> Drive file id, for the books channel.
  bookIds: Record<string, string>;
}

export interface SyncState {
  autoSync: boolean;
  snapshot: Snapshot;
  drive: DriveIds;
  lastSyncAt: number | null;
  lastError: string | null;
  // Paths this build has decided must not exist in the remote any more, waiting
  // for a pass to delete them. Persisted rather than done on the spot because
  // the decision is made when the app starts and the network is whatever it is:
  // a one-shot that fires while the device is offline would leave the files in
  // Drive with nothing left that remembers to go back for them. Drained by the
  // engine, one entry dropped per delete that lands.
  purge: string[];
  // The account whose Drive `purge` was queued against, recorded when that
  // account signs out; null while signed in, or when nothing was queued.
  // Sign-in to that same account keeps the queue, to any other drops it.
  purgeAccount: string | null;
}

export function emptyState(): SyncState {
  return {
    autoSync: false,
    snapshot: {},
    drive: { fileIds: {}, bookIds: {} },
    lastSyncAt: null,
    lastError: null,
    purge: [],
    purgeAccount: null,
  };
}

// What signing out leaves. The Drive ids and the snapshot go, so an account
// signing in later starts clean; local data is untouched. The purge queue
// stays, tagged with the account it names files in: it is the only record that
// those files still have to leave that Drive, and dropping it brings them back
// down the next time the same account signs in. Without a known account it
// cannot be tagged, and a queue nobody can attribute is dropped.
export function signedOutState(state: SyncState, account: string | null): void {
  state.drive = emptyState().drive;
  state.snapshot = {};
  if (account) {
    state.purgeAccount = state.purge.length > 0 ? account : null;
  } else {
    state.purge = [];
    state.purgeAccount = null;
  }
  state.lastSyncAt = null;
  state.lastError = null;
}

// What signing in does to a queue a sign-out tagged. The same account takes it
// up where it stopped. Another account's Drive never held those files, and a
// delete aimed at it would be this build deleting a file it knows nothing
// about — and an account that cannot be named is not known to be the same one.
// A queue with no tag was requested while no account was signed in, which is
// a statement about the data, not about a Drive, so it stays.
export function signedInState(state: SyncState, account: string | null): void {
  if (state.purgeAccount !== null && state.purgeAccount !== account) state.purge = [];
  state.purgeAccount = null;
}

// Fold one engine status emit into the state that gets written to disk.
//
// lastError takes the emit as it comes: null there is a real value, meaning
// nothing is wrong right now. lastSyncAt does not. An emit carries null both
// for "this device has never had a clean pass" and for any pass that has not
// reached the point of setting it — runPass emits once before it does any work
// — so writing null through would erase a timestamp the engine never disputed.
// That is what put a device syncing fine at "Last sync: Never" on every launch.
//
// Not redundant with restoredLastSyncAt seeding the engine. Seeding fixes the
// one emitter that was known to be wrong; this makes the file itself incapable
// of losing a good timestamp to any emitter that arrives without one.
export function recordPassResult(
  state: SyncState,
  result: { lastSyncAt: number | null; lastError: string | null },
): void {
  if (result.lastSyncAt !== null) state.lastSyncAt = result.lastSyncAt;
  state.lastError = result.lastError;
}

export async function loadState(): Promise<SyncState> {
  try {
    if (!(await appData.exists(STATE_FILE))) return emptyState();
    const parsed = JSON.parse(await appData.readText(STATE_FILE)) as Partial<SyncState>;
    const base = emptyState();
    return {
      ...base,
      ...parsed,
      snapshot: parsed.snapshot ?? base.snapshot,
      purge: parsed.purge ?? base.purge,
      drive: {
        ...base.drive,
        ...parsed.drive,
        fileIds: parsed.drive?.fileIds ?? {},
        bookIds: parsed.drive?.bookIds ?? {},
      },
    };
  } catch {
    return emptyState();
  }
}

export async function saveState(state: SyncState): Promise<void> {
  await writeTextAtomic(STATE_FILE, JSON.stringify(state, null, 2));
}
