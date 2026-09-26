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
} from "../../legion/subagent";
import { StoppedError } from "../../legion/execute/watchdog";
import { logEvent } from "../../platform/app/events";
import { observeAppLifecycle } from "../../platform/app/lifecycle";
import { listTopics } from "../../platform/app/topics";
import { FileObservationAdapter, type ObservationAdapter } from "../observations/adapter";
import {
  SWEEP_INTERVAL_MS,
  MIN_NEW_MARKS,
  type DistillJob,
  type SourceArrears,
  type SourceUnit,
  type TopicArrears,
} from "../observations/arrears";
import { collectSourceArrears, findSourceUnit } from "../distill/collect";
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
  markCursor,
  messageCursor,
  resolveCursors,
  runDistillPass,
  runMarksDistillPass,
  type DistillAnnotation,
  type DistillCoverage,
  type DistillMessage,
  type DistillResult,
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

// What a pass that ran is reported as: one log line either way, the panel told
// whenever anything reached disk, and a warn carrying the sub-agent's own
// sentence when the pass did not finish. The transcript, marks and retell passes
// differ only in which fields name the subject — a thread id, a book id, a
// thread id and its retell id — and in what the warn line calls the pass.
function reportDistillOutcome(
  topicId: string,
  subject: Record<string, string>,
  label: string,
  result: { coverage: DistillCoverage } & DistillResult,
): void {
  if (!result.ok) {
    // The pass did not finish, so no cursor moved (runDistillPass) and the next
    // trigger will redo this stretch. Whatever writes it managed are already on
    // disk, so the panel is still told about those.
    console.warn(`${label} did not finish:`, result.failure);
    logEvent(topicId, "distill-failed", {
      ...subject,
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
      notifyObservationChange(topicId);
    }
    return;
  }
  logEvent(topicId, "distill-run", {
    ...subject,
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
    ...distillWritePayload(result),
  });
  notifyObservationChange(topicId);
}

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
      // Distillation thinks at the chat setting, not the pipelines' — it is a
      // silent turn of the same conversation, so the sub-agent's own default
      // (the background-pipeline thinking setting) is overridden here. Nobody
      // waits on it, so it runs on the everyday model (ai/model-tier.ts).
      const model = await resolveModel("distill");
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
      reportDistillOutcome(
        opts.topicId,
        { threadId, trigger: opts.trigger },
        "observation distillation",
        result,
      );
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
      const model = await resolveModel("distill");
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
      reportDistillOutcome(
        opts.topicId,
        { bookId: opts.bookId, trigger: opts.trigger },
        "mark distillation",
        result,
      );
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

// One registered source's unit, run as the pass its shape names (docs/58).
//
// A book's marks go to the marks pass, a retell to the retell pass, and
// everything else to the transcript pass — a conversation with no book id, whose
// label is what the prompt calls it in place of a book's name. Nothing else
// differs: the gate, the cursor under the unit's id and the two log lines are
// the same for all of them.
function distillSourceUnit(
  topicId: string,
  topicName: string,
  unit: SourceUnit,
  trigger: DistillTrigger,
): Promise<void> {
  if (unit.cursor === "distilledMarks") {
    return distillMarks({
      topicId,
      topicName,
      bookId: unit.id,
      bookName: unit.label,
      annotations: unit.marks,
      minNewMarks: MIN_NEW_MARKS,
      trigger,
    });
  }
  if (unit.retell) {
    return distillRetell({
      topicId,
      topicName,
      retellId: unit.retell.retellId,
      retellName: unit.retell.retellName,
      materials: unit.retell.materials,
      threadId: unit.id,
      messages: unit.messages,
      trigger,
    });
  }
  return distillThread({
    topicId,
    topicName,
    ...(unit.bookId ? { bookId: unit.bookId } : {}),
    bookName: unit.label,
    threadId: unit.id,
    annotationId: unit.annotationId ?? "",
    page: unit.page ?? null,
    markedText: unit.markedText ?? "",
    messages: unit.messages,
    ...(unit.parts ? { parts: unit.parts } : {}),
    ...(unit.marks ? { annotations: unit.marks } : {}),
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
    // No topic, no distillation (docs/21): an observation is filed under a topic
    // and this conversation has none yet.
    const topicId = found.unit.topicId;
    if (topicId === null) return;
    const topic = (await listTopics()).find((t) => t.id === topicId);
    await distillSourceUnit(topicId, topic?.name ?? topicId, found.unit, opts.trigger);
  } catch (e) {
    if (e instanceof StoppedError) return;
    console.warn("info distillation could not start", e);
  }
}

// --- the arrears sweep ---

// What every topic still owes, read off the registered sources (docs/58). Every
// shape of raw material arrives the same way — a book's conversations and its
// marks through the reading domain's source, a briefing through info's — so this
// walks no domain's files itself and has no special case for any of them.
//
// A topic that owes nothing is simply absent, including every topic no source
// speaks for. A topic a source names that topics.json does not have — one deleted
// while its material stayed on disk — is swept under its own id rather than
// dropped: the debt is still the reader's, and the id stands in for the name.
async function collectArrears(
  threadBusy: (threadId: string) => boolean,
): Promise<TopicArrears[]> {
  const topics = await listTopics();
  // One read of each topic's meta for the whole sweep: the units are grouped by
  // a topic id nothing has reached yet when their cursor is asked for, and
  // re-reading meta.json per unit would be a file read per conversation on disk.
  const metas = new Map<string, ObservationMeta>();
  const metaOf = async (topicId: string): Promise<ObservationMeta> => {
    let meta = metas.get(topicId);
    if (!meta) {
      meta = await store.getMeta(topicId);
      metas.set(topicId, meta);
    }
    return meta;
  };
  const sourceArrears = await collectSourceArrears(
    async (topicId) => {
      const meta = await metaOf(topicId);
      return {
        messages: (threadId: string) => messageCursor(meta, threadId),
        marks: (bookId: string) => markCursor(meta, bookId),
      };
    },
    { isBusy: threadBusy },
  );
  await pinCountCursors(sourceArrears, metaOf);
  const names = new Map(topics.map((t) => [t.id, t.name]));
  const out: TopicArrears[] = [];
  for (const [topicId, units] of sourceArrears) {
    out.push({
      topicId,
      topicName: names.get(topicId) ?? topicId,
      lastDistilledAt: (await metaOf(topicId)).lastDistilledAt,
      units,
    });
  }
  return out;
}

// Every count cursor the sweep read the old way (a file from before key
// cursors, or a count an older version moved since) written back as the keys it
// was read as, so the reading is made once (distill.ts resolveCursors). Only
// the threads resolved are written; setMeta merges them onto the file.
async function pinCountCursors(
  sourceArrears: Map<string, SourceArrears[]>,
  metaOf: (topicId: string) => Promise<ObservationMeta>,
): Promise<void> {
  for (const [topicId, units] of sourceArrears) {
    const meta = await metaOf(topicId);
    const parts = units.flatMap(({ unit }) =>
      unit.cursor === "distilledMessages"
        ? (unit.parts ?? [{ threadId: unit.id, messages: unit.messages }])
        : [],
    );
    const pinned = resolveCursors(meta, parts);
    if (pinned === null) continue;
    await store.setMeta(topicId, {
      lastDistilledAt: meta.lastDistilledAt,
      lastAnnotationDistillAt: meta.lastAnnotationDistillAt,
      ...pinned,
    });
  }
}

// The one job the sweep picked, run as the pass it is.
function runDistillJob(job: DistillJob, trigger: DistillTrigger): Promise<void> {
  return distillSourceUnit(job.topicId, job.topicName, job.unit, trigger);
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

export function sweepDistillation(trigger: DistillTrigger): Promise<void> {
  return sweeps.sweepDistillation(trigger);
}

// Bind the sweep for the life of the app: once now, and on every tick after
// that. Returns the undo.
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
  trigger: DistillTrigger;
  signal?: AbortSignal;
}

// One silent distillation pass over a retell the reader has just left
// (docs/31). Same posture as distillThread: never throws, never surfaces UI, a
// failed pass is a warn plus an event and the cursor stays where it was so the
// next exit redoes the stretch.
//
// The retell view unmounting is one route in ("talk-exit"), since every way out
// of a retell goes through it; the other is the source table, through which the
// sweep reaches a retell like any other conversation. The caller names which.
export function distillRetell(opts: DistillRetellOptions): Promise<void> {
  const { threadId, topicId } = opts;
  return gate.run(threadId, async () => {
    try {
      // The chat thinking setting on the everyday model, like the reading pass.
      const model = await resolveModel("distill");
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
      reportDistillOutcome(
        topicId,
        { threadId, retellId: opts.retellId, trigger: opts.trigger },
        "retell distillation",
        result,
      );
    } catch (e) {
      if (e instanceof StoppedError) return;
      console.warn("retell distillation could not start", e);
      logEvent(topicId, "distill-failed", {
        threadId,
        retellId: opts.retellId,
        trigger: opts.trigger,
        ...distillFailurePayload({ stage: "setup", error: e }),
      });
    }
  });
}
