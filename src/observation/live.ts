// Live wiring of the observation module: the Tauri fs behind ObservationFs, one
// adapter per topic for the app's lifetime, the distillation entry points — a
// reading conversation on hangup or a trim, a stretch of silent marking picked
// up by the arrears sweep, a rehearsal when the reader leaves the talk — all on
// the real model through runAgentTurn with the same provider config as chat, and
// a tiny change feed so the observations panel refreshes after background writes.

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { resolveModel } from "../ai/model-call";
import { runSubagentTurnLive } from "../ai/subagent";
import { StoppedError } from "../ai/watchdog";
import { peekAnnotations } from "../platform/app/annotations";
import { logEvent } from "../platform/app/events";
import { observeAppLifecycle } from "../platform/app/lifecycle";
import { AI_EVENT_TOPIC } from "../platform/app/structured-output";
import { peekThreads } from "../platform/app/threads";
import { listTopics } from "../platform/app/topics";
import { loadFeedback } from "./feedback";
import {
  isGuessDue,
  runProfileGuessPass,
  type GuessTopicEvidence,
} from "./guess";
import {
  loadGuessState,
  loadProfile,
  saveGuessState,
  saveProfile,
} from "./profile";
import { FileObservationAdapter, type ObservationAdapter } from "./adapter";
import {
  SWEEP_INTERVAL_MS,
  MIN_NEW_MARKS,
  threadArrears,
  toDistillAnnotations,
  countNewMarks,
  type BookArrears,
  type DistillJob,
  type ThreadArrears,
  type TopicArrears,
} from "./arrears";
import { ObservationFileStore, type ObservationFs } from "./store";
import type { ObservationIndexEntry } from "./types";
import {
  markCursor,
  messageCursor,
  runDistillPass,
  runMarksDistillPass,
  type DistillAnnotation,
  type DistillMessage,
} from "./distill";
import { runRehearsalDistillPass } from "./rehearsal";
import {
  createDistillGate,
  createSweeps,
  type DistillTrigger,
} from "./sweeps";

const tauriFs: ObservationFs = {
  async read(path) {
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return null;
    return readTextFile(path, { baseDir: BaseDirectory.AppData });
  },
  async write(path, content) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(path, content);
  },
  async remove(path) {
    await remove(path, { baseDir: BaseDirectory.AppData });
  },
  async listDir(path) {
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return [];
    const entries = await readDir(path, { baseDir: BaseDirectory.AppData });
    return entries.filter((e) => e.isFile).map((e) => e.name);
  },
};

const stores = new Map<string, ObservationFileStore>();
const adapters = new Map<string, FileObservationAdapter>();

function getStore(topicId: string): ObservationFileStore {
  let s = stores.get(topicId);
  if (!s) {
    s = new ObservationFileStore(topicId, tauriFs);
    stores.set(topicId, s);
  }
  return s;
}

export function getObservationAdapter(topicId: string): ObservationAdapter {
  let a = adapters.get(topicId);
  if (!a) {
    a = new FileObservationAdapter(getStore(topicId));
    adapters.set(topicId, a);
  }
  return a;
}

export async function getLastDistillation(topicId: string): Promise<number | null> {
  return (await getStore(topicId).getMeta()).lastDistilledAt;
}

// The parsed observation index for one topic (what a prompt would load), read
// through the live store. Used by the cross-scenario assembly (assemble.ts) to
// gather a reading-episode signal across every topic.
export function readObservationIndex(topicId: string): Promise<ObservationIndexEntry[]> {
  return getStore(topicId).readIndex();
}

// --- change feed (observations panel refresh after background writes) ---

type ObservationListener = (topicId: string) => void;
const listeners = new Set<ObservationListener>();

