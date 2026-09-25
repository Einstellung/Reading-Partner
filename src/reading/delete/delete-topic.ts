// Deleting a topic: everything that pointed at it, and what the table says
// becomes of each (docs/61 「登记」, docs/50).
//
// The shape is delete-book.ts's — a domain module that owns an order of
// operations across several stores. The topic's line in the deletion log goes
// first: the row's own delete is a record-level edit that travels, but a device
// that opened one of the topic's books in the meantime edited the same record,
// and an edit outranks a delete in the merge (merge/records.ts) — the topic
// would come back. The log is read by the topic store (platform/app/topics.ts),
// which shows no topic the log says is gone, whatever topics.json holds. Then
// the references, and the topic's own row last, so a run that dies half way
// leaves a topic the reader can delete again rather than records filed under
// an id nothing can name.
//
// Which kinds are acted on is not written here. Every row that declares a
// reference to `topics` carries the action it chose (palace/kinds.ts), and
// cascadeOfTopic folds the table into the list this walks. Adding a kind that
// stores a topicId is then one decision in the row plus a handler below, and
// tests/palace/derived.test.ts fails if either half is missing.

import {
  cascadeOfTopic,
  rowOf,
  type PalaceKind,
} from "../../palace";
import { appData } from "../../platform/app/appdata";
import { BRIEF_TOPIC_ID, removeTopicRecord } from "../../platform/app/topics";
import {
  appConversationIo,
  memoizeIo,
  walkThreadFiles,
  type ThreadFile,
} from "../../conversations";
import { flushThreads, loadThreads, setThreadTopic } from "../../platform/app/threads";
import { ObservationFileStore } from "../../memory/observations/store";
import { observationFs } from "../../memory/live/fs";
import { recordDeletion } from "../../platform/app/deleted-books";
import { deleteRetell, listAllRetells } from "../retell/store";
import { deleteOutlineWithRehearsals, deleteRetellWithTalk } from "./delete-retell";
import type { Retell } from "../retell/types";
import { listAllTalkOutlines, talkOutlineOfRetell } from "../talk/store";
import type { TalkOutline } from "../talk/types";
import { deleteRehearsal, listAllRehearsals } from "../rehearsal/store";
import type { Rehearsal } from "../rehearsal/types";
import { loadSavedArticles, setSavedArticleTopic } from "../saved-articles";
import type { SavedArticle } from "../saved-articles";

/** One conversation file, reduced to what clearing a filed topic needs. */
export interface TopicThreadFile {
  fileKey: string;
  kind: string;
  threads: ReadonlyArray<{ id: string; topicId?: string }>;
}

