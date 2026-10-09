// What runs behind the phone's hold menu (hold-delete.ts): which delete a
// confirmed item calls, the move a picked topic does, and the line said after.
// Run: scripts/t.sh tests/ui/components/phone/hold-delete.test.ts

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../../src/platform/app/topics";
import {
  holdFailedLine,
  runHoldChoice,
  runHoldMove,
  runTopicDelete,
  type HoldDeleteDeps,
} from "../../../../src/ui/components/phone/hold-delete";
import type { HoldSubject } from "../../../../src/ui/components/phone/hold-menu";

const file = (path: string, hash?: string): FileRef => ({ path, name: path, ...(hash ? { hash } : {}) }) as FileRef;
const topic = (id: string, name: string, files: FileRef[] = []): Topic => ({ id, name, createdAt: 0, files });

function fakeDeps(over: Partial<HoldDeleteDeps> = {}): { deps: HoldDeleteDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: HoldDeleteDeps = {
    removeFromTopic: async (topicId, f) => {
      calls.push(`remove ${topicId} ${f.path}`);
      return true;
    },
    removeSavedArticle: async (id) => {
      calls.push(`saved ${id}`);
    },
    deleteAside: async (t, id) => {
      calls.push(`aside ${t.bookId} ${id}`);
      return { threads: [id], marks: [] };
    },
    deleteTopic: async (id, files) => {
      calls.push(`topic ${id} ${files.join(",")}`);
      return [...files];
    },
    moveFile: async (hash, to) => {
      calls.push(`move ${hash} ${to}`);
      return { hash, from: { id: "t1", name: "Transformers" }, to: { id: to, name: "Minds" } };
    },
    ...over,
  };
  return { deps, calls };
}

const pdf: Extract<HoldSubject, { kind: "file" }> = {
  kind: "file",
  topicId: "t1",
  topicName: "Transformers",
  file: file("attn.pdf", "p1"),
  title: "Attention Is All You Need",
  article: false,
};

test("each choice calls its own delete and answers its line", async () => {
  const { deps, calls } = fakeDeps();
  expect(await runHoldChoice("delete-file", pdf, deps)).toBe("Deleted “Attention Is All You Need”");
  expect(await runHoldChoice("remove-saved", { kind: "saved", id: "s1", title: "x" }, deps)).toBe(
    "Removed from Saved",
  );
  expect(
    await runHoldChoice("delete-aside", { kind: "aside", bookId: "p1", topicId: "t1", asideId: "a1", question: "q" }, deps),
  ).toBe("Aside deleted");
  expect(calls).toEqual(["remove t1 attn.pdf", "saved s1", "aside p1 a1"]);
});

test("a failed delete throws, so the item comes back", async () => {
  const { deps } = fakeDeps({
    removeSavedArticle: async () => {
      throw new Error("disk");
    },
  });
  await expect(runHoldChoice("remove-saved", { kind: "saved", id: "s1", title: "x" }, deps)).rejects.toThrow("disk");
  expect(holdFailedLine("remove-saved")).toBe("It could not be removed from Saved.");
});

test("a move goes by the book id and says where the file went", async () => {
  const { deps, calls } = fakeDeps();
  expect(await runHoldMove(pdf, { id: "t2", name: "Minds" }, deps)).toBe("Moved to “Minds”");
  expect(calls).toEqual(["move p1 t2"]);
});

test("a move that moved nothing throws, and so does a file with no book id", async () => {
  await expect(runHoldMove(pdf, { id: "t2", name: "Minds" }, fakeDeps({ moveFile: async () => null }).deps)).rejects.toThrow();
  const { deps, calls } = fakeDeps();
  await expect(runHoldMove({ ...pdf, file: file("attn.pdf") }, { id: "t2", name: "Minds" }, deps)).rejects.toThrow();
  expect(calls).toEqual([]);
  expect(holdFailedLine("move-file")).toBe("It could not be moved.");
});

test("a topic delete names the files that actually went", async () => {
  const t = topic("t1", "Cities", [file("a.epub", "h1"), file("b.epub", "h2"), file("c.epub", "h3")]);
  const { deps, calls } = fakeDeps({ deleteTopic: async () => ["h1", "h2"] });
  expect(await runTopicDelete(t, [t], ["h1", "h2", "h3"], {}, deps)).toBe("Deleted “Cities”, 2 books");
  expect(calls).toEqual([]);
  const none = fakeDeps({ deleteTopic: async () => [] });
  expect(await runTopicDelete(t, [t], [], {}, none.deps)).toBe("Deleted “Cities”");
  const one = fakeDeps({ deleteTopic: async () => ["h3"] });
  expect(await runTopicDelete(t, [t], ["h3"], {}, one.deps)).toBe("Deleted “Cities” and 1 book");
});
