// Giving a run's answer back inside the book it was asked in (docs/68).
//
// The soul rings the bell and this lays the desk the question was asked over:
// the same book, the same thread, the same assembly a reading turn uses. What it
// is not is the reader's own turn — nobody is watching it, there is no page open
// and no rendered picture of one, so the ref is what can be read off disk and
// nothing else. The bell itself rides as one trailing message that is never
// written to the thread (reading/desk.ts: `trailing`).

import { loadAnnotations } from "../platform/app/annotations";
import { getLibraryEntry } from "../platform/app/library";
import { loadThreads } from "../platform/app/threads";
import { listTopics } from "../platform/app/topics";
import { getFulltext } from "../fulltext/store";
import { registerDelivery, type Delivery, type DeliveryInput } from "../soul";
import { buildReadingTurn } from "./turn";

/**
 * Assemble the turn that answers a bell inside a book. Null when there is no
 * such book any more, or the turn could not be assembled — the bell then falls
 * back to the door, which is where a conversation with nowhere else to go goes.
 */
export async function openBookDelivery(input: DeliveryInput): Promise<Delivery | null> {
  const { origin } = input;
  if (origin.place !== "book") return null;
  const { bookId, threadId } = origin;
  const entry = await getLibraryEntry(bookId).catch(() => null);
  if (!entry) return null;
  // The thread file has to be in memory before the desk reads the conversation
  // off it: nothing on this path went through the reader's session.
  await loadThreads(bookId).catch(() => ({}));
  const annotations = await loadAnnotations(bookId).catch(() => []);
  const fulltext = await getFulltext(bookId).catch(() => null);
  const topics = await listTopics().catch(() => []);
  const topic = topics.find((t) => t.files.some((f) => f.hash === bookId)) ?? null;
  const turn = await buildReadingTurn({
    settings: input.settings,
    bookId,
    threadId,
    annotationId: origin.annotationId ?? "",
    annotation: annotations.find((a) => a.id === origin.annotationId),
    annotations,
    fulltext,
    figures: [],
    // No canvas and no loaded engine on this path: a figure the answer names is
    // a figure the reader opens for themselves.
    buffer: null,
    context: {
      topicId: topic?.id ?? null,
      topicName: topic?.name ?? "",
      fileName: entry.title,
      pageLabel: origin.page === undefined ? null : String(origin.page),
      pageIndex: origin.page === undefined ? null : origin.page - 1,
      files: [],
    },
    getPipeline: () => null,
    distillAnnotations: () => [],
    trailing: { role: "user", text: input.bell },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!turn) return null;
  return {
    key: bookId,
    threadId,
    turn: {
      systemPrompt: turn.systemPrompt,
      tools: turn.tools,
      messages: turn.messages,
      refusal: turn.refusal,
    },
  };
}

/** Say that a run delegated from a book is answered in that book. The undo is for tests. */
export function registerBookDelivery(): () => void {
  return registerDelivery("book", openBookDelivery);
}