export function onObservationChange(cb: ObservationListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function notifyObservationChange(topicId: string): void {
  for (const cb of listeners) cb(topicId);
}

// --- distillation triggers ---

export type { DistillTrigger };

export interface DistillThreadOptions {
  topicId: string;
  topicName: string;
  bookId: string;
  bookName: string;
  threadId: string;
  trigger: DistillTrigger;
  annotationId: string;
  page: number | null;
  markedText: string;
  messages: DistillMessage[];
  // The book's annotations, so distillation can fold in silent marks made since
  // the last pass (docs/02 part 2). Absent/empty is fine.
  annotations?: DistillAnnotation[];
  // Cancels the pass. No trigger passes one, and the reason is the same for all
  // of them: a pass has to outlive the thing that started it.
  //
  // Hangup (App.tsx captureHangup) fires the pass and then aborts the chat turn's
  // controller — that controller is the only signal in scope and handing it over
  // would kill every pass the moment it started. The trim fallback
  // (buildReadingTurn) runs inside a turn that does own a signal, but that signal
  // is aborted by Stop and by hangup, and hangup is exactly when this pass matters
  // most. Nothing else can own it either: this bookkeeping has no UI, so there
  // is no Stop for the reader to press.
  //
  // So the signal is here for a caller that does have a claim on a pass — thread
  // deletion is the candidate — rather than being wired to a controller that
  // would cancel the wrong thing.
  signal?: AbortSignal;
}

// One pass at a time per subject: a thread id for a transcript pass, "marks:<bookId>"
// for a silent-marking pass. Covers every trigger, so the sweep cannot start a
// second pass over what a hangup is already distilling (sweeps.ts).
const gate = createDistillGate();

// One silent distillation pass for a finished (or long-running) thread.
//
// Never throws and never surfaces UI: observations are derived, and there is no
// place in the reader's world for a message about this bookkeeping — a dialog
// saying a distillation pass failed would be an interruption about something the
// reader never asked for and cannot act on. A failed pass is therefore recorded
// and nothing else: one warn line with the sub-agent's own sentence, one
// `distill-failed` event in the topic's log, and the two timestamps left where
// they were, which is what actually makes the next trigger redo the work.
//
// `minNewMessages` gates the trim fallback so it doesn't re-fire on every turn of
// a long conversation. How much of the thread is already folded in lives in the
// topic's meta.json (runDistillPass), not in memory: the sweep comes back to the
// same thread across restarts.
export function distillThread(
  opts: DistillThreadOptions,
  minNewMessages = 1,
): Promise<void> {
  const { threadId, messages } = opts;
  return gate.run(threadId, async () => {
    try {
      // Distillation runs on the chat model config, not the pipelines' — it is a
      // silent turn of the same conversation, so the sub-agent's own default
      // (the background-pipeline thinking setting) is overridden here.
      const model = await resolveModel("chat");
      const result = await runDistillPass(
        {
          topicName: opts.topicName,
          bookId: opts.bookId,
          bookName: opts.bookName,
          threadId,
          annotationId: opts.annotationId,
          page: opts.page,
          markedText: opts.markedText,
          messages,
          annotations: opts.annotations,
          minNewMessages,
        },
        {
          store: getStore(opts.topicId),
          adapter: getObservationAdapter(opts.topicId),
          run: runSubagentTurnLive,
          model: {
            providerId: model.providerId,
            modelId: model.modelId,
            reasoning: model.reasoning,
          },
          signal: opts.signal,
        },
      );
      // Nothing new since the last pass over this thread. The ordinary case once a
      // sweep looks every half hour, and not worth a log line.
      if (!result.ran) return;
      if (!result.ok) {
        // The pass did not finish, so no cursor moved (runDistillPass) and the next
        // trigger will redo this transcript. Whatever writes it managed are already
        // on disk, so the panel is still told about those.
        console.warn("observation distillation did not finish:", result.failure);
        logEvent(opts.topicId, "distill-failed", {
          threadId,
          trigger: opts.trigger,
          outcome: result.outcome,
          created: result.created,
          updated: result.updated,
          deleted: result.deleted,
        });
        if (result.created + result.updated + result.deleted > 0) {
          notifyObservationChange(opts.topicId);
        }
        return;
      }
      logEvent(opts.topicId, "distill-run", {
        threadId,
        trigger: opts.trigger,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });
      notifyObservationChange(opts.topicId);
    } catch (e) {
      // Cancellation is not a failure and is not logged as one: whoever raised the
      // signal already knows, and the stamps stay put so the next trigger redoes it.
      if (e instanceof StoppedError) return;
      // The pass never got as far as the sub-agent — no provider configured, or a
      // store read that threw. Same discipline as a pass that failed inside the run.
      console.warn("observation distillation could not start", e);
      logEvent(opts.topicId, "distill-failed", {
        threadId,
        trigger: opts.trigger,
        outcome: "failed",
      });
    }
  });
}

export interface DistillMarksOptions {
  topicId: string;
  topicName: string;
  bookId: string;
  bookName: string;
  // Every mark on the book; the pass filters against the book's cursor.
  annotations: DistillAnnotation[];
  minNewMarks?: number;
  trigger: DistillTrigger;
}

// One silent pass over a book the reader has only marked up. Same posture as
// distillThread: never throws, never surfaces UI, a failed pass leaves the
// book's mark cursor where it was.
export function distillMarks(opts: DistillMarksOptions): Promise<void> {
  const key = `marks:${opts.bookId}`;
  return gate.run(key, async () => {
    try {
      const model = await resolveModel("chat");
      const result = await runMarksDistillPass(
        {
          topicName: opts.topicName,
          bookId: opts.bookId,
          bookName: opts.bookName,
          annotations: opts.annotations,
          minNewMarks: opts.minNewMarks,
        },
        {
          store: getStore(opts.topicId),
          adapter: getObservationAdapter(opts.topicId),
          run: runSubagentTurnLive,
          model: {
            providerId: model.providerId,
            modelId: model.modelId,
            reasoning: model.reasoning,
          },
        },
      );
      if (!result.ran) return;
      if (!result.ok) {
        console.warn("mark distillation did not finish:", result.failure);
        logEvent(opts.topicId, "distill-failed", {
          bookId: opts.bookId,
          trigger: opts.trigger,
          outcome: result.outcome,
          created: result.created,
          updated: result.updated,
          deleted: result.deleted,
        });
        if (result.created + result.updated + result.deleted > 0) {
          notifyObservationChange(opts.topicId);
        }
        return;
      }
      logEvent(opts.topicId, "distill-run", {
        bookId: opts.bookId,
        trigger: opts.trigger,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });
      notifyObservationChange(opts.topicId);
    } catch (e) {
      if (e instanceof StoppedError) return;
      console.warn("mark distillation could not start", e);
      logEvent(opts.topicId, "distill-failed", {
        bookId: opts.bookId,
        trigger: opts.trigger,
        outcome: "failed",
      });
    }
  });
}

// --- the arrears sweep ---

// What every topic still owes, read off disk. Books the topic lists but has
// never opened have no id yet and so have nothing on disk to owe. A thread with
// a reply still being written is left out: a pass over half a sentence is a pass
// over the wrong transcript, and the next sweep picks it up.
async function collectArrears(
  threadBusy: (threadId: string) => boolean,
): Promise<TopicArrears[]> {
  const topics = await listTopics();
  const out: TopicArrears[] = [];
  for (const topic of topics) {
    const meta = await getStore(topic.id).getMeta();
    const books: BookArrears[] = [];
    const seen = new Set<string>();
    for (const file of topic.files) {
      const bookId = file.hash;
      if (!bookId || seen.has(bookId)) continue;
      seen.add(bookId);
      const marks = toDistillAnnotations(await peekAnnotations(bookId));
      const byId = new Map(marks.map((m) => [m.id, m]));
      const threads: ThreadArrears[] = [];
      for (const thread of await peekThreads(bookId)) {
        if (threadBusy(thread.id)) continue;
        const anchor = byId.get(thread.annotationId);
        threads.push(
          threadArrears(
            {
              threadId: thread.id,
              annotationId: thread.annotationId,
              // The book-level thread has no mark and so no page of its own; the
              // sweep has no current page to stand in for it either.
              page: anchor?.page ?? null,
              markedText: anchor?.text ?? "",
              messages: thread.messages.map(({ role, text, ts }) => ({ role, text, ts })),
            },
            messageCursor(meta, thread.id),
          ),
        );
      }
      books.push({
        bookId,
        bookName: file.name,
        marks,
        newMarks: countNewMarks(marks, markCursor(meta, bookId)),
        threads,
      });
    }
    if (books.length === 0) continue;
    out.push({
      topicId: topic.id,
      topicName: topic.name,
      lastDistilledAt: meta.lastDistilledAt,
      books,
    });
  }
  return out;
}

// The one job the sweep picked, run as the pass it is.
function runDistillJob(job: DistillJob, trigger: DistillTrigger): Promise<void> {
  if (job.kind === "thread") {
    return distillThread({
      topicId: job.topicId,
      topicName: job.topicName,
      bookId: job.book.bookId,
      bookName: job.book.bookName,
      threadId: job.thread.threadId,
      annotationId: job.thread.annotationId,
      page: job.thread.page,
      markedText: job.thread.markedText,
      messages: job.thread.messages,
      annotations: job.book.marks,
      trigger,
    });
  }
  return distillMarks({
    topicId: job.topicId,
    topicName: job.topicName,
    bookId: job.book.bookId,
    bookName: job.book.bookName,
    annotations: job.book.marks,
    minNewMarks: MIN_NEW_MARKS,
    trigger,
  });
}

// --- the profile-guess pass (guess.ts) ---

// Every topic's observation index, plus the newest distillation stamp across all
// of them — which is the "has the memory actually moved" half of the gate.
async function collectGuessEvidence(): Promise<{
  topics: GuessTopicEvidence[];
  newestMemoryAt: number | null;
}> {
  const topics: GuessTopicEvidence[] = [];
  let newest: number | null = null;
  for (const topic of await listTopics()) {
    const store = getStore(topic.id);
    const entries = await store.readIndex().catch((): ObservationIndexEntry[] => []);
    if (entries.length) topics.push({ topicName: topic.name, entries });
    const at = (await store.getMeta()).lastDistilledAt;
    if (at !== null && (newest === null || at > newest)) newest = at;
  }
  return { topics, newestMemoryAt: newest };
}

// One look at whether the AI's guesses about the reader are worth redoing.
// Rides the arrears sweep's tick but gates itself on its own far slower clock
// (isGuessDue): identity does not move at the speed of a highlighter, and this
// pass reads every topic at once rather than one book.
//
// Same posture as distillation: never throws, never surfaces UI, and a pass that
// did not finish leaves the stamp where it was so the next one redoes the work.
async function runGuessPass(trigger: DistillTrigger): Promise<void> {
  try {
    const state = await loadGuessState();
    const { topics, newestMemoryAt } = await collectGuessEvidence();
    if (!isGuessDue(state, newestMemoryAt, Date.now())) return;

    const stamp = { lastRunAt: Date.now(), lastMemoryAt: newestMemoryAt };
    const model = await resolveModel("chat");
    const result = await runProfileGuessPass(
      { topics, feedback: await loadFeedback() },
      {
        profile: { load: loadProfile, save: saveProfile },
        run: runSubagentTurnLive,
        model: {
          providerId: model.providerId,
          modelId: model.modelId,
          reasoning: model.reasoning,
        },
      },
    );
    if (!result.ran) {
      // Nothing was sent to a model, so the look itself counts as the pass: the
      // stamp moves, or a profile whose markers do not parse would be looked at
      // again every half hour for as long as it stays that way.
      await saveGuessState(stamp);
      if (result.skipped === "unparseable-profile") {
        logEvent(AI_EVENT_TOPIC, "guess-failed", { trigger, outcome: result.skipped });
      }
      return;
    }
    if (!result.ok) {
      console.warn("profile guess pass did not finish:", result.failure);
      logEvent(AI_EVENT_TOPIC, "guess-failed", { trigger, outcome: result.outcome });
      return;
    }
    await saveGuessState(stamp);
    logEvent(AI_EVENT_TOPIC, "guess-run", {
      trigger,
      wrote: result.wrote,
      guesses: result.guesses,
      dropped: result.dropped,
    });
  } catch (e) {
    if (e instanceof StoppedError) return;
    console.warn("profile guess pass could not start", e);
    logEvent(AI_EVENT_TOPIC, "guess-failed", { trigger, outcome: "failed" });
  }
}

// The sweeps, bound to the real clock, the real passes and the app's own timer:
// every half hour, and again whenever the app comes back to the front (a laptop
// shut for a week wakes with a timer that has not fired). The rules about when
// they may run are in sweeps.ts.
const sweeps = createSweeps({
  gate,
  collectArrears,
  distill: runDistillJob,
  guess: runGuessPass,
  now: Date.now,
  schedule: (tick) => {
    const timer = setInterval(() => tick("timer"), SWEEP_INTERVAL_MS);
    const unobserve = observeAppLifecycle(window, {
      onForeground: () => tick("foreground"),
      onBackground: () => {},
    });
    return () => {
      clearInterval(timer);
      unobserve();
    };
  },
  warn: (message, e) => console.warn(message, e),
});

export function sweepDistillation(trigger: DistillTrigger): Promise<void> {
  return sweeps.sweepDistillation(trigger);
}

export function sweepProfileGuess(trigger: DistillTrigger): Promise<void> {
  return sweeps.sweepProfileGuess(trigger);
}

// Bind the sweep for the life of the app: once now, and on every tick after
// that. Returns the undo.
//
// The guess pass rides the same tick, always after distillation: it reads what
// distillation writes, and running the two at once would put two background
// model runs on the reader's connection for no reason.
export function startDistillSweeps(isThreadBusy: (threadId: string) => boolean): () => void {
  return sweeps.start(isThreadBusy);
}

export interface DistillRehearsalOptions {
  topicId: string;
  topicName: string;
  talkId: string;
  talkName: string;
  // The talk's materials by title.
  materials: string[];
  threadId: string;
  // The rehearsal conversation as it stands on disk, oldest first. Which part of
  // it is new is worked out from the stored cursor (rehearsal.ts).
  messages: DistillMessage[];
  signal?: AbortSignal;
}

// One silent distillation pass over a rehearsal the reader has just left
// (docs/31). Same posture as distillThread: never throws, never surfaces UI, a
// failed pass is a warn plus an event and the cursor stays where it was so the
// next exit redoes the stretch.
//
// Unlike the reading trigger there is only one caller and one route into it —
// the talk view unmounting — because every way out of a talk goes through that.
export function distillRehearsal(opts: DistillRehearsalOptions): Promise<void> {
  const { threadId, topicId } = opts;
  return gate.run(threadId, async () => {
    try {
      // The chat model config, like the reading pass: this is a silent turn of the
      // reader's own conversation, not a background pipeline.
      const model = await resolveModel("chat");
      const result = await runRehearsalDistillPass(
        {
          topicName: opts.topicName,
          talkName: opts.talkName,
          materials: opts.materials,
          threadId,
          messages: opts.messages,
        },
        {
          store: getStore(topicId),
          adapter: getObservationAdapter(topicId),
          run: runSubagentTurnLive,
          model: {
            providerId: model.providerId,
            modelId: model.modelId,
            reasoning: model.reasoning,
          },
          signal: opts.signal,
        },
      );
      // Leaving a talk twice with nothing said in between is the ordinary case,
      // not something to log: the reader steps out to check the outline and comes
      // back. Nothing ran, so nothing changed.
      if (!result.ran) return;
      if (!result.ok) {
        console.warn("rehearsal distillation did not finish:", result.failure);
        logEvent(topicId, "distill-failed", {
          threadId,
          talkId: opts.talkId,
          trigger: "talk-exit",
          outcome: result.outcome,
          created: result.created,
          updated: result.updated,
          deleted: result.deleted,
        });
        if (result.created + result.updated + result.deleted > 0) notifyObservationChange(topicId);
        return;
      }
      logEvent(topicId, "distill-run", {
        threadId,
        talkId: opts.talkId,
        trigger: "talk-exit",
        messages: result.distilled,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });
      notifyObservationChange(topicId);
    } catch (e) {
      if (e instanceof StoppedError) return;
      console.warn("rehearsal distillation could not start", e);
      logEvent(topicId, "distill-failed", {
        threadId,
        talkId: opts.talkId,
        trigger: "talk-exit",
        outcome: "failed",
      });
    }
  });
}
