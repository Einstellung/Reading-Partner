// What files the engine syncs, and the filesystem surface it needs. Both are
// injected into the engine so the reconcile loop runs headless in tests.
//
// Sync range (docs/13): the user's own data — reading position, marks, AI
// threads, topics, per-topic AI observations, a document's prep material of
// either kind (docs/09 — paper notes and chapter spines both live under
// prep-<hash>/), retells and what each of them settled plus the record of each
// time one was given (docs/31), the cross-scenario user profile and
// info feedback log (docs/16), and app settings. Book PDFs travel the separate books channel
// (content-addressed blobs), never the data channel. Excluded: derived caches
// (fulltext-*, figures-*, prep-*/pdf and its caches), generated slide decks
// (slides/**, docs/14 — a build output, rebuildable from notes), the local
// event log, sync's own local
// files (sync-auth.json, sync-state.json, and the sync-base/ merge-base mirror
// — syncing the record of what was last agreed would be circular), and
// credentials.json — plaintext AI
// provider tokens stay on the device rather than widening their exposure to the
// user's Drive, and per-device tokens avoid refresh-rotation kicking the other
// device out. Thread images (images/**) are not synced in v1 — a screenshot
// pasted on one device shows as a missing image on the other, which
// readThreadImages already tolerates.

import { appData } from "../app/appdata";
import { writeBytesAtomic } from "../app/atomic-fs";

// What a scan of the sync range sees: one stat per file, nothing read.
export interface ScannedFile {
  path: string;
  mtime: number;
  size: number;
}

// A scanned file with the hash of its bytes. This, not ScannedFile, is what the
// pass decides on — see content.ts for why mtime cannot be trusted.
export interface LocalFile extends ScannedFile {
  hash: string;
}

export interface SyncFs {
  // Every in-range file with its mtime/size. Deliberately does not hash: the
  // 15s tick calls this, and reading every file each tick to learn nothing is
  // not a pre-filter. The pass hashes what the pre-filter flags.
  list(): Promise<ScannedFile[]>;
  read(path: string): Promise<Uint8Array>;
  // Writes bytes, creating any parent directory first.
  write(path: string, bytes: Uint8Array): Promise<void>;
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
}

// Exported for tests/platform/sync/pull-coverage.test.ts, which walks it: every
// synced file has to be claimed by a pull route or written down as having no
// in-memory copy for a pull to go stale against.
export const ROOT_FILES = new Set([
  "library.json",
  "reading-state.json",
  "settings.json",
  "topics.json",
  // The cross-scenario user profile (both the briefing and the reading companion
  // read it), the subscribed source list, and the append-only feedback log travel
  // between devices; the daily briefing-*.json / info-articles-* caches and the
  // info-source-health.json sidecar are derived and stay out of range (matched by
  // nothing below). info-profile.md is the profile's old name — kept in range
  // during the transition so a device still on the old build stays in step.
  "user-profile.md",
  "info-profile.md",
  "info-sources.json",
  "info-feedback.jsonl",
  // Articles the reader kept out of a briefing (docs/21). The index only: a few
  // hundred bytes a record, rewritten and re-uploaded on every keep. The bodies
  // are one immutable file each under article-bodies/ (below).
  "saved-articles.json",
  // What the collector publishes for the readers (docs/36): the briefing itself,
  // and the bodies of the items it put in the three tiers, with every <img>
  // taken out. Fixed names, replaced whole — the day's briefing-<date>.json and
  // its article cache stay derived and stay local, so nothing here grows by the
  // day and nothing has to be deleted remotely.
  "info-briefing.json",
  "info-bodies.json",
  // Which items have already been briefed (docs/35). Not derived: losing it
  // means the same item is pushed a second time, and a machine that takes over
  // collection has to know what its predecessor already sent.
  "info-pool-marks.json",
]);

