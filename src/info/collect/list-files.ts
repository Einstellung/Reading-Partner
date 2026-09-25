// Listing the names of every file this domain keeps flat in AppData (day
// files, the pool, briefings): one readDir, filtered to files and mapped to
// names. Throws exactly what appData.readDir throws — every caller wraps it in
// its own try/catch, because what a listing failure should answer (null, an
// early return, an empty collection) differs caller to caller.

import { appData } from "../../platform/app/appdata";

export async function listFileNames(): Promise<string[]> {
  const entries = await appData.readDir("");
  return entries.filter((e) => e.isFile).map((e) => e.name);
}
