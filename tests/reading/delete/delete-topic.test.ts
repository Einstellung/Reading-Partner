// What deleting a topic settles (src/reading/delete/delete-topic.ts, docs/61).
// Run: bun test.
//
// The world below has one topic referenced by every kind the table says points
// at a topic, and one of each pointing somewhere else. What is pinned is that
// nothing is left naming the deleted topic, that the other topic is untouched,
// and that a second run is a no-op rather than a second round of deletions.

import { expect, test } from "bun:test";
import {
  deleteTopic,
  handledKinds,
  type DeleteTopicDeps,
} from "../../../src/reading/delete/delete-topic";
import { cascadeOfTopic } from "../../../src/palace";
import { BRIEF_TOPIC_ID } from "../../../src/platform/app/topics";
import type { Retell } from "../../../src/reading/retell/types";
import type { TalkOutline } from "../../../src/reading/talk/types";
import type { Rehearsal } from "../../../src/reading/rehearsal/types";
import type { SavedArticle } from "../../../src/reading/saved-articles";

const GONE = "t1";
const KEPT = "t2";

interface World {
  retells: Retell[];
  outlines: TalkOutline[];
  rehearsals: Rehearsal[];
  articles: SavedArticle[];
  files: Array<{ fileKey: string; kind: string; threads: Array<{ id: string; topicId?: string }> }>;
  cursors: string[];
  disk: string[];
  topics: string[];
  writes: string[];
}

function world(): World {
  return {
    retells: [
      { id: "r-1", topicId: GONE, materials: [] } as unknown as Retell,
      { id: "r-2", topicId: KEPT, materials: [] } as unknown as Retell,
    ],
    outlines: [
      { id: "o-1", topicId: GONE, retellId: "r-1" } as TalkOutline,
      { id: "o-2", topicId: GONE, retellId: null } as unknown as TalkOutline,
      { id: "o-3", topicId: KEPT, retellId: "r-2" } as TalkOutline,
    ],
    rehearsals: [
      { id: "h-1", topicId: GONE, outlineId: "o-2" } as Rehearsal,
      { id: "h-2", topicId: KEPT, outlineId: "o-3" } as Rehearsal,
    ],
    articles: [
      { id: "a-1", topicId: GONE } as SavedArticle,
      { id: "a-2", topicId: KEPT } as SavedArticle,
    ],
    files: [
      { fileKey: "info-2026-09-13", kind: "info-thread", threads: [{ id: "th-1", topicId: GONE }] },
      {
        fileKey: "2026-09-13",
        kind: "conversation",
        threads: [{ id: "th-2", topicId: GONE }, { id: "th-3", topicId: KEPT }],
      },
      // A reading thread takes its topic from the book, never from a field, so
      // nothing here is the topic's to clear.
      { fileKey: "book1", kind: "reading-thread", threads: [{ id: "th-4" }] },
    ],
    cursors: [GONE, KEPT],
    disk: [`events-${GONE}.jsonl`, `events-${KEPT}.jsonl`],
    topics: [GONE, KEPT, BRIEF_TOPIC_ID],
    writes: [],
  };
}

function deps(w: World, over: Partial<DeleteTopicDeps> = {}): DeleteTopicDeps {
  const wrote = (what: string): void => {
    w.writes.push(what);
  };
  return {
    listRetells: async () => w.retells,
    outlineIdOfRetell: async (retellId) =>
      w.outlines.find((o) => o.retellId === retellId)?.id ?? null,
    deleteRetell: async (id) => {
      w.retells = w.retells.filter((r) => r.id !== id);
      wrote(`retell ${id}`);
    },
    listOutlines: async () => w.outlines,
    deleteOutline: async (id) => {
      w.outlines = w.outlines.filter((o) => o.id !== id);
      wrote(`outline ${id}`);
    },
    listRehearsals: async () => w.rehearsals,
    deleteRehearsal: async (id) => {
      w.rehearsals = w.rehearsals.filter((r) => r.id !== id);
      wrote(`rehearsal ${id}`);
    },
    listSavedArticles: async () => w.articles,
    setArticleTopic: async (articleId, topicId) => {
      w.articles = w.articles.map((a) => (a.id === articleId ? { ...a, topicId } : a));
      wrote(`article ${articleId} -> ${topicId}`);
    },
    listThreadFiles: async () => w.files,
    clearThreadTopic: async (fileKey, threadId) => {
      for (const file of w.files) {
        if (file.fileKey !== fileKey) continue;
        for (const thread of file.threads) if (thread.id === threadId) delete thread.topicId;
      }
      wrote(`thread ${fileKey} ${threadId}`);
    },
    clearDistillCursors: async (topicId) => {
      if (!w.cursors.includes(topicId)) return;
      w.cursors = w.cursors.filter((t) => t !== topicId);
      wrote(`cursors ${topicId}`);
    },
    removeFile: async (path) => {
      if (!w.disk.includes(path)) return;
      w.disk = w.disk.filter((p) => p !== path);
      wrote(`file ${path}`);
    },
    flushThreads: async () => {},
    removeTopicRecord: async (topicId) => {
      if (!w.topics.includes(topicId)) return;
      w.topics = w.topics.filter((t) => t !== topicId);
      wrote(`topic ${topicId}`);
    },
    ...over,
  };
}

