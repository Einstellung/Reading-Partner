// Live wiring of the observation module: the AppData fs behind ObservationFs,
// the one store and the one adapter per topic over it for the app's lifetime,
// the distillation entry points — a reading conversation on hangup or a trim, a
// stretch of silent marking picked up by the arrears sweep, a retell when the
// reader leaves the retell — all on the real model through runAgentTurn with the
// same provider config as chat, and a tiny change feed so the observations panel
// refreshes after background writes.

import { resolveModel } from "../../ai/model-call";
import {
  runSubagentTurnLive,
  type SubagentFailure,
  type SubagentOutcome,
} from "../../legion/subagent";
import { StoppedError } from "../../legion/execute/watchdog";
import { peekAnnotations } from "../../platform/app/annotations";
import { logEvent, type EventPayload } from "../../platform/app/events";
import { observeAppLifecycle } from "../../platform/app/lifecycle";
import { AI_EVENT_TOPIC } from "../../platform/app/structured-output";
import { peekThreads } from "../../platform/app/threads";
import { listTopics } from "../../platform/app/topics";
import { loadFeedback } from "../profile/feedback";
import {
  isGuessDue,
  runProfileGuessPass,
  type GuessTopicEvidence,
} from "../profile/guess";
import {
  loadGuessState,
  loadProfileForWrite,
  saveGuessState,
  saveProfile,
} from "../profile/profile";
import { FileObservationAdapter, type ObservationAdapter } from "../observations/adapter";
import {
  SWEEP_INTERVAL_MS,
  MIN_NEW_MARKS,
  distillUnits,
  pagelessMarkIds,
  threadArrears,
  toDistillAnnotations,
  countNewMarks,
  type BookArrears,
  type DistillJob,
  type SourceUnit,
  type ThreadArrears,
  type TopicArrears,
} from "../observations/arrears";
import { collectSourceArrears, findSourceUnit } from "../distill/info-thread";
import {
  ObservationFileStore,
  topicPassStore,
  type ObservationConflict,
  type ObservationMeta,
} from "../observations/store";
import type { TopicObservations } from "../observations/recall";
import type { Observation, ObservationIndexEntry } from "../observations/types";
import {
  distillFailurePayload,
  distillWritePayload,
  failureIdentity,
  markCursor,
  messageCursor,
  runDistillPass,
  runMarksDistillPass,
  type DistillAnnotation,
  type DistillMessage,
  type DistillStatement,
  type DistillUnitPart,
} from "../observations/distill";
import { runRetellDistillPass } from "../observations/retell";
import { addContradiction, addEvidence, listStatements } from "./statements";
import {
  createDistillGate,
  createSweeps,
  type DistillTrigger,
  type Sweeps,
} from "./sweeps";

// The observation filesystem lives in fs.ts, which the statement store reads
// too; re-exported here because this is where every caller has always found it.
export { observationFs } from "./fs";
import { observationFs } from "./fs";

// One store for the whole library (store.ts). The adapters stay per topic
// because a mount is per topic: what a reading session loads and what it stamps
// on what it writes is the topic it is in.
const store = new ObservationFileStore(observationFs);
const adapters = new Map<string, FileObservationAdapter>();

export function getObservationAdapter(topicId: string): ObservationAdapter {
  let a = adapters.get(topicId);
  if (!a) {
    a = new FileObservationAdapter(store, topicId);
    adapters.set(topicId, a);
  }
  return a;
}

export async function getLastDistillation(topicId: string): Promise<number | null> {
  return (await store.getMeta(topicId)).lastDistilledAt;
}

// The conflict copies sync left in the store (store.ts). Its own entry point
// rather than a method on the adapter: a conflict copy is an artifact of the
// file engine and of sync, not something an observation engine would have to be
// able to answer for. Unfiltered, because a copy is the other device's bytes and
// this build does not rewrite it — one written before observations carried a
// topic names none, and filtering would be the one thing that can make it
// invisible again.
export function listObservationConflicts(): Promise<ObservationConflict[]> {
  return store.listConflicts();
}

// The parsed observation index for one topic (what a prompt would load), read
// through the live store. Used by the cross-scenario assembly (assemble.ts) to
// gather a reading-episode signal across every topic.
export function readObservationIndex(topicId: string): Promise<ObservationIndexEntry[]> {
  return store.readIndex(topicId);
}

