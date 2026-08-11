// The two pure selectors over the topic library (src/platform/app/topics.ts).
// They decide what the vestibule's "Continue reading" opens and the order the
// library screen lists a topic's files in. Breakage is silent — the wrong book
// opens and nothing is logged — so the fallbacks are pinned here. The rest of
// the module is fs-backed and covered by its callers. Run: bun test.

import { expect, test } from "bun:test";
import {
  healTopicFiles,
  healTopics,
  mostRecentlyOpened,
  sortedFiles,
  type FileRef,
  type Topic,
} from "../src/platform/app/topics";

function file(name: string, addedAt: number, lastOpenedAt?: number) {
  return { path: `/books/${name}`, name, addedAt, ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }) };
}

function topic(id: string, files: ReturnType<typeof file>[]): Topic {
  return { id, name: `topic ${id}`, createdAt: 0, files };
}

test("mostRecentlyOpened picks the newest open across topics and names its topic", () => {
  const a = topic("a", [file("old.pdf", 1, 100), file("newest.pdf", 1, 300)]);
  const b = topic("b", [file("middle.pdf", 1, 200)]);
  const hit = mostRecentlyOpened([a, b]);
  expect(hit?.topic.id).toBe("a");
  expect(hit?.file.name).toBe("newest.pdf");
});

// The guard is `lastOpenedAt === undefined`, not a `?? 0` fallback: a file that
// was added but never opened must never be offered as "continue reading", even
// when it is the only file in the library and was added recently.
test("a file that was never opened never wins, even as the only file", () => {
  expect(mostRecentlyOpened([topic("a", [file("unread.pdf", 999)])])).toBeNull();
  const hit = mostRecentlyOpened([topic("a", [file("unread.pdf", 999), file("read.pdf", 1, 5)])]);
  expect(hit?.file.name).toBe("read.pdf");
});

test("mostRecentlyOpened is null for an empty library and for topics with no files", () => {
  expect(mostRecentlyOpened([])).toBeNull();
  expect(mostRecentlyOpened([topic("a", [])])).toBeNull();
});

test("sortedFiles is most-recently-opened first, falling back to addedAt", () => {
  // never-opened but added late (50) outranks opened-long-ago (10).
  const t = topic("a", [file("opened-early.pdf", 1, 10), file("added-late.pdf", 50), file("opened-late.pdf", 1, 90)]);
  expect(sortedFiles(t).map((f) => f.name)).toEqual([
    "opened-late.pdf",
    "added-late.pdf",
    "opened-early.pdf",
  ]);
});

test("sortedFiles leaves the topic's own array alone", () => {
  const t = topic("a", [file("b.pdf", 1, 10), file("a.pdf", 1, 90)]);
  const before = t.files.map((f) => f.name);
  sortedFiles(t);
  expect(t.files.map((f) => f.name)).toEqual(before);
});

// --- repairing references an iOS import wrote as a file URL -----------------

const IOS_URL = "file:///private/var/mobile/tmp/Inbox/%E4%B8%AD%E6%96%87%20a.pdf";

test("a file URL reference becomes a path, and its name the real filename", () => {
  const refs: FileRef[] = [
    { path: IOS_URL, name: "%E4%B8%AD%E6%96%87%20a.pdf", addedAt: 5, lastOpenedAt: 9, hash: "h1" },
  ];
  const [healed] = healTopicFiles(refs);
  expect(healed.path).toBe("/private/var/mobile/tmp/Inbox/中文 a.pdf");
  expect(healed.name).toBe("中文 a.pdf");
  // The book id is the content hash, so nothing about identity moves.
  expect(healed.hash).toBe("h1");
  expect(healed.lastOpenedAt).toBe(9);
  expect(healed.addedAt).toBe(5);
});

test("a name left encoded beside an already-plain path is decoded too", () => {
  const refs: FileRef[] = [{ path: "/books/中文.pdf", name: "%E4%B8%AD%E6%96%87.pdf", addedAt: 1 }];
  expect(healTopicFiles(refs)[0].name).toBe("中文.pdf");
});

// Identity again (see library.test.ts): topics.json is one sync unit, and a
// launch that repairs nothing must not write.
test("clean references come back unchanged, by identity", () => {
  const refs: FileRef[] = [
    { path: "/books/a.pdf", name: "a.pdf", addedAt: 1 },
    { path: "/books/50%.pdf", name: "50%.pdf", addedAt: 2 },
    { path: "C:\\books\\中文.pdf", name: "中文.pdf", addedAt: 3 },
  ];
  expect(healTopicFiles(refs)).toBe(refs);
  const topics = [topic("a", []), { ...topic("b", []), files: refs }];
  expect(healTopics(topics)).toBe(topics);
});

test("repairing is idempotent", () => {
  const refs: FileRef[] = [{ path: IOS_URL, name: "%E4%B8%AD%E6%96%87%20a.pdf", addedAt: 1 }];
  const once = healTopicFiles(refs);
  expect(healTopicFiles(once)).toBe(once);
});

// The encoded and the decoded reference are the same file on disk; leaving both
// would show the book twice in the library.
test("two references that normalize to one path collapse into one", () => {
  const refs: FileRef[] = [
    { path: IOS_URL, name: "%E4%B8%AD%E6%96%87%20a.pdf", addedAt: 20, lastOpenedAt: 30 },
    {
      path: "/private/var/mobile/tmp/Inbox/中文 a.pdf",
      name: "中文 a.pdf",
      addedAt: 10,
      lastOpenedAt: 80,
      hash: "h1",
    },
  ];
  const healed = healTopicFiles(refs);
  expect(healed).toHaveLength(1);
  expect(healed[0].path).toBe("/private/var/mobile/tmp/Inbox/中文 a.pdf");
  // Whichever half of the pair knew something keeps it.
  expect(healed[0].hash).toBe("h1");
  expect(healed[0].lastOpenedAt).toBe(80);
  expect(healed[0].addedAt).toBe(10);
});

test("healing does not mutate the references it was given", () => {
  const ref: FileRef = { path: IOS_URL, name: "%E4%B8%AD%E6%96%87%20a.pdf", addedAt: 1 };
  healTopicFiles([ref]);
  expect(ref.path).toBe(IOS_URL);
  expect(ref.name).toBe("%E4%B8%AD%E6%96%87%20a.pdf");
});

test("healTopics only rebuilds the topics that had something to repair", () => {
  const clean = topic("clean", [file("a.pdf", 1)]);
  const dirty = { ...topic("dirty", []), files: [{ path: IOS_URL, name: "x", addedAt: 1 }] };
  const healed = healTopics([clean, dirty]);
  expect(healed[0]).toBe(clean);
  expect(healed[1].files[0].path).toBe("/private/var/mobile/tmp/Inbox/中文 a.pdf");
});
