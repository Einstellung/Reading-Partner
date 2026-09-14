// A book shared into the app from outside it (src/reading/session/shared-file):
// which URLs are ours, where the book is filed, and that one share opens one
// book however it was delivered. Run: bun test.

import { expect, test } from "bun:test";
import {
  fileSharedBook,
  isBookFileName,
  sharedBookPath,
  takeSharedBooks,
  watchSharedBooks,
  type OpenUrlStream,
  type SharedBookIo,
} from "../../../src/reading/session/shared-file";
import type { Topic } from "../../../src/platform/app/topics";

const INBOX = "file:///private/var/mobile/Containers/Data/Application/U/Documents/Inbox";

test("a book is recognised by its extension, in any case", () => {
  expect(isBookFileName("a.pdf")).toBe(true);
  expect(isBookFileName("a.EPUB")).toBe(true);
  expect(isBookFileName("a.txt")).toBe(false);
  expect(isBookFileName("pdf")).toBe(false);
  expect(isBookFileName(".pdf")).toBe(false);
});

test("a file URL naming a book gives its decoded path", () => {
  expect(sharedBookPath(`${INBOX}/%E5%85%A8%E7%90%83.pdf`)).toBe(`${INBOX.slice(7)}/全球.pdf`);
  expect(sharedBookPath(`${INBOX}/a.epub`)).toBe(`${INBOX.slice(7)}/a.epub`);
});

test("the OAuth callback and any other URL are left to their own consumer", () => {
  expect(sharedBookPath("com.example.app:/oauth2redirect?code=x&state=y")).toBeNull();
  expect(sharedBookPath("https://example.com/a.pdf")).toBeNull();
  expect(sharedBookPath(`${INBOX}/notes.txt`)).toBeNull();
});

test("a URL already taken is not taken again", () => {
  const seen = new Set<string>();
  const url = `${INBOX}/a.pdf`;
  expect(takeSharedBooks([url, "https://example.com"], seen)).toEqual([url]);
  expect(takeSharedBooks([url], seen)).toEqual([]);
});

// --- the stream -------------------------------------------------------------

function fakeStream(): OpenUrlStream & {
  emit(urls: string[]): void;
  launched: string[] | null;
  unlistened: number;
} {
  let handler: ((urls: string[]) => void) | null = null;
  const stream = {
    launched: null as string[] | null,
    unlistened: 0,
    onOpenUrl: async (h: (urls: string[]) => void) => {
      handler = h;
      return () => {
        stream.unlistened += 1;
      };
    },
    getCurrent: async () => stream.launched,
    emit: (urls: string[]) => handler?.(urls),
  };
  return stream;
}

test("the book the app was launched with is opened once, not twice", async () => {
  const stream = fakeStream();
  const url = `${INBOX}/a.pdf`;
  stream.launched = [url];
  const opened: string[] = [];

  const stop = watchSharedBooks((u) => opened.push(u), stream);
  // The listener is bound first, so a share arriving in the gap is taken; the
  // launch URL read back afterwards is the same one and must not open again.
  stream.emit([url]);
  await Promise.resolve();
  await Promise.resolve();

  expect(opened).toEqual([url]);
  stop();
  expect(stream.unlistened).toBe(1);
});

test("a book shared into the running app is opened, a callback is not", async () => {
  const stream = fakeStream();
  const opened: string[] = [];
  const stop = watchSharedBooks((u) => opened.push(u), stream);
  await Promise.resolve();
  await Promise.resolve();

  stream.emit(["com.example.app:/oauth2redirect?code=x"]);
  stream.emit([`${INBOX}/b.epub`]);
  expect(opened).toEqual([`${INBOX}/b.epub`]);
  stop();
});

// --- filing -----------------------------------------------------------------

const BRIEF: Topic = { id: "brief", name: "Brief", createdAt: 1, files: [] };

function fakeIo(over: Partial<SharedBookIo> = {}) {
  const added: Array<{ topicId: string; path: string }> = [];
  const topic: Topic = { ...BRIEF, files: [] };
  const io: SharedBookIo = {
    ensureBriefTopic: async () => topic,
    addFileToTopic: async (topicId, path) => {
      added.push({ topicId, path });
      topic.files.push({ path, name: path.split("/").pop() ?? path, addedAt: 2 });
    },
    listTopics: async () => [topic],
    ...over,
  };
  return { io, added };
}

test("a shared book is filed in the Brief topic and comes back as its row", async () => {
  const { io, added } = fakeIo();
  const filed = await fileSharedBook(`${INBOX}/%E5%85%A8%E7%90%83.pdf`, io);

  expect(added).toEqual([{ topicId: "brief", path: `${INBOX.slice(7)}/全球.pdf` }]);
  expect(filed?.topicId).toBe("brief");
  expect(filed?.file.name).toBe("全球.pdf");
  expect(filed?.file.hash).toBeUndefined();
});

test("a URL that names no book files nothing", async () => {
  const { io, added } = fakeIo();
  expect(await fileSharedBook("https://example.com/a.pdf", io)).toBeNull();
  expect(added).toEqual([]);
});
