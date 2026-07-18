// One-time migration of per-book data from the legacy path-hash key
// (hashPath(absolutePath)) to the content-hash book id (library.ts). Runs the
// first time a book is opened after the upgrade, and in a startup backfill pass
// over topic files (App.tsx). Every step is guarded "move only if the target is
// absent", so it is idempotent and safe to re-run.
//
// The derived caches (fulltext-*, figures-*) are intentionally NOT migrated: they
// are keyed by content and rebuild cheaply under the new key on next open, so the
// old files are simply left orphaned. Only the user's own data moves.

import {
  BaseDirectory,
  exists as fsExists,
  readTextFile,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

// Mirrors storage.ts's STATE_FILE (the shared reading-position map).
const STATE_FILE = "reading-state.json";

// The few fs operations migration needs, over relative AppData paths. Injected so
// the logic runs headless in tests.
export interface MigrateFs {
  exists(name: string): Promise<boolean>;
  readText(name: string): Promise<string>;
  writeText(name: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

// reading-state.json is one shared map of bookId -> ViewState; move the entry
// under the old key to the new key, if the new key has none yet.
export async function migrateViewState(
  fs: MigrateFs,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (oldKey === newKey) return;
  if (!(await fs.exists(STATE_FILE))) return;
  let store: { states?: Record<string, unknown> };
  try {
    store = JSON.parse(await fs.readText(STATE_FILE));
  } catch {
    return;
  }
  const states = store?.states;
  if (!states || states[oldKey] === undefined || states[newKey] !== undefined) return;
  states[newKey] = states[oldKey];
  delete states[oldKey];
  await fs.writeText(STATE_FILE, JSON.stringify(store, null, 2));
}

// Rename a per-book file `${prefix}-${oldKey}.json` to the new key, when the
// source exists and the target does not. Used for annotations and threads.
export async function migrateNamedFile(
  fs: MigrateFs,
  prefix: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (oldKey === newKey) return;
  const from = `${prefix}-${oldKey}.json`;
  const to = `${prefix}-${newKey}.json`;
  if (!(await fs.exists(from)) || (await fs.exists(to))) return;
  await fs.rename(from, to);
}

// Move a survey's prep directory (notes, downloaded PDFs, plan state) to the new
// key. The state file embeds its own surveyHash, which must be rewritten so later
// saves land in the renamed directory. Paper text/figure caches inside are keyed
// off the old surveyHash and are not moved; they rebuild from the moved PDFs.
export async function migratePrepDir(
  fs: MigrateFs,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (oldKey === newKey) return;
  const oldState = `prep-${oldKey}/state.json`;
  const newState = `prep-${newKey}/state.json`;
  if (!(await fs.exists(oldState)) || (await fs.exists(newState))) return;
  await fs.rename(`prep-${oldKey}`, `prep-${newKey}`);
  try {
    const state = JSON.parse(await fs.readText(newState)) as { surveyHash?: string };
    if (state && state.surveyHash === oldKey) {
      state.surveyHash = newKey;
      await fs.writeText(newState, JSON.stringify(state, null, 2));
    }
  } catch {
    // The rename already moved the notes/PDFs; an unreadable state.json just
    // replans on next open.
  }
}

// Move every kind of per-book user data from the old path-hash key to the book id.
export async function migrateBook(
  fs: MigrateFs,
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (oldKey === newKey) return;
  await migrateViewState(fs, oldKey, newKey);
  await migrateNamedFile(fs, "annotations", oldKey, newKey);
  await migrateNamedFile(fs, "threads", oldKey, newKey);
  await migratePrepDir(fs, oldKey, newKey);
}

const tauriMigrateFs: MigrateFs = {
  exists: (name) => fsExists(name, { baseDir: BaseDirectory.AppData }),
  readText: (name) => readTextFile(name, { baseDir: BaseDirectory.AppData }),
  writeText: (name, content) => writeTextFile(name, content, { baseDir: BaseDirectory.AppData }),
  rename: (from, to) =>
    rename(from, to, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    }),
};

// Live migration against the Tauri fs.
export function migrateBookLive(oldKey: string, newKey: string): Promise<void> {
  return migrateBook(tauriMigrateFs, oldKey, newKey);
}
