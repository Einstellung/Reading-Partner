// The topic library over its file (src/platform/app/topics.ts). The pure
// selectors are in topics.test.ts; this is the half that touches disk.
//
// Nothing rebuilds a topic. The PDFs survive on disk, but the question they were
// read against, when each file was added and when it was last opened live only in
// topics.json — and lastOpenedAt is the only thing "Continue reading" has. A read
// that came back empty because it failed used to be written straight back over
// the file by the next edit, and the shelf is one sync unit, so the one-topic
// file would then go to Drive as an upload rather than a merge.
//
// The other half is that every mutator is load -> await -> save of the whole
// file, so two of them overlapping used to lose one edit. The startup hash
// backfill runs exactly that way against whatever the user does meanwhile.
//
// The Tauri fs plugin and the two Rust commands are mocked with an in-memory
// filesystem, so the assertions are about what is left in it. Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
// Type-only, so it is erased and never loads the module before mock.module runs.
import type { Topic } from "../src/platform/app/topics";

const files = new Map<string, string>();
let readFails = false;
let quarantineFails = false;

mock.module("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (path: string) => files.has(path),
  mkdir: async () => {},
  readDir: async () => [],
  readTextFile: async (path: string) => {
    if (readFails) throw new Error("EIO");
    const v = files.get(path);
    if (v === undefined) throw new Error(`no file: ${path}`);
    return v;
  },
  writeTextFile: async (path: string, content: string) => {
    files.set(path, content);
  },
}));

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { path: string; contents?: string }) => {
    if (cmd === "write_text_file_atomic") {
      files.set(args.path, args.contents ?? "");
      return null;
    }
    if (cmd === "quarantine_file") {
      if (quarantineFails) throw new Error("rename failed");
      const body = files.get(args.path);
      if (body === undefined) return null;
      const renamed = `${args.path}.corrupt-1700000000000`;
      files.set(renamed, body);
      files.delete(args.path);
      return renamed;
    }
    throw new Error(`unexpected command ${cmd}`);
  },
}));

const {
  BRIEF_TOPIC_ID,
  TOPICS_FILE,
  addFileToTopic,
  createTopic,
  deleteTopic,
  ensureBriefTopic,
  listTopics,
  markOpened,
  removeFileFromTopic,
  renameTopic,
  setFileHash,
} = await import("../src/platform/app/topics");

// Two topics, one of them holding the file "Continue reading" points at.
const SHELF: { topics: Topic[] } = {
  topics: [
    {
      id: "t1",
      name: "what makes JITs fast",
      createdAt: 1,
      files: [
        { path: "/books/jit.pdf", name: "jit.pdf", addedAt: 10, lastOpenedAt: 99, hash: "h1" },
        { path: "/books/tracing.pdf", name: "tracing.pdf", addedAt: 20 },
      ],
    },
    { id: "t2", name: "attention", createdAt: 2, files: [] },
  ],
};

const SHELF_JSON = JSON.stringify(SHELF, null, 2);
const CORRUPT = "topics.json.corrupt-1700000000000";

function onDisk(): { topics: Topic[] } {
  return JSON.parse(files.get(TOPICS_FILE)!) as { topics: Topic[] };
}

function topicOnDisk(id: string): Topic {
  return onDisk().topics.find((t) => t.id === id)!;
}

beforeEach(() => {
  files.clear();
  files.set(TOPICS_FILE, SHELF_JSON);
  readFails = false;
  quarantineFails = false;
});

// --- a read that failed for IO reasons: the bytes are still good ------------

test("a topic created over an unreadable file is refused, and the file is untouched", async () => {
  readFails = true;
  await expect(createTopic("a third question")).rejects.toThrow(/could not be read/);

  // Byte for byte what was there, and nothing was moved aside either: nothing is
  // known to be wrong with the file itself.
  expect(files.get(TOPICS_FILE)).toBe(SHELF_JSON);
  expect(files.has(CORRUPT)).toBe(false);
});

