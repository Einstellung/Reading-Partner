// The AppData filesystem the per-topic observation store runs on.
//
// Its own module rather than a corner of live.ts because the statement store
// needs it too (statements.ts) and live.ts reads the statements: leaving it
// there made those two files import each other.

import { appData } from "../../platform/app/appdata";
import { writeTextAtomic } from "../../platform/app/atomic-fs";
import type { ObservationFs } from "../observations/store";

// No exists() probe before a read or a listing. Each probe is a round trip
// through the Tauri plugin bridge, and it doubled the cost of every read: one
// list() over the owner's 106-entry topic was 2 + 2x106 = 214 crossings, and
// buildReadingTurn (reading/turn.ts) does one on every reading turn, iPad
// included. Reading straight through makes it 107. Two hundred-odd crossings
// is the cost SyncFs names as the reason nothing but a full sync pass may call
// its list() (platform/sync/syncFs.ts); this one ran on every turn.
//
// A read that throws is a file that is not there, which is the answer the store
// already acts on: it takes null from read() and takes the same null from a
// file whose bytes do not parse (store.ts), and nothing above it tells missing
// from unreadable. The probe never ruled the throw out anyway — the file can go
// between exists() and readText() — so this drops a cost, not a guarantee.
export const observationFs: ObservationFs = {
  async read(path) {
    try {
      return await appData.readText(path);
    } catch {
      return null;
    }
  },
  async write(path, content) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) await appData.mkdirp(dir);
    await writeTextAtomic(path, content);
  },
  async remove(path) {
    await appData.remove(path);
  },
  async listDir(path) {
    try {
      const entries = await appData.readDir(path);
      return entries.filter((e) => e.isFile).map((e) => e.name);
    } catch {
      return [];
    }
  },
};
