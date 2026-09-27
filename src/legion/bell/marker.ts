// The legion-bell garbage marker (docs/80). A bell stays after its ack so that
// a second ring of the same id still finds it and leaves one bell (store.ts);
// this is the housekeeping that takes it once no second ring can come.
//
// Never an unacked bell: that is a result the soul has not read.

import type { GarbageMarker, Mark } from "../../housekeeper";
import { BELL_DIR } from "./store";

export const BELL_MARKER = "legion-bell";

// A bell is rung again only while its run is hot (a run executed a second time
// rings the same run-done id) or while a tick is between ringing and writing
// the anchor down; a run folds at most seven days after its ack
// (FOLD_FAILED_GRACE_MS), so twice that is past any second ring.
export const ACKED_BELL_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export const bellMarker: GarbageMarker = {
  name: BELL_MARKER,
  async mark({ io, now }) {
    const marks: Mark[] = [];
    for (const entry of await io.list(BELL_DIR)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const path = `${BELL_DIR}/${entry.name}`;
      const text = await io.readText(path);
      if (text === null) continue;
      let bell: { state?: unknown; at?: unknown };
      try {
        bell = JSON.parse(text) as { state?: unknown; at?: unknown };
      } catch {
        continue;
      }
      if (bell.state !== "acked") continue;
      // The ack is the bell's last write, so the mtime is when it was acked;
      // where the platform reports none, the ring time is the earlier bound.
      const stat = await io.stat(path);
      const since =
        stat && stat.mtimeMs > 0 ? stat.mtimeMs : typeof bell.at === "number" ? bell.at : null;
      if (since === null || now - since < ACKED_BELL_GRACE_MS) continue;
      marks.push({ path, action: "delete", reason: "acked more than two weeks ago" });
    }
    return marks;
  },
};
