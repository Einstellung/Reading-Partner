// The sync-range predicate (src/platform/sync/syncFs.ts): which AppData files are synced.
// Run: bun test.

import { expect, test } from "bun:test";
import { inSyncRange } from "../../../src/platform/sync/syncFs";

test("core user-data files are in range", () => {
  for (const p of [
    "library.json",
    "reading-state.json",
    "settings.json",
    "topics.json",
    "annotations-abc123.json",
    "threads-abc123.json",
    // "memory-" is the AI observations directories' historical on-disk name.
    "memory-topic1/m-ab12cd34.md",
    "memory-topic1/index.md",
    "memory-topic1/meta.json",
    // A document's prep material (docs/09). Whichever kind it turns out to need
    // sits under the one prep-<hash>/ directory: paper notes at the top, chapter
    // spines a level down.
    "prep-deadbeef/state.json",
    "prep-deadbeef/attention-is-all-you-need.md",
    "prep-deadbeef/chapters/state.json",
    "prep-deadbeef/chapters/overview.md",
    "prep-deadbeef/chapters/chapter-01.md",
    // A retell (docs/31): its materials and the outline its retell settled.
    // Nothing rebuilds it from the books, so it travels like marks and threads
    // rather than like the caches below — and so does its conversation, which is
    // a thread file keyed by the retell.
    "retell-1754400000000.json",
    "threads-retell-1754400000000.json",
    // A rehearsal (docs/43) and every pass over its deck: the pages and what was
    // said to them. A trace of the reader, so both travel; the deck they were
    // given against does not.
    "rehearsal-1754400000000.json",
    "runs-rehearsal-1754400000000.json",
    // The cross-scenario user profile and the info feedback log are the user's
    // data (docs/16); info-profile.md is the profile's old name, kept in range
    // through the transition.
    "user-profile.md",
    "info-profile.md",
    "info-feedback.jsonl",
    // Articles kept out of a briefing (docs/21): the reader's own picks, so they
    // travel — unlike the daily briefing/article caches they came from.
    "saved-articles.json",
    // What a collector publishes for the readers (docs/36), and the two files
    // devices leave for each other: who is collecting, and a reader asking for a
    // briefing it cannot build itself.
    "info-briefing.json",
    "info-bodies.json",
    "info-pool-marks.json",
    "info-collector-4d9f1b0a.json",
    "info-ask-4d9f1b0a.json",
  ]) {
    expect(inSyncRange(p)).toBe(true);
  }
});

test("caches, logs, sync internals, and book blobs are out of range", () => {
  for (const p of [
    "fulltext-abc123.json",
    "figures-abc123.json",
    "events-topic1.jsonl",
    // The structured-output log rides the same naming under a reserved topic id
    // (src/platform/app/structured-output.ts) and is just as local.
    "events-ai.jsonl",
    "sync-auth.json",
    "sync-state.json",
    // The merge base mirrors the whole sync range under sync-base/. Syncing
    // the record of what was last agreed would be circular, and every path
    // under it would come back as a second copy of the file it mirrors.
    "sync-base/library.json",
    "sync-base/memory-topic1/m-ab12cd34.md",
    "sync-base/prep-deadbeef/chapters/state.json",
    "credentials.json",
    "prep-deadbeef/pdf/some-paper.pdf",
    "prep-deadbeef/cache/raster.png",
    // One level down, chapters/ is the only nested directory in range; a cache
    // beside it is not, and neither is anything deeper.
    "prep-deadbeef/chapters/figures/fig-01.png",
    "prep-deadbeef/drafts/chapter-01.md",
    "slides/retells.json",
    "slides/1737000000000-my-retell.html",
    // A retell's own state and products stay out too, unlike prep-*/state.json:
    // the index alone rebuilds nothing, and what it indexes is megabytes of
    // slide bodies and base64 images (src/reading/slides/store.ts).
    "slides/1737000000000/state.json",
    "slides/1737000000000/slide-01.html",
    "slides/1737000000000/asset-03.txt",
    // The rescue copy a run log that would not parse is moved to. It is there
    // for a person to look at, not to be pushed at the other device.
    "runs-rehearsal-1754400000000.json.bad",
    // A deck brought in from outside: tens of megabytes of self-contained HTML,
    // imported on the device it is rehearsed on (src/reading/rehearsal/store.ts).
    "rehearsals/1754400000000.html",
    "library/abc123.pdf",
    "images/threads/t1/photo.png",
    // Info triage: the daily briefing and article cache are derived, not synced.
    // What the readers get is the collector's published pair above, which does
    // not grow by the day (docs/36).
    "briefing-2026-07-21.json",
    "info-articles-2026-07-21.json",
    "info-items-2026-07-21.json",
    "info-run-2026-07-21.json",
    "info-pool-2026-07-21.json",
    "info-pool-polled.json",
    // Cookies never leave the machine that signed in, and a source's last
    // success is that machine's own record (docs/36).
    "info-site-sessions.json",
    "info-source-health.json",
    // Per-device settings (docs/36). One machine starting with the computer says
    // nothing about another, and there is no merge that could resolve the two.
    "device.json",
    "random.txt",
  ]) {
    expect(inSyncRange(p)).toBe(false);
  }
});
