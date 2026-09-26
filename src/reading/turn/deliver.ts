// Giving a run's answer back inside the book it was asked in (docs/68).
//
// The soul rings the bell and this lays the desk the question was asked over:
// the same book, the same thread, the same assembly a reading turn uses. What it
// is not is the reader's own turn — nobody is watching it, there is no page open
// and no rendered picture of one, so the ref is what can be read off disk and
// nothing else. The bell itself rides as one trailing message that is never
// written to the thread (reading/desk.ts: `trailing`).

import { loadAnnotations } from "../../platform/app/annotations";
import { getLibraryEntry } from "../../platform/app/library";
import { appendMessage, loadThreads } from "../../platform/app/threads";
import { listSupplements } from "../../platform/app/supplements";
import { listTopics } from "../../platform/app/topics";
import { getFulltext } from "../../fulltext/store";
import {
  registerDelivery,
  registerLiveDelivery,
  type Delivery,
  type DeliveryHold,
  type DeliveryInput,
  type LiveDelivery,
} from "../../soul";
import { readingTurns, type LiveMessage } from "./live-turns";
import { createSteering } from "./steering";
import { buildReadingTurn } from "./turn";
import { watchingNow } from "./turn-box";

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
    // Nobody is looking at a supplement on this path: there is no reader.
    docId: bookId,
    viewing: null,
    supplements: await listSupplements(bookId).catch(() => []),
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
    // Asked when the reply lands, not now: the reader may open this very thread
    // while the turn is running, and then they read the answer as it arrives and
    // there is nothing to put in the box.
    watching: () => watchingNow({ threadId, bookId }),
    hold: (signal) => holdReadingTurn(bookId, threadId, signal),
  };
}

/**
 * Put a bell into the turn already running on that conversation (docs/72). Null
 * when there is none, when it has no queue of its own yet and ended before it
 * got one, or when the model was never handed it — the bell is then answered by
 * a turn of its own, and stays queued until it is.
 */
export async function deliverIntoReadingTurn(
  input: LiveDelivery,
): Promise<{ threadId: string; watching: boolean } | null> {
  const { origin } = input;
  if (origin.place !== "book") return null;
  const { threadId, bookId } = origin;
  const live = readingTurns<LiveMessage>().get(threadId);
  // A turn the session started carries one of these; a bell's own turn does
  // not, and two bells answered into one turn is not a thing that happens —
  // the pass takes them one at a time.
  if (!live?.delivered) return null;
  const landed = await live.delivered.say(input.runId, input.bell);
  if (!landed) return null;
  // Asked now, not when the bell was rung: the run took a while and the reader
  // may have walked over to this conversation, or away from it, meanwhile.
  return { threadId, watching: watchingNow({ threadId, bookId }) };
}

/**
 * Hold a book's conversation for the length of a bell's own turn. The turn is
 * registered the way the session's own turns are, so the thread reads as busy:
 * the reader's Stop reaches it, and their next line is steered into it instead
 * of opening a second turn on the same thread.
 *
 * It draws no row here (`silent`). Nothing streams it — the bell's sender has
 * no surface listening — so a row would sit empty until the whole reply landed
 * at once, and then sit there beside it.
 */
export function holdReadingTurn(bookId: string, threadId: string, signal?: AbortSignal): DeliveryHold {
  const turns = readingTurns<LiveMessage>();
  const controller = new AbortController();
  const stopOutside = () => controller.abort();
  signal?.addEventListener("abort", stopOutside, { once: true });
  // A line the reader says into this turn reaches the model at the end of the
  // round in flight, and goes into the thread file at that same moment — the
  // session did not write it, so it arrives in the open conversation the way
  // any outside append does (reading/thread-arrivals.ts).
  const steering = createSteering((lines) => {
    for (const line of lines) {
      appendMessage(bookId, threadId, { role: "user", text: line.text, ts: line.ts });
    }
  });
  turns.start({
    threadId,
    bookId,
    home: bookId,
    controller,
    message: { ts: Date.now() },
    steering,
    silent: true,
  });
  return {
    signal: controller.signal,
    steerable: (port) => steering.open(port),
    release: () => {
      signal?.removeEventListener("abort", stopOutside);
      turns.settle(threadId, controller);
      // Whatever the model was never handed still goes into the file where it
      // was said. No turn is started on it: the reader pressing send again is
      // the way to ask, the same as after a turn that was stopped.
      for (const line of steering.outstanding()) {
        appendMessage(bookId, threadId, { role: "user", text: line.text, ts: line.ts });
      }
    },
  };
}

/** Say that a run delegated from a book is answered in that book. The undo is for tests. */
export function registerBookDelivery(): () => void {
  const opener = registerDelivery("book", openBookDelivery);
  const live = registerLiveDelivery("book", deliverIntoReadingTurn);
  return () => {
    opener();
    live();
  };
}