// Every other topic's observations, in full, for the cross-topic half of recall
// (observations/recall.ts). One read of the flat store, grouped by the topic
// each entry names, rather than one read per topic directory.
//
// A read that fails contributes nothing rather than failing the search — same
// posture as assembleReadingContext, and for the same reason: the widening is an
// addition, and an addition must not be able to take away what the topic in hand
// already answered. A topic with no observations never becomes a group, so a
// search does no work for it.
//
// Cost on the owner's store, 2026-08-31: two peer topics, 37 observations,
// 56 KB, 0.3 ms to read and parse and 1.3 ms to rank — in front of a model
// call, which is why this is read per search rather than cached. store.list()
// holds no cache, so every search sees what the last distillation pass wrote.
export async function listOtherTopicObservations(topicId: string): Promise<TopicObservations[]> {
  const entries = await store.list().catch((): Observation[] => []);
  const names = new Map((await listTopics().catch(() => [])).map((t) => [t.id, t.name]));
  const groups = new Map<string, Observation[]>();
  for (const entry of entries) {
    // An entry belonging to no topic at all belongs to no group either: the
    // label is what names the group, and inventing one would put another book's
    // record under this reader's current topic name.
    if (!entry.topic || entry.topic === topicId) continue;
    const group = groups.get(entry.topic);
    if (group) group.push(entry);
    else groups.set(entry.topic, [entry]);
  }
  return [...groups].map(([id, group]) => ({
    topicId: id,
    topicName: names.get(id) ?? id,
    entries: group,
  }));
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
  // Absent on a conversation that hangs off no book — a briefing, a call about
  // one article. Nothing is stamped with a book then, and the pass has no mark
  // cursor to move (distill.ts).
  bookId?: string;
  bookName: string;
  threadId: string;
  trigger: DistillTrigger;
  annotationId: string;
  page: number | null;
  markedText: string;
  messages: DistillMessage[];
  // The threads `messages` was merged from, when it was merged from more than
  // one (memory/observations/arrears.ts). Each carries a cursor over its own
  // messages and the pass moves all of them. Absent is the single-thread pass.
  parts?: readonly DistillUnitPart[];
  // The book's annotations, so distillation can fold in silent marks made since
  // the last pass (docs/02 part 2). Absent/empty is fine.
  annotations?: DistillAnnotation[];
  // Cancels the pass. No trigger passes one, and the reason is the same for all
  // of them: a pass has to outlive the thing that started it.
  //
  // Hangup (reading/session/use-call.ts) fires the pass and then aborts the chat
  // turn's controller — that controller is the only signal in scope and handing it over
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

// What every distillation pass needs of the statement store: the statements the
// prompt numbers, and the two edges a relation writes. Read once per pass — the
// file is one read and a pass is a model call, so the cost is nothing next to
// what it is attached to.
//
// Superseded ones are filtered where they are rendered (distill.ts), not here:
// what a pass may point at is the prompt's business.
async function heldAboutReader(): Promise<readonly DistillStatement[]> {
  return await listStatements();
}

const statementEdges = {
  addEvidence: (id: string, observationIds: readonly string[]) => addEvidence(id, observationIds),
  addContradiction: (id: string, observationId: string) => addContradiction(id, observationId),
};

// One pass at a time per subject: a thread id for a transcript pass, "marks:<bookId>"
// for a silent-marking pass. Covers every trigger, so the sweep cannot start a
// second pass over what a hangup is already distilling (sweeps.ts).
let gate = createDistillGate();

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
          ...(opts.parts ? { parts: opts.parts } : {}),
          annotations: opts.annotations,
          minNewMessages,
          statements: await heldAboutReader(),
        },
        {
          store: topicPassStore(store, opts.topicId),
          adapter: getObservationAdapter(opts.topicId),
          otherTopics: () => listOtherTopicObservations(opts.topicId),
          statementEdges,
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
          ...distillFailurePayload({
            stage: "run",
            outcome: result.outcome,
            ...(result.cause ? { cause: result.cause } : {}),
            coverage: result.coverage,
            counts: result,
          }),
          ...distillWritePayload(result),
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
        ...distillWritePayload(result),
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
        ...distillFailurePayload({ stage: "setup", error: e }),
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
          statements: await heldAboutReader(),
        },
        {
          store: topicPassStore(store, opts.topicId),
          adapter: getObservationAdapter(opts.topicId),
          otherTopics: () => listOtherTopicObservations(opts.topicId),
          statementEdges,
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
          ...distillFailurePayload({
            stage: "run",
            outcome: result.outcome,
            ...(result.cause ? { cause: result.cause } : {}),
            coverage: result.coverage,
            counts: result,
          }),
          ...distillWritePayload(result),
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
        ...distillWritePayload(result),
      });
      notifyObservationChange(opts.topicId);
    } catch (e) {
      if (e instanceof StoppedError) return;
      console.warn("mark distillation could not start", e);
      logEvent(opts.topicId, "distill-failed", {
        bookId: opts.bookId,
        trigger: opts.trigger,
        ...distillFailurePayload({ stage: "setup", error: e }),
      });
    }
  });
}