// Everything this reaches outside itself, so the cascade can be run against
// records in memory rather than against a disk, a sync queue and a topic file.
export interface DeleteTopicDeps {
  tombstone: (topicId: string) => Promise<void>;
  listRetells: () => Promise<Retell[]>;
  outlineIdOfRetell: (retellId: string) => Promise<string | null>;
  deleteRetell: (retellId: string) => Promise<void>;
  listOutlines: () => Promise<TalkOutline[]>;
  deleteOutline: (outlineId: string) => Promise<void>;
  listRehearsals: () => Promise<Rehearsal[]>;
  deleteRehearsal: (rehearsalId: string) => Promise<void>;
  listSavedArticles: () => Promise<SavedArticle[]>;
  setArticleTopic: (articleId: string, topicId: string) => Promise<void>;
  listThreadFiles: () => Promise<TopicThreadFile[]>;
  clearThreadTopic: (fileKey: string, threadId: string) => Promise<void>;
  clearDistillCursors: (topicId: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  // The thread store coalesces its writes; the unfiled conversations are put on
  // disk before the row they were filed under goes.
  flushThreads: () => Promise<void>;
  removeTopicRecord: (topicId: string) => Promise<void>;
}

async function liveThreadFiles(): Promise<TopicThreadFile[]> {
  const io = memoizeIo(appConversationIo);
  const out: TopicThreadFile[] = [];
  for await (const file of walkThreadFiles(io) as AsyncGenerator<ThreadFile>) {
    out.push({
      fileKey: file.fileKey,
      kind: file.kind,
      threads: file.threads.map((t) => ({ id: t.id, topicId: t.topicId })),
    });
  }
  return out;
}

export const liveDeleteTopicDeps: DeleteTopicDeps = {
  tombstone: (topicId) => recordDeletion("topic", topicId, Date.now()),
  listRetells: listAllRetells,
  outlineIdOfRetell: async (retellId) => (await talkOutlineOfRetell(retellId))?.id ?? null,
  deleteRetell,
  listOutlines: listAllTalkOutlines,
  deleteOutline: deleteOutlineWithRehearsals,
  listRehearsals: listAllRehearsals,
  deleteRehearsal,
  listSavedArticles: () => loadSavedArticles(),
  setArticleTopic: async (articleId, topicId) => {
    await setSavedArticleTopic(articleId, topicId);
  },
  listThreadFiles: liveThreadFiles,
  clearThreadTopic: async (fileKey, threadId) => {
    // The store edits what it holds, so the file has to be in hand first, and
    // the write is scheduled rather than immediate — flushed once the whole
    // cascade is through.
    await loadThreads(fileKey);
    setThreadTopic(fileKey, threadId, null);
  },
  clearDistillCursors: async (topicId) => {
    // Read before writing: setMeta rewrites the file whether or not the keys
    // were there, and a rewrite is a sync revision of a file every device holds.
    const store = new ObservationFileStore(observationFs);
    const meta = await store.getMeta(topicId);
    if (meta.lastDistilledAt === null && meta.lastAnnotationDistillAt === null) return;
    await store.setMeta(topicId, { lastDistilledAt: null, lastAnnotationDistillAt: null });
  },
  removeFile: async (path) => {
    if (await appData.exists(path)) await appData.remove(path);
  },
  flushThreads,
  removeTopicRecord,
};

type Handler = (topicId: string, deps: DeleteTopicDeps) => Promise<void>;

// A retell of this topic, with the talk it produced and the rehearsals of that
// talk (delete-retell.ts).
const deleteRetells: Handler = async (topicId, deps) => {
  for (const retell of await deps.listRetells()) {
    if (retell.topicId !== topicId) continue;
    await deleteRetellWithTalk(retell.id, {
      outlineIdOfRetell: deps.outlineIdOfRetell,
      deleteTalkOutline: deps.deleteOutline,
      deleteRetell: deps.deleteRetell,
    });
  }
};

// An outline of this topic that no retell of this topic reached: one brought in
// from outside a retell, or one whose retell is already gone.
const deleteOutlines: Handler = async (topicId, deps) => {
  for (const outline of await deps.listOutlines()) {
    if (outline.topicId === topicId) await deps.deleteOutline(outline.id);
  }
};

const deleteRehearsals: Handler = async (topicId, deps) => {
  for (const rehearsal of await deps.listRehearsals()) {
    if (rehearsal.topicId === topicId) await deps.deleteRehearsal(rehearsal.id);
  }
};

// A kept article is not the topic's to delete — the reader kept it, and the
// topic was where they filed it — but its topicId is required, so it moves to
// the topic every article started in rather than losing the field (docs/21).
// Deleting Brief itself moves nothing: ensureBrief writes it back.
const reassignSavedArticles: Handler = async (topicId, deps) => {
  if (topicId === BRIEF_TOPIC_ID) return;
  for (const article of await deps.listSavedArticles()) {
    if (article.topicId === topicId) await deps.setArticleTopic(article.id, BRIEF_TOPIC_ID);
  }
};

// A conversation filed under the topic is unfiled, not deleted: what was said is
// the reader's, and the topic was a label on it (docs/21). One handler for both
// kinds of file that keep a topic per thread, run once per kind.
function clearFiledThreads(kind: PalaceKind): Handler {
  return async (topicId, deps) => {
    for (const file of await deps.listThreadFiles()) {
      if (file.kind !== kind) continue;
      for (const thread of file.threads) {
        if (thread.topicId === topicId) await deps.clearThreadTopic(file.fileKey, thread.id);
      }
    }
  };
}

// The distillation watermarks are keyed by topic, and a key for a topic that is
// gone is a cursor over nothing.
const clearCursors: Handler = (topicId, deps) => deps.clearDistillCursors(topicId);

// The local event log is named for the topic, so the file is the record.
const deleteEvents: Handler = async (topicId, deps) => {
  const path = rowOf("events").pathFor?.(topicId);
  if (path) await deps.removeFile(path);
};

// One entry per kind the cascade acts on, and nothing else. A step whose action
// is "keep" has no handler by construction: its row already says why it outlives
// the topic.
const HANDLERS: Partial<Record<PalaceKind, Handler>> = {
  events: deleteEvents,
  "info-thread": clearFiledThreads("info-thread"),
  conversation: clearFiledThreads("conversation"),
  retell: deleteRetells,
  outline: deleteOutlines,
  rehearsal: deleteRehearsals,
  "saved-articles": reassignSavedArticles,
  "observation-meta": clearCursors,
};

/** The kinds a handler was written for, so the guard can hold the two together. */
export function handledKinds(): PalaceKind[] {
  return Object.keys(HANDLERS) as PalaceKind[];
}

/**
 * Delete a topic and settle everything that named it.
 *
 * Idempotent: a second call finds no retell of the topic, no article filed under
 * it, no thread carrying it and a row already gone.
 *
 * The cascade is best-effort, one kind at a time: a rehearsal whose transcripts
 * will not delete must not keep the topic on the shelf, and everything left
 * behind is an orphan rather than a half-deleted topic. The log line and the
 * row itself are the steps that throw — the reader is told the topic is still
 * there. Brief is never logged: it is written back by ensureBrief, and a
 * deleted Brief is meant to come back empty.
 */
export async function deleteTopic(
  topicId: string,
  deps: DeleteTopicDeps = liveDeleteTopicDeps,
): Promise<void> {
  if (topicId !== BRIEF_TOPIC_ID) await deps.tombstone(topicId);
  for (const step of cascadeOfTopic()) {
    if (step.action === "keep") continue;
    const run = HANDLERS[step.kind];
    if (!run) throw new Error(`delete-topic: ${step.kind} is in the cascade with no handler`);
    try {
      await run(topicId, deps);
    } catch (e) {
      console.warn("failed to settle a kind of a deleted topic", step.kind, topicId, e);
    }
  }
  try {
    await deps.flushThreads();
  } catch (e) {
    console.warn("failed to flush the conversations unfiled from a deleted topic", topicId, e);
  }
  await deps.removeTopicRecord(topicId);
}
