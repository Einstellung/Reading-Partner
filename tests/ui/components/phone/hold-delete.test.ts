// What runs behind the phone's hold menu (hold-delete.ts): the facts read when a
// hold lands, which delete a confirmed item calls, and the line said after.
// Run: scripts/t.sh tests/ui/components/phone/hold-delete.test.ts

import { expect, test } from "bun:test";
import type { FileRef, Topic } from "../../../../src/platform/app/topics";
import {
  holdFailedLine,
  lookupHoldFacts,
  runHoldChoice,
  runTopicDelete,
  type HoldDeleteDeps,
} from "../../../../src/ui/components/phone/hold-delete";
import type { HoldSubject } from "../../../../src/ui/components/phone/hold-menu";

const file = (path: string, hash?: string): FileRef => ({ path, name: path, ...(hash ? { hash } : {}) }) as FileRef;
const topic = (id: string, name: string, files: FileRef[] = []): Topic => ({ id, name, createdAt: 0, files });

function fakeDeps(over: Partial<HoldDeleteDeps> = {}): { deps: HoldDeleteDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: HoldDeleteDeps = {
    isLastReference: async () => true,
    hasBookConversation: async () => false,
    removeFromTopic: async (topicId, f) => {
      calls.push(`remove ${topicId} ${f.path}`);
      return true;
    },
    deleteLesson: async (t) => {
      calls.push(`lesson ${t.bookId} ${t.topicId}`);
      return { threads: [], marks: [] };
    },
    deleteBookConversation: async (t) => {
      calls.push(`conversation ${t.bookId} ${t.topicId}`);
      return { threads: [], marks: [] };
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
    ...over,
  };
  return { deps, calls };
}

const pdf: HoldSubject = {
  kind: "file",
  topicId: "t1",
  topicName: "Transformers",
  file: file("attn.pdf", "p1"),
  title: "Attention Is All You Need",
  format: "pdf",
  article: false,
  bookId: "p1",
};

test("the facts of a file: its reference count, its conversation, its other topics", async () => {
  const topics = [topic("t1", "Transformers", [file("attn.pdf", "p1")]), topic("t2", "Minds", [file("attn.pdf", "p1")])];
  const { deps } = fakeDeps({ isLastReference: async () => false, hasBookConversation: async () => true });
  expect(await lookupHoldFacts(pdf, topics, deps)).toEqual({
    last: false,
    hasConversation: true,
    otherTopics: ["Minds"],
  });
});

test("a count that fails is left unknown, and a conversation read that fails is none", async () => {
  const { deps } = fakeDeps({
    isLastReference: async () => {
      throw new Error("no lists");
    },
    hasBookConversation: async () => {
      throw new Error("no threads");
    },
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const facts = await lookupHoldFacts(pdf, [], deps);
    expect("last" in facts).toBe(false);
    expect(facts.hasConversation).toBe(false);
  } finally {
    console.warn = warn;
  }
});

test("an article's conversation is never looked up", async () => {
  let asked = false;
  const { deps } = fakeDeps({
    hasBookConversation: async () => {
      asked = true;
      return true;
    },
  });
  await lookupHoldFacts({ ...pdf, article: true } as HoldSubject, [], deps);
  expect(asked).toBe(false);
});

test("a topic, a kept article and an aside need no reads", async () => {
  expect(await lookupHoldFacts({ kind: "saved", id: "s", title: "x" }, [], fakeDeps().deps)).toEqual({});
});

test("each choice calls its own delete and answers its line", async () => {
  const { deps, calls } = fakeDeps();
  expect(await runHoldChoice("delete-file", pdf, deps)).toBe("Deleted “Attention Is All You Need”");
  expect(await runHoldChoice("remove-from-topic", pdf, deps)).toBe("Removed from Transformers");
  expect(await runHoldChoice("delete-lesson", pdf, deps)).toBe("Lesson deleted");
  expect(await runHoldChoice("delete-conversation", pdf, deps)).toBe("Conversation deleted");
  expect(await runHoldChoice("remove-saved", { kind: "saved", id: "s1", title: "x" }, deps)).toBe(
    "Removed from Saved",
  );
  expect(
    await runHoldChoice("delete-aside", { kind: "aside", bookId: "p1", topicId: "t1", asideId: "a1", question: "q" }, deps),
  ).toBe("Aside deleted");
  expect(calls).toEqual([
    "remove t1 attn.pdf",
    "remove t1 attn.pdf",
    "lesson p1 t1",
    "conversation p1 t1",
    "saved s1",
    "aside p1 a1",
  ]);
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

test("a conversation delete without a book id throws rather than guessing", async () => {
  await expect(
    runHoldChoice("delete-lesson", { ...pdf, bookId: null } as HoldSubject, fakeDeps().deps),
  ).rejects.toThrow();
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