// --- conversations that hang off no book (memory/distill) ---

// One registered source's unit, distilled as the conversation it is: no book id,
// so nothing it writes is stamped with a book and no mark cursor moves; the
// source's label is what the prompt calls it. Everything else — the gate, the
// cursor under the unit's id, the two log lines — is the transcript pass.
function distillSourceUnit(
  topicId: string,
  topicName: string,
  unit: SourceUnit,
  trigger: DistillTrigger,
): Promise<void> {
  return distillThread({
    topicId,
    topicName,
    bookName: unit.label,
    threadId: unit.id,
    annotationId: "",
    page: null,
    markedText: "",
    messages: unit.messages,
    trigger,
  });
}

export interface DistillInfoThreadOptions {
  // The thread that just closed. A thread no registered source lists — the
  // onboarding one, whose id repeats across days (docs/pitfall/209) — distils
  // nothing rather than being guessed at.
  threadId: string;
  trigger: DistillTrigger;
}

/**
 * Distil one info conversation on the way out: the chat closed, or the voice
 * call hung up.
 *
 * Never throws and never surfaces UI, the same posture as every other trigger:
 * the reader closed a conversation and is owed nothing about the bookkeeping
 * behind it. A conversation this misses is picked up by the half-hourly sweep,
 * which reads the same source.
 */