test("a delete over an unreadable file deletes nothing", async () => {
  readFails = true;
  await expect(deleteTopic("t1")).rejects.toThrow(/could not be read/);
  expect(files.get(TOPICS_FILE)).toBe(SHELF_JSON);

  // The read recovering is all it takes for the shelf to be whole again.
  readFails = false;
  const topics = await listTopics();
  expect(topics.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  expect(topics.find((t) => t.id === "t1")!.files[0].lastOpenedAt).toBe(99);
});

test("renaming, adding and removing over an unreadable file are all refused", async () => {
  readFails = true;
  await expect(renameTopic("t1", "renamed")).rejects.toThrow(/could not be read/);
  await expect(addFileToTopic("t1", "/books/new.pdf")).rejects.toThrow(/could not be read/);
  await expect(removeFileFromTopic("t1", "/books/jit.pdf")).rejects.toThrow(/could not be read/);
  expect(files.get(TOPICS_FILE)).toBe(SHELF_JSON);
});

// Keeping an article out of the briefing is a shelf edit like any other, and it
// is the one a reader reaches without ever going near the shelf: the Keep button
// on a briefing card (use-info-home.ts) calls this to find somewhere to put it.
// Over an unreadable file it would find no Brief topic, create one, and write a
// shelf holding that alone.
test("keeping a briefing article over an unreadable file is refused", async () => {
  readFails = true;
  await expect(ensureBriefTopic()).rejects.toThrow(/could not be read/);

  expect(files.get(TOPICS_FILE)).toBe(SHELF_JSON);
  expect(files.has(CORRUPT)).toBe(false);

  readFails = false;
  expect((await listTopics()).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
});

// The same refusal on the second keep, when the topic is already there: the
// lookup runs over the topics of a file that could not be read, which is none of
// them, so a Brief that exists would be created a second time and the shelf
// written as just that.
test("a second keep over an unreadable file does not write a second Brief", async () => {
  const brief = await ensureBriefTopic();
  expect(brief.id).toBe(BRIEF_TOPIC_ID);

  readFails = true;
  await expect(ensureBriefTopic()).rejects.toThrow(/could not be read/);

  readFails = false;
  const ids = (await listTopics()).map((t) => t.id).sort();
  expect(ids).toEqual(["brief", "t1", "t2"]);
});

test("the Brief topic is created once and found thereafter", async () => {
  const first = await ensureBriefTopic();
  const second = await ensureBriefTopic();

  expect(second.id).toBe(first.id);
  expect(second.createdAt).toBe(first.createdAt);
  expect(onDisk().topics.filter((t) => t.id === BRIEF_TOPIC_ID).length).toBe(1);
  // And it did not take the shelf with it on the way in.
  expect(onDisk().topics.map((t) => t.id).sort()).toEqual(["brief", "t1", "t2"]);
});

// Both of these ride along with opening a book, inside the catch that tells the
// user the file could not be opened, so they do nothing rather than raise — and
// doing nothing means writing nothing.
test("the two backfills write nothing over an unreadable file and do not raise", async () => {
  readFails = true;
  await markOpened("t1", "/books/jit.pdf");
  await setFileHash("t1", "/books/tracing.pdf", "h2");
  expect(files.get(TOPICS_FILE)).toBe(SHELF_JSON);
});

// --- bytes that will not parse: moved aside, never destroyed ----------------

// The shape today's incident had: a file cut off partway through.
const TRUNCATED = SHELF_JSON.slice(0, 120);

test("a truncated file is moved aside rather than written over", async () => {
  files.set(TOPICS_FILE, TRUNCATED);

  const topic = await createTopic("a third question");

  // The edit went through, onto a file that now holds only it: with the bad
  // bytes safely elsewhere, empty is the truth about what is left.
  expect(onDisk().topics.map((t) => t.id)).toEqual([topic.id]);
  // And the bytes themselves are still there to be read back by hand.
  expect(files.get(CORRUPT)).toBe(TRUNCATED);
});

test("content that parses into the wrong shape is quarantined too", async () => {
  const wrongShape = JSON.stringify({ topics: { t1: "not an array" } });
  files.set(TOPICS_FILE, wrongShape);

  await createTopic("a third question");
  expect(files.get(CORRUPT)).toBe(wrongShape);
  expect(onDisk().topics.length).toBe(1);
});

// Nothing could be moved anywhere, so the bad bytes are still the only copy of
// whatever is in there, and this is not the code that gets to replace them.
test("bytes that could not be moved aside are not overwritten either", async () => {
  files.set(TOPICS_FILE, TRUNCATED);
  quarantineFails = true;

  await expect(createTopic("a third question")).rejects.toThrow(/could not be read/);
  expect(files.get(TOPICS_FILE)).toBe(TRUNCATED);
});

test("a first run with no file at all still creates the first topic", async () => {
  files.delete(TOPICS_FILE);
  const topic = await createTopic("the first question");
  expect(onDisk().topics.map((t) => t.id)).toEqual([topic.id]);
});

// --- two mutators at once ---------------------------------------------------

// Each mutator reads the whole file, edits its copy and writes the whole file
// back, so two that overlap read the same library twice and the second write
// drops the first one's edit.
test("two renames at once both land", async () => {
  await Promise.all([renameTopic("t1", "JITs"), renameTopic("t2", "attention heads")]);

  const names = Object.fromEntries(onDisk().topics.map((t) => [t.id, t.name]));
  expect(names).toEqual({ t1: "JITs", t2: "attention heads" });
});

// The startup backfill's shape: setFileHash walking every file of every topic
// while the user is on the shelf doing something else.
test("a hash backfill running against a user's edit loses neither", async () => {
  await Promise.all([
    setFileHash("t1", "/books/tracing.pdf", "h2"),
    addFileToTopic("t2", "/books/attention.pdf"),
    markOpened("t1", "/books/tracing.pdf"),
  ]);

  const tracing = topicOnDisk("t1").files.find((f) => f.path === "/books/tracing.pdf")!;
  expect(tracing.hash).toBe("h2");
  expect(tracing.lastOpenedAt).toBeGreaterThan(0);
  expect(topicOnDisk("t2").files.map((f) => f.path)).toEqual(["/books/attention.pdf"]);
  // And the file that was already there is untouched by any of it.
  expect(topicOnDisk("t1").files[0].lastOpenedAt).toBe(99);
});

// A mutation that refuses must not take the queue down with it: the next one
// runs, and the rejection reaches its own caller rather than surfacing loose.
test("a refused mutation does not block the one behind it", async () => {
  readFails = true;
  await expect(createTopic("over an unreadable file")).rejects.toThrow();

  readFails = false;
  await renameTopic("t1", "JITs");
  expect(topicOnDisk("t1").name).toBe("JITs");
});
