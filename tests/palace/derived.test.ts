// What used to be hand-written beside each reader now comes off the table, and
// this is where the two are held together (docs/61).
//
// Four questions were answered by four separate lists: whether a file syncs,
// how it merges, what its records look like, and whether a deleted book owns
// it. Each list is now a fold over the palace, so the failure mode is no longer
// that they disagree — it is that a row says one thing and the reader takes
// another. Every sample in the table is put to all four. Run: bun test.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cascadeOfTopic,
  PALACE,
  resolvePalace,
  rowOf,
  rowsWhere,
  type PalaceKind,
} from "../../src/palace";
import { THREAD_KINDS } from "../../src/conversations";
import { threadFileKey, threadFileName } from "../../src/platform/app/threads";
import { strategyFor } from "../../src/platform/sync/merge/contract";
import { recordShape } from "../../src/platform/sync/merge/records";
import { deadPathsFor, isDeadPath } from "../../src/platform/sync/dead-paths";
import { inSyncRange } from "../../src/platform/sync/syncFs";
import { deadLocalPathsFor } from "../../src/reading/delete/pick";
import {
  coverFailurePath,
  coverImagePath,
  coverMetaPath,
} from "../../src/reading/cover-cache";
import { figuresFile } from "../../src/reading/figures/store";
import { fulltextFile } from "../../src/fulltext/store";
import { libraryBookPath } from "../../src/platform/app/library";
import { paginationFile } from "../../src/reading/epub/pagination-store";

// A book id is the content hash of the file's bytes, and three kinds only match
// that shape: a made-up id would resolve to the orphan row beside them instead.
const BOOK = "0123456789abcdef0123456789abcdef";

test("a sample is merged the way its row says", () => {
  for (const row of PALACE) {
    if (row.sync !== "data") continue;
    for (const path of row.samples) {
      expect(`${path}: ${strategyFor(path)}`).toBe(`${path}: ${row.merge}`);
    }
  }
});

test("a sample's records are the shape its row says, and nothing else has one", () => {
  for (const row of PALACE) {
    for (const path of row.samples) {
      expect({ path, shape: recordShape(path) }).toEqual({ path, shape: row.shape ?? null });
    }
  }
});

test("a sample is in the sync range exactly when its row is on the data channel", () => {
  for (const row of PALACE) {
    for (const path of row.samples) {
      expect(`${path}: ${inSyncRange(path)}`).toBe(`${path}: ${row.sync === "data"}`);
    }
  }
});

// A retell dies with a book too, but by a rule about its materials rather than
// by its name (reading/delete/pick.ts): its path cannot be derived from a book
// id and a tombstone naming that id must not claim it.
test("a sample is a deleted book's exactly when its row is named for a book", () => {
  for (const row of PALACE) {
    for (const path of row.samples) {
      const id = resolvePalace(path)?.id;
      const claimed = id === null || id === undefined ? false : isDeadPath(path, new Set([id]));
      const owned = row.deleteWith === "book" && row.id === "bookId";
      expect(`${path}: ${claimed}`).toBe(`${path}: ${owned}`);
    }
  }
});

// The engine purges the synced half on every device; the domain half deletes
// what only ever existed here. Between them they must cover every kind the
// table says a book owns, or a deleted book leaves a file behind — a cover on
// the next shelf, or marks that come back with the book.
test("what a deleted book takes covers every kind named for a book", () => {
  const local = deadLocalPathsFor(BOOK);
  const removed = new Set([...local.files, ...local.dirs.map((d) => `${d}/`)]);
  const owed = rowsWhere((r) => r.deleteWith === "book" && r.id === "bookId")
    .map((r) => r.pathFor?.(BOOK))
    .filter((p): p is string => p !== undefined);
  expect(owed.filter((p) => !removed.has(p))).toEqual([]);

  // And the synced half is the part of that the reconcile loop can see, all of
  // it deleted here as well.
  const synced = deadPathsFor(BOOK);
  for (const path of [...synced.files, ...synced.dirs]) {
    expect(`${path}: ${removed.has(path)}`).toBe(`${path}: true`);
  }
  for (const path of [...synced.files, ...synced.dirs.map((d) => `${d}state.json`)]) {
    expect(`${path}: ${inSyncRange(path)}`).toBe(`${path}: true`);
  }
});

// The domain still builds its own paths — the cover cache names a cover, the
// full-text store names its cache — and the row restates that shape so the
// table can answer for a path nobody handed it. Restating it is the risk.
test("the paths the domain builds resolve to the row that restates them", () => {
  const cases: ReadonlyArray<[string, string]> = [
    [libraryBookPath(BOOK), "book-pdf"],
    [libraryBookPath(BOOK, "epub"), "book-epub"],
    [paginationFile(BOOK), "pagination"],
    [fulltextFile(BOOK), "fulltext"],
    [figuresFile(BOOK), "figures"],
    [coverImagePath(BOOK), "cover-image"],
    [coverMetaPath(BOOK), "cover-meta"],
    [coverFailurePath(BOOK), "cover-failure"],
  ];
  for (const [path, kind] of cases) {
    const hit = resolvePalace(path);
    expect(`${path} -> ${hit?.row.kind ?? "nothing"}`).toBe(`${path} -> ${kind}`);
    expect(`${path} -> ${hit?.id ?? "nothing"}`).toBe(`${path} -> ${BOOK}`);
  }
});

