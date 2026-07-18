// Sync's own local state: AppData/sync-state.json. Never synced (it is the
// bookkeeping that drives syncing). Holds the Drive folder/file ids so the app
// tracks files by id across a user rename (docs/13), the last-sync snapshot the
// reconcile loop compares against, the auto-sync toggle, and the last result.
//
// The auto-sync toggle lives here, not in settings.json, on purpose: settings.json
// is itself synced, so keeping the toggle local sidesteps the "turn sync off,
// and the old on-value syncs back and turns it on again" loop. Sync enablement is
// a per-device choice anyway.

import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { Snapshot } from "./reconcile";

const STATE_FILE = "sync-state.json";

export interface DriveIds {
  folderId?: string;
  dataFolderId?: string;
  booksFolderId?: string;
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
}

export function emptyState(): SyncState {
  return {
    autoSync: false,
    snapshot: {},
    drive: { fileIds: {}, bookIds: {} },
    lastSyncAt: null,
    lastError: null,
  };
}

export async function loadState(): Promise<SyncState> {
  try {
    if (!(await exists(STATE_FILE, { baseDir: BaseDirectory.AppData }))) return emptyState();
    const parsed = JSON.parse(
      await readTextFile(STATE_FILE, { baseDir: BaseDirectory.AppData }),
    ) as Partial<SyncState>;
    const base = emptyState();
    return {
      ...base,
      ...parsed,
      snapshot: parsed.snapshot ?? base.snapshot,
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
  await writeTextFile(STATE_FILE, JSON.stringify(state, null, 2), { baseDir: BaseDirectory.AppData });
}