// Every id still naming the deleted topic, whatever holds it.
function dangling(w: World): string[] {
  const left: string[] = [];
  for (const r of w.retells) if (r.topicId === GONE) left.push(`retell ${r.id}`);
  for (const o of w.outlines) if (o.topicId === GONE) left.push(`outline ${o.id}`);
  for (const h of w.rehearsals) if (h.topicId === GONE) left.push(`rehearsal ${h.id}`);
  for (const a of w.articles) if (a.topicId === GONE) left.push(`article ${a.id}`);
  for (const f of w.files) {
    for (const t of f.threads) if (t.topicId === GONE) left.push(`thread ${f.fileKey} ${t.id}`);
  }
  for (const c of w.cursors) if (c === GONE) left.push("cursor");
  for (const p of w.disk) if (p.includes(GONE)) left.push(`file ${p}`);
  for (const t of w.topics) if (t === GONE) left.push("topic");
  return left;
}

test("nothing is left naming the deleted topic", async () => {
  const w = world();
  await deleteTopic(GONE, deps(w));
  expect(dangling(w)).toEqual([]);
});

test("the other topic keeps everything of its own", async () => {
  const w = world();
  await deleteTopic(GONE, deps(w));
  expect({
    retells: w.retells.map((r) => r.id),
    outlines: w.outlines.map((o) => o.id),
    rehearsals: w.rehearsals.map((r) => r.id),
    articles: w.articles.map((a) => `${a.id}:${a.topicId}`),
    cursors: w.cursors,
    disk: w.disk,
    topics: w.topics,
  }).toEqual({
    retells: ["r-2"],
    outlines: ["o-3"],
    rehearsals: ["h-2"],
    articles: [`a-1:${BRIEF_TOPIC_ID}`, `a-2:${KEPT}`],
    cursors: [KEPT],
    disk: [`events-${KEPT}.jsonl`],
    topics: [KEPT, BRIEF_TOPIC_ID],
  });
});

test("the retell takes its outline with it, and the topic's row goes last", async () => {
  const w = world();
  await deleteTopic(GONE, deps(w));
  expect(w.writes).toEqual([
    `file events-${GONE}.jsonl`,
    "thread info-2026-09-13 th-1",
    "thread 2026-09-13 th-2",
    "outline o-1",
    "retell r-1",
    "outline o-2",
    "rehearsal h-1",
    `article a-1 -> ${BRIEF_TOPIC_ID}`,
    `cursors ${GONE}`,
    `topic ${GONE}`,
  ]);
});

test("a second delete writes nothing", async () => {
  const w = world();
  await deleteTopic(GONE, deps(w));
  w.writes = [];
  await deleteTopic(GONE, deps(w));
  expect(w.writes).toEqual([]);
});

// A kind that fails is an orphan, not a topic the reader is stuck with.
test("a kind that will not settle does not keep the topic on the shelf", async () => {
  const w = world();
  await deleteTopic(
    GONE,
    deps(w, {
      deleteRehearsal: async () => {
        throw new Error("no");
      },
    }),
  );
  expect(w.topics).toEqual([KEPT, BRIEF_TOPIC_ID]);
  expect(w.rehearsals.map((r) => r.id)).toEqual(["h-1", "h-2"]);
});

// The table decides what is acted on; a row that declares an action nobody wrote
// a handler for would be a silent no-op.
test("every kind the cascade acts on has a handler, and every handler is in it", async () => {
  const acting = cascadeOfTopic()
    .filter((s) => s.action !== "keep")
    .map((s) => s.kind)
    .sort();
  expect([...new Set(handledKinds())].sort()).toEqual([...new Set(acting)].sort());
});
