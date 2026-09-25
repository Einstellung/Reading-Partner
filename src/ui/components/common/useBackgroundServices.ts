// The process-level services both shells (App, PhoneApp) start once they are
// up: account sync and the shelf's pull route, the soul's inbox, legion's
// runner, the soul's session, and the stall watch. Beside useShellBootstrap
// rather than inside it because these start later, once the shell has the
// shelf refresh the pull route calls.
//
// What stays in the shells: the desktop's info collector and distillation
// sweeps, which the phone does not run, and the phone's kept-articles route.

import { useEffect } from "react";
import type { Shell } from "../../../platform/app/shell";
import type { Settings } from "../../../platform/app/settings";
import { initSync, TICK_MS } from "../../../platform/sync";
import { registerPullRoute } from "../../../platform/sync/pull-routes";
import { startBellWatch, startSoulSession } from "../../../soul";
import { startRunner } from "../../../legion/execute/runner";
import { watchAppAwayForStalls } from "../../../legion/execute/stall";
import { purgeLegacyChapterNotes } from "../../../reading/prep/chapters/purge";
import { settleDeletions } from "../../../reading/delete/settle";
import { SHELF_PULL_ROUTE } from "../../../reading/pull-routes";

export function useBackgroundServices({
  form,
  settingsRef,
  onShelfPulled,
}: {
  // "phone": the books channel stays off, since nothing on that shell can open
  // a PDF (docs/22).
  form: Shell;
  // Read on every bell, so the watch is started once and never rebound.
  settingsRef: { readonly current: Settings };
  // Redraws the shelf when a pull rewrites topics.json or library.json. Must be
  // stable: a new identity re-registers the route.
  onShelfPulled: () => void;
}): void {
  // Account sync (docs/13): start the engine if the user is signed in with
  // auto-sync on, and redraw the shelf when a pull rewrites what it is made of.
  // Everything else a pull touches has a route of its own (platform/sync/
  // pull-routes.ts): the per-book caches are platform's, settings.json is the
  // shared bootstrap's, and the briefing and the kept articles are the shells'.
  useEffect(() => {
    // Once, on the way up: the chapter notes written before this was a
    // chapter-spine pass are deleted from here and queued for deletion from
    // Drive. After initSync, so the queue is written to the state file that was
    // just read rather than to the placeholder it replaced.
    void initSync(form)
      .catch((e) => console.warn("sync init failed", e))
      .finally(() => void purgeLegacyChapterNotes());
    // A deletion log pulled from another device is finished here — the shelf
    // entry, the blob and the caches of a book it names, the row of a topic —
    // before the shelf redraws (reading/delete/settle.ts).
    return registerPullRoute({
      ...SHELF_PULL_ROUTE,
      onPulled: () => {
        void settleDeletions()
          .catch((e) => console.warn("settling deletions skipped", e))
          .finally(() => onShelfPulled());
      },
    });
  }, [form, onShelfPulled]);

  // The soul's inbox (docs/55). Whatever legion has to tell it arrives on the
  // same beat as the pull: a look on the way up and one every tick after, which
  // costs a directory listing when there is nothing in it. A bell that is there
  // starts a turn the reader did not start, and the soul decides what, if
  // anything, to say about it. The phone runs no heavy work of its own, but a
  // run it delegated to the desktop rings its bell there too, through the
  // conversation the two devices share.
  useEffect(
    () => startBellWatch({ settings: () => settingsRef.current, intervalMs: TICK_MS }),
    [],
  );

  // What legion owes, on the same beat (docs/55). The poll looks at the table
  // before it looks at the disk, so a device with no worker for anything pays
  // nothing. The phone wins the election for nothing heavy, so this is how a
  // run it delegated is seen to finish, and how a local run of its own is
  // picked up at all.
  useEffect(() => startRunner({ intervalMs: TICK_MS }), []);

  // A turn the last process was killed in the middle of is finished now, on the
  // session it was killed on (src/soul/recover.ts). It runs at start and not on
  // the first turn, because the reader who lost an answer has no reason to ask
  // for another one before they see it (docs/pitfall/394).
  useEffect(() => {
    void startSoulSession();
  }, []);

  // Where the app is, for the turns that are streaming (legion/execute/stall.ts).
  // iOS freezes the process moments after it is switched away and the stream
  // that was being read does not survive it; coming back is when a turn still
  // holding the lane has to be cut loose.
  useEffect(() => watchAppAwayForStalls(window), []);
}