// The thread store writes its own file names and cannot read the catalogue —
// platform/app imports nothing — so the wrapper it puts around a store key is
// written twice over: once as the rule in platform/app/threads.ts and once as
// the pattern on each conversation row. Here is where the two are held
// together, in both directions: a row that holds conversations must be a file
// the store can name, and a row that holds none must be a file it never claims.
test("a conversation row's sample is the file its store key names, and nothing else is", () => {
  const conversations: ReadonlySet<string> = new Set(THREAD_KINDS);
  const wrong: string[] = [];
  for (const row of PALACE) {
    for (const path of row.samples) {
      const key = threadFileKey(path);
      if (!conversations.has(row.kind)) {
        if (key !== null) wrong.push(`${path}: ${row.kind} holds no conversation, keyed ${key}`);
        continue;
      }
      if (key === null) wrong.push(`${path}: ${row.kind} holds conversations, and is not named`);
      else if (threadFileName(key) !== path) {
        wrong.push(`${path}: keyed ${key}, which the store writes to ${threadFileName(key)}`);
      }
    }
  }
  expect(wrong).toEqual([]);
});

// --- what points at a topic ------------------------------------------------
//
// The fifth list. Deleting a topic used to take one row out of topics.json and
// leave every retell, rehearsal, observation and kept article naming an id
// nothing could resolve (docs/61 「问题」). What is settled is now a fold over the
// table, so the way it can go wrong is a kind that keeps a topicId and never
// says so — which the grep below is against.

// Every file under src/ declaring a topicId field, and the kinds the records it
// describes are stored as. A file declaring one has to be in this map or in the
// list under it: deciding whether a new topicId reaches disk, and under which
// kind, is the point.
const STORES_A_TOPIC_ID: Record<string, readonly PalaceKind[]> = {
  "info/labs/types.ts": ["info-labs"],
  "memory/usage/model-calls.ts": ["model-calls"],
  "platform/app/threads.ts": ["info-thread", "conversation"],
  "reading/rehearsal/types.ts": ["rehearsal"],
  "reading/retell/types.ts": ["retell"],
  "reading/saved-articles.ts": ["saved-articles"],
  "reading/talk/types.ts": ["outline"],
  "soul/sequence.ts": ["soul-sequence"],
};

// The rest: a topic id in flight — what is on the desk, what a call is in, what
// a sweep owes, what a store was asked to start — none of which is a record.
const CARRIES_ONE_IN_MEMORY: readonly string[] = [
  "App.tsx",
  "conversations/search.ts",
  "conversations/tools.ts",
  "conversations/topic-of.ts",
  "desk/types.ts",
  "memory/filing/settle.ts",
  "memory/live/live.ts",
  "memory/observations/arrears.ts",
  "memory/observations/recall.ts",
  "reading/desk.ts",
  "reading/rehearsal/store.ts",
  "reading/retell/store.ts",
  "reading/session/hangup.ts",
  "reading/talk/store.ts",
  // A source unit names the topic its conversation is filed under; the table is built in memory each sweep.
  "reading/distill/source.ts",
  // A translation's task book and what it left behind carry the topic the
  // bilingual document is attached to. The run's own record is legion's file,
  // not one of these.
  "reading/translate/book-run.ts",
  "reading/translate/tool-live.ts",
  "reading/translate/tool.ts",
  "ui/components/info/saveArticle.ts",
  // The phone's shelf and reader carry the topic a book was opened from, so
  // leaving it can mark that file as read (docs/70). Nothing here is a record.
  "ui/components/phone/PhoneReader.tsx",
  "ui/components/phone/PhoneShelf.tsx",
  "ui/components/phone/shelf-list.ts",
];

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const DECLARES = /^[ \t]*topicId\??: [^;\n]*;$/m;

function filesDeclaringATopicId(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) filesDeclaringATopicId(path, out);
    else if (/\.tsx?$/.test(name) && DECLARES.test(readFileSync(path, "utf8"))) {
      out.push(relative(SRC, path));
    }
  }
  return out;
}

test("a file that declares a topicId has said whether it reaches disk", () => {
  const known = new Set([...Object.keys(STORES_A_TOPIC_ID), ...CARRIES_ONE_IN_MEMORY]);
  expect(filesDeclaringATopicId(SRC).filter((f) => !known.has(f))).toEqual([]);
});

test("a kind that stores a topicId declares the reference and what becomes of it", () => {
  const acted = new Set(cascadeOfTopic().map((s) => s.kind));
  const undeclared: string[] = [];
  for (const [file, kinds] of Object.entries(STORES_A_TOPIC_ID)) {
    for (const kind of kinds) {
      if (!acted.has(kind)) undeclared.push(`${file}: ${kind} does not point at topics`);
    }
  }
  expect(undeclared).toEqual([]);
});

// A reference to a topic that says nothing about deletion is the state this
// replaced: the row knew, and the delete did not.
test("every reference to a topic carries an action", () => {
  const silent = PALACE.filter((r) =>
    r.refs.some((ref) => ref.kind === "topics" && ref.onDelete === undefined),
  ).map((r) => r.kind);
  expect(silent).toEqual([]);
});

// The two kinds that outlive the topic they name are decisions (an archival
// label in docs/48 and docs/50, a cache, a field nothing writes yet), and a
// decision nobody can read is one nobody can check.
test("a kind that keeps a deleted topic's id says why", () => {
  const mute = cascadeOfTopic()
    .filter((s) => s.action === "keep")
    .map((s) => rowOf(s.kind))
    .filter((r) => r.note === undefined)
    .map((r) => r.kind);
  expect(mute).toEqual([]);
});