// Whether an AppData-relative path (forward-slash separators) is synced.
export function inSyncRange(path: string): boolean {
  const parts = path.split("/");
  const top = parts[0];
  if (parts.length === 1) {
    if (ROOT_FILES.has(top)) return true;
    return (
      /^annotations-.+\.json$/.test(top) ||
      // A retell's conversation is threads-retell-<retellId>.json, so it is
      // already covered by the line above.
      /^threads-.+\.json$/.test(top) ||
      // Retells (docs/31): the materials, the outline the retell settled and the
      // order the reader put it in. Nothing can rebuild it from the books, so it
      // travels like marks and threads rather than like a cache. The deck it
      // produces (slides/**) stays out: that is a build output.
      /^retell-.+\.json$/.test(top) ||
      // A rehearsal and the index of its passes (docs/43): the deck the reader
      // gives over and over, and one row per time they gave it. A trace, not a
      // derivation — no deck and no book rebuilds it. The transcripts are one
      // file each under runs/ (below). The deck itself stays out: a built one is
      // slides/**, and an imported one is rehearsals/**, tens of megabytes of
      // self-contained HTML that has no business in a per-file merge. So the
      // other device shows the rehearsal and its history with no deck to give
      // until one is imported there too. The .bad copy a failed parse leaves
      // beside the index is deliberately not matched.
      /^rehearsal-.+\.json$/.test(top) ||
      /^runs-rehearsal-.+\.json$/.test(top) ||
      // The two files devices leave for each other (docs/36). One per device and
      // written by that device alone, so there is never a merge to do: a
      // collector says who it is and when it was last alive, and a reader asks
      // for a briefing it cannot build itself.
      /^info-collector-.+\.json$/.test(top) ||
      /^info-ask-.+\.json$/.test(top)
    );
  }
  // The body of one kept article (docs/21), one immutable file per body, named
  // for the hash of its own bytes. In range because the index alone is a list of
  // titles: without these the other device opens a kept article and finds
  // nothing to read. Cold once uploaded — the name changes with the content, so
  // a file is written once and never revised.
  if (top === "article-bodies") return parts.length === 2 && isArticleBodyFile(parts[1]);
  // What the reader said on each page of one pass over a deck (docs/43), under
  // runs/<rehearsalId>/<runId>.json: one immutable file per pass, written when
  // the pass ends and never revised. In range for the same reason the index is —
  // nothing rebuilds what the reader said — and out of the index so that
  // recording the tenth pass does not re-upload the first nine. Both levels are
  // plain names or nothing: the run id comes off an index that arrives over
  // sync, which is what makes it a path built from external data.
  if (top === "runs") {
    return parts.length === 3 && isIdSegment(parts[1]) && isRunPagesFile(parts[2]);
  }
  // Per-topic AI observations: every file under memory-<topicId>/ (entries,
  // index, meta). "memory-" is the historical directory name and is deliberately
  // unchanged: the feature was renamed on 2026-08-06, the directories on disk and
  // in the user's Drive were not, and this matcher goes by file name.
  if (top.startsWith("memory-")) return true;
  // A document's prep (docs/09). Two kinds of material live under one directory
  // and only one of them is ever filled in: the paper notes sit at the top with
  // the plan state, the chapter spines sit one level down under chapters/ with a
  // state of their own. Everything else nested there is cache and stays out —
  // the downloaded PDFs (prep-*/pdf/**) above all, which are megabytes and
  // re-fetchable.
  if (top.startsWith("prep-")) {
    if (parts.length === 2) return isPrepFile(parts[1]);
    if (parts.length === 3 && parts[1] === "chapters") return isPrepFile(parts[2]);
    return false;
  }
  return false;
}

// The two file names prep material comes in, at either level: the state that
// makes a run resumable, and the notes themselves.
function isPrepFile(name: string): boolean {
  return name === "state.json" || name.endsWith(".md");
}

// The only names accepted inside article-bodies/: the 32-hex content hash the
// writer produces (reading/saved-articles.ts). Spelled out here rather than
// imported so this module keeps depending on nothing but platform/app — and
// narrow on purpose, since the name in a record is what becomes a path, and that
// record arrives over sync.
const ARTICLE_BODY_NAME = /^[0-9a-f]{32}\.json$/;

function isArticleBodyFile(name: string): boolean {
  return ARTICLE_BODY_NAME.test(name);
}

// The only shape a rehearsal id or a run id may have inside runs/
// (reading/rehearsal/store.ts, which spells out the same rule for the writer).
// Restated here rather than imported so this module keeps depending on nothing
// but platform/app, and narrow on purpose: both ids come off a synced index, and
// a name that is not a plain one never becomes a path.
const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isIdSegment(name: string): boolean {
  return ID_SEGMENT.test(name);
}

function isRunPagesFile(name: string): boolean {
  return name.endsWith(".json") && isIdSegment(name.slice(0, -".json".length));
}

// Whether a directory can hold an in-range file, so the walk descends into it.
// Spelled out rather than left at "anything under prep-", which would open every
// prep-<hash>/pdf/ to a readDir that can only ever return files inSyncRange
// rejects. "memory-" is the observation directories' historical name; see above.
function worthDescending(rel: string): boolean {
  if (rel === "article-bodies") return true;
  // runs/ holds one directory per rehearsal and nothing else, so the walk goes
  // exactly two levels and no further.
  if (rel === "runs") return true;
  if (rel.startsWith("runs/")) return rel.split("/").length === 2;
  if (rel.startsWith("memory-")) return true;
  if (!rel.startsWith("prep-")) return false;
  const parts = rel.split("/");
  return parts.length === 1 || (parts.length === 2 && parts[1] === "chapters");
}

// --- Tauri implementation --------------------------------------------------

async function walk(dir: string, out: ScannedFile[]): Promise<void> {
  let entries;
  try {
    entries = await appData.readDir(dir || ".");
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory) {
      // Only descend into directories that can hold in-range files.
      if (worthDescending(rel)) await walk(rel, out);
      continue;
    }
    if (!e.isFile || !inSyncRange(rel)) continue;
    // A file that vanished between readDir and stat has no stat to take: null,
    // and it is simply skipped. Not a throw to swallow — appData.stat answers
    // null for a file it cannot read, so this test is the whole of the
    // handling and dropping it would empty every scan.
    const info = await appData.stat(rel);
    if (!info) continue;
    out.push({ path: rel, mtime: info.mtimeMs, size: info.size });
  }
}

export const tauriSyncFs: SyncFs = {
  async list() {
    const out: ScannedFile[] = [];
    await walk("", out);
    return out;
  },
  read(path) {
    return appData.readBytes(path);
  },
  // Every in-range file is UTF-8 text this app wrote, so a pull lands through the
  // atomic writer: a pull is exactly when a torn write would be worst — half of
  // the other device's library.json, then a local import overwriting the rest.
  // Where the atomic/plain line is drawn, and why, is writeBytesAtomic's.
  write(path, bytes) {
    return writeBytesAtomic(path, bytes);
  },
  async stat(path) {
    const info = await appData.stat(path);
    return info === null ? null : { mtime: info.mtimeMs, size: info.size };
  },
};
