// The one-time repairs and backfills the app runs on the way up
// (src/reading/session/startup-migrations). Run: bun test.

import { expect, test } from "bun:test";
import {
  runStartupMigrations,
  type StartupMigrationIo,
} from "../../../src/reading/session/startup-migrations";
import type { Topic } from "../../../src/platform/app/topics";

const topic = (files: { path: string; hash?: string }[]): Topic =>
  ({
    id: "t1",
    name: "A topic",
    files: files.map((f) => ({ path: f.path, name: f.path, hash: f.hash })),
  }) as unknown as Topic;

function fakeIo(over: Partial<StartupMigrationIo> = {}) {
  const wrote: string[] = [];
  const io: StartupMigrationIo = {
    splitSavedArticleBodies: async () => {},
    splitRehearsalRunPages: async () => {},
    repairTopicPaths: async () => false,
    repairLibraryNames: async () => false,
    listTopics: async () => [],
    readFile: async () => new Uint8Array([1]),
    importBook: async (_bytes, path) => ({ hash: `hash:${path}` }),
    migrateBookLive: async () => {},
    pathHash: (path) => `path-hash:${path}`,
    setFileHash: async (topicId, path, hash) => {
      wrote.push(`${topicId} ${path} ${hash}`);
    },
    ...over,
  };
  return { io, wrote };
}

test("a file that already carries an id is left alone", async () => {
  const reads: string[] = [];
  const { io, wrote } = fakeIo({
    listTopics: async () => [topic([{ path: "/a.pdf", hash: "already" }])],
    readFile: async (path) => {
      reads.push(path);
      return new Uint8Array([1]);
    },
  });
  expect(await runStartupMigrations(io)).toBe(false);
  expect(reads).toEqual([]);
  expect(wrote).toEqual([]);
});

test("a file with no id is imported, migrated off its path hash, and written down", async () => {
  const migrations: string[] = [];
  const { io, wrote } = fakeIo({
    listTopics: async () => [topic([{ path: "/a.pdf" }])],
    migrateBookLive: async (from, to) => {
      migrations.push(`${from} -> ${to}`);
    },
  });
  expect(await runStartupMigrations(io)).toBe(true);
  expect(migrations).toEqual(["path-hash:/a.pdf -> hash:/a.pdf"]);
  expect(wrote).toEqual(["t1 /a.pdf hash:/a.pdf"]);
});

test("books are read one at a time", async () => {
  let open = 0;
  let most = 0;
  const { io } = fakeIo({
    listTopics: async () => [topic([{ path: "/a.pdf" }, { path: "/b.pdf" }, { path: "/c.pdf" }])],
    readFile: async () => {
      open += 1;
      most = Math.max(most, open);
      await Promise.resolve();
      open -= 1;
      return new Uint8Array([1]);
    },
  });
  await runStartupMigrations(io);
  expect(most).toBe(1);
});

test("a book that cannot be read does not stop the ones after it", async () => {
  const { io, wrote } = fakeIo({
    listTopics: async () => [topic([{ path: "/gone.pdf" }, { path: "/b.pdf" }])],
    readFile: async (path) => {
      if (path === "/gone.pdf") throw new Error("no such file");
      return new Uint8Array([1]);
    },
  });
  expect(await runStartupMigrations(io)).toBe(true);
  expect(wrote).toEqual(["t1 /b.pdf hash:/b.pdf"]);
});

test("a name repair that rewrote something is itself a reason to re-read the shelf", async () => {
  const { io } = fakeIo({ repairLibraryNames: async () => true });
  expect(await runStartupMigrations(io)).toBe(true);
});

test("the repairs run before the shelf is read", async () => {
  const order: string[] = [];
  const { io } = fakeIo({
    repairTopicPaths: async () => {
      order.push("repair paths");
      return false;
    },
    repairLibraryNames: async () => {
      order.push("repair names");
      return false;
    },
    listTopics: async () => {
      order.push("list");
      return [];
    },
  });
  await runStartupMigrations(io);
  expect(order).toEqual(["repair paths", "repair names", "list"]);
});

test("a repair that throws is not the end of the backfill", async () => {
  const { io, wrote } = fakeIo({
    repairTopicPaths: async () => {
      throw new Error("disk gone");
    },
    listTopics: async () => [topic([{ path: "/a.pdf" }])],
  });
  expect(await runStartupMigrations(io)).toBe(true);
  expect(wrote).toEqual(["t1 /a.pdf hash:/a.pdf"]);
});