export async function distillInfoThread(opts: DistillInfoThreadOptions): Promise<void> {
  try {
    const found = await findSourceUnit(opts.threadId);
    if (!found) return;
    // A conversation nothing has filed yet distils nothing: an observation has
    // to be written under a topic, and there is none to write it under.
    const topicId = found.unit.topicId;
    if (topicId === null) return;
    const topic = (await listTopics()).find((t) => t.id === topicId);
    await distillSourceUnit(
      topicId,
      topic?.name ?? topicId,
      found.unit,
      opts.trigger,
    );
  } catch (e) {
    if (e instanceof StoppedError) return;
    console.warn("info distillation could not start", e);
  }
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
  // One read of each topic's meta for the whole sweep: the source units are
  // grouped by a topic id the sweep has not reached yet when their cursor is
  // asked for, and re-reading meta.json per unit would be a file read per
  // conversation on disk.
  const metas = new Map<string, ObservationMeta>();
  const metaOf = async (topicId: string): Promise<ObservationMeta> => {
    let meta = metas.get(topicId);
    if (!meta) {
      meta = await store.getMeta(topicId);
      metas.set(topicId, meta);
    }
    return meta;
  };
  // What the registered sources owe, by topic (memory/distill). Collected up
  // front so a topic that owns no book still gets its conversations looked at —
  // "brief" is exactly that topic.
  const sourceArrears = await collectSourceArrears(
    async (topicId, unitId) => messageCursor(await metaOf(topicId), unitId),
    { isBusy: threadBusy },
  );
  const out: TopicArrears[] = [];
  for (const topic of topics) {
    const meta = await metaOf(topic.id);
    const books: BookArrears[] = [];
    const seen = new Set<string>();
    for (const file of topic.files) {
      const bookId = file.hash;
      if (!bookId || seen.has(bookId)) continue;
      seen.add(bookId);
      const marks = toDistillAnnotations(await peekAnnotations(bookId));
      const byId = new Map(marks.map((m) => [m.id, m]));
      // By unit, not by thread: a chat-span aside's transcript is part of its
      // parent's (distillUnits), so it is neither offered as a pass of its own
      // nor left out of what the parent owes.
      const stored = await peekThreads(bookId);
      const busy = new Set(stored.filter((t) => threadBusy(t.id)).map((t) => t.id));
      const threads: ThreadArrears[] = [];
      for (const unit of distillUnits(stored, pagelessMarkIds(marks))) {
        // A thread with a reply still being written is left out, and so is the
        // unit it is part of: a pass over half a sentence is a pass over the
        // wrong transcript, and the next sweep picks it up. Only threads whose
        // messages are actually in this transcript — a mark-anchored aside is a
        // unit of its own and holds up nothing.
        if (unit.parts.some((p) => busy.has(p.threadId))) continue;
        const anchor = byId.get(unit.annotationId);
        threads.push(
          threadArrears(
            {
              threadId: unit.threadId,
              annotationId: unit.annotationId,
              // The book-level thread has no mark and so no page of its own; the
              // sweep has no current page to stand in for it either.
              page: anchor?.page ?? null,
              markedText: anchor?.text ?? "",
              messages: unit.messages,
              parts: unit.parts,
            },
            (threadId) => messageCursor(meta, threadId),
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
    const units = sourceArrears.get(topic.id) ?? [];
    if (books.length === 0 && units.length === 0) continue;
    out.push({
      topicId: topic.id,
      topicName: topic.name,
      lastDistilledAt: meta.lastDistilledAt,
      books,
      ...(units.length > 0 ? { units } : {}),
    });
  }
  // A source may name a topic that topics.json does not have — one deleted while
  // its conversations stayed on disk. Its debt is still the reader's, so it is
  // swept under its own id rather than dropped; the id stands in for the name.
  const listed = new Set(topics.map((t) => t.id));
  for (const [topicId, units] of sourceArrears) {
    if (listed.has(topicId)) continue;
    out.push({
      topicId,
      topicName: topicId,
      lastDistilledAt: (await metaOf(topicId)).lastDistilledAt,
      books: [],
      units,
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
      ...(job.thread.parts ? { parts: job.thread.parts } : {}),
      annotations: job.book.marks,
      trigger,
    });
  }
  if (job.kind === "source") {
    return distillSourceUnit(job.topicId, job.topicName, job.unit, trigger);
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

// What was thrown and what it said, as the two fields a failed line carries. The
// same pair `distill-failed` carries (distillFailurePayload), so one log can be
// read across both passes. Never a model's words — see failureIdentity.
function failureFields(input: {
  outcome?: SubagentOutcome;
  error?: unknown;
  cause?: SubagentFailure;
}): EventPayload {
  const { name, message } = failureIdentity(input);
  return { errorName: name, errorMessage: message };
}

// Every topic's observation index, plus the newest distillation stamp across all
// of them — which is the "has the memory actually moved" half of the gate.
async function collectGuessEvidence(): Promise<{
  topics: GuessTopicEvidence[];
  newestMemoryAt: number | null;
}> {
  const topics: GuessTopicEvidence[] = [];
  let newest: number | null = null;
  for (const topic of await listTopics()) {
    const entries = await store.readIndex(topic.id).catch((): ObservationIndexEntry[] => []);
    if (entries.length) topics.push({ topicName: topic.name, entries });
    const at = (await store.getMeta(topic.id)).lastDistilledAt;
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
        profile: { load: loadProfileForWrite, save: saveProfile },
        run: runSubagentTurnLive,
        model: {
          providerId: model.providerId,
          modelId: model.modelId,
          reasoning: model.reasoning,
        },
      },
    );
    if (!result.ran) {
      // A profile that could not be read is the one skip whose stamp stays put:
      // it is an IO failure, it may well be gone by the next tick, and looking
      // again costs one file read and no model call.
      if (result.skipped === "unreadable-profile") {
        logEvent(AI_EVENT_TOPIC, "guess-failed", { trigger, outcome: result.skipped });
        return;
      }
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
      logEvent(AI_EVENT_TOPIC, "guess-failed", {
        trigger,
        outcome: result.outcome,
        ...failureFields({
          outcome: result.outcome,
          ...(result.cause ? { cause: result.cause } : {}),
        }),
      });
      return;
    }
    // The model was called, so the stamp moves whatever came of it — including a
    // refused write. Retrying costs another call, and the document that refused
    // it will still be that document in half an hour.
    await saveGuessState(stamp);
    logEvent(AI_EVENT_TOPIC, "guess-run", {
      trigger,
      wrote: result.wrote,
      guesses: result.guesses,
      dropped: result.dropped,
      refused: result.refused ?? null,
    });
  } catch (e) {
    if (e instanceof StoppedError) return;
    console.warn("profile guess pass could not start", e);
    logEvent(AI_EVENT_TOPIC, "guess-failed", {
      trigger,
      outcome: "failed",
      ...failureFields({ error: e }),
    });
  }
}

// The sweeps, bound to the real clock, the real passes and the app's own timer:
// every half hour, and again whenever the app comes back to the front (a laptop
// shut for a week wakes with a timer that has not fired). The rules about when
// they may run are in sweeps.ts.
function liveSweeps(): Sweeps {
  return createSweeps({
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
}

let sweeps = liveSweeps();

// The gate and the sweeps as this module was first imported with. One function
// for both: the sweeps hold the gate they were built with, so a gate replaced on
// its own would leave them checking the one nothing else uses. A pass abandoned
// mid-flight — the case ended, its promise never settled — leaves its subject in
// the gate for good, and every later pass over that subject is then skipped
// silently.
//
// Only for a process that never started the sweeps. `startObservationSweeps`
// hands its timer back to the caller as the undo, and rebuilding out from under
// a running one leaves that timer ticking on a Sweeps nothing can stop.
export function rebuildObservationSweepsForTests(): void {
  gate = createDistillGate();
  sweeps = liveSweeps();
}

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

export interface DistillRetellOptions {
  topicId: string;
  topicName: string;
  retellId: string;
  retellName: string;
  // The retell's materials by title.
  materials: string[];
  threadId: string;
  // The retell conversation as it stands on disk, oldest first. Which part of
  // it is new is worked out from the stored cursor (retell.ts).
  messages: DistillMessage[];
  signal?: AbortSignal;
}

// One silent distillation pass over a retell the reader has just left
// (docs/31). Same posture as distillThread: never throws, never surfaces UI, a
// failed pass is a warn plus an event and the cursor stays where it was so the
// next exit redoes the stretch.
//
// Unlike the reading trigger there is only one caller and one route into it —
// the retell view unmounting — because every way out of a retell goes through that.
export function distillRetell(opts: DistillRetellOptions): Promise<void> {
  const { threadId, topicId } = opts;
  return gate.run(threadId, async () => {
    try {
      // The chat model config, like the reading pass: this is a silent turn of the
      // reader's own conversation, not a background pipeline.
      const model = await resolveModel("chat");
      const result = await runRetellDistillPass(
        {
          topicName: opts.topicName,
          retellName: opts.retellName,
          materials: opts.materials,
          threadId,
          messages: opts.messages,
        },
        {
          store: topicPassStore(store, topicId),
          adapter: getObservationAdapter(topicId),
          otherTopics: () => listOtherTopicObservations(topicId),
          run: runSubagentTurnLive,
          model: {
            providerId: model.providerId,
            modelId: model.modelId,
            reasoning: model.reasoning,
          },
          signal: opts.signal,
        },
      );
      // Leaving a retell twice with nothing said in between is the ordinary case,
      // not something to log: the reader steps out to check the outline and comes
      // back. Nothing ran, so nothing changed.
      if (!result.ran) return;
      if (!result.ok) {
        console.warn("retell distillation did not finish:", result.failure);
        logEvent(topicId, "distill-failed", {
          threadId,
          retellId: opts.retellId,
          trigger: "talk-exit",
          ...distillFailurePayload({
            stage: "run",
            outcome: result.outcome,
            ...(result.cause ? { cause: result.cause } : {}),
            coverage: result.coverage,
            counts: result,
          }),
        });
        if (result.created + result.updated + result.deleted > 0) notifyObservationChange(topicId);
        return;
      }
      logEvent(topicId, "distill-run", {
        threadId,
        retellId: opts.retellId,
        trigger: "talk-exit",
        messages: result.distilled,
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });
      notifyObservationChange(topicId);
    } catch (e) {
      if (e instanceof StoppedError) return;
      console.warn("retell distillation could not start", e);
      logEvent(topicId, "distill-failed", {
        threadId,
        retellId: opts.retellId,
        trigger: "talk-exit",
        ...distillFailurePayload({ stage: "setup", error: e }),
      });
    }
  });
}
