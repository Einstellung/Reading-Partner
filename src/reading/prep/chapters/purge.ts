// Deleting the chapter notes written before this was a chapter-spine pass at
// all, from this device and from Drive. Runs once at start-up; a device that
// holds none of them does nothing and pays one readDir for it.
//
// Why they cannot simply be left: a v1 chapter file is a note written for a
// person to read, and the pass that replaced it produces something the model is
// fed as a chapter's spine. Both are markdown under a directory named after the
// book. Nothing on disk tells them apart except the version in the state file
// beside them, which is exactly the kind of distinction that gets lost the next
// time this code is read.
//
// Why the delete has a remote half. A sync propagates no file deletion of its
// own: a file gone locally but present in the remote is left alone (reconcile.ts,
// docs/13), so dropping the directories here would leave every copy in Drive and
// on the iPad untouched. Worse than untouched — the pass downloads any remote
// path its snapshot does not cover, so a device that signs out and back in pulls
// the whole retired directory back onto disk. So the paths go to
// requestRemotePurge before the local delete, and the queue survives on disk
// until a pass has taken each one out of Drive.
//
// Ordering: the remote request first. If the app dies between the two halves,
// the local files are still there and the next start-up asks for the same paths
// again (the queue de-duplicates). The other order loses the list.

import { appData } from "../../../platform/app/appdata";
import { requestRemotePurge } from "../../../platform/sync";

// The directory name this pass wrote under before its material moved into the
// document's prep directory (store.ts).
const LEGACY_PREFIX = "notes-";

// Every legacy directory and the files in it, as AppData-relative paths. The
// files are listed rather than assumed from the naming scheme because the
// remote holds exactly what was uploaded, and what was uploaded is what was on
// disk.
export async function findLegacyChapterNotes(): Promise<{ dirs: string[]; files: string[] }> {
  const dirs: string[] = [];
  const files: string[] = [];
  let top;
  try {
    top = await appData.readDir(".");
  } catch {
    return { dirs, files };
  }
  for (const e of top) {
    if (!e.isDirectory || !e.name.startsWith(LEGACY_PREFIX)) continue;
    dirs.push(e.name);
    try {
      for (const f of await appData.readDir(e.name)) {
        if (f.isFile) files.push(`${e.name}/${f.name}`);
      }
    } catch {
      // A directory that cannot be listed is still removed below; what it holds
      // is only needed to name the remote copies.
    }
  }
  return { dirs, files };
}

// Idempotent: with nothing left to find it does nothing, so it can be called on
// every start-up without a marker to say it has already run. Nothing here is
// worth failing the start-up over — a directory that will not delete is tried
// again next time.
export async function purgeLegacyChapterNotes(): Promise<void> {
  const { dirs, files } = await findLegacyChapterNotes();
  if (dirs.length === 0) return;
  try {
    await requestRemotePurge(files);
  } catch (e) {
    console.warn("failed to queue the legacy chapter notes for remote deletion", e);
    return;
  }
  for (const dir of dirs) {
    try {
      await appData.removeDir(dir);
    } catch (e) {
      console.warn(`failed to delete ${dir}`, e);
    }
  }
}
