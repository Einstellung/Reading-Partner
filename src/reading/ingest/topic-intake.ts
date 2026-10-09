// A link taken in with no book, for a topic the reader picks afterwards: the
// door conversation's intake card (docs/86 「回执」 for what the receipt says).
//
// The reader pastes a link to Lumen. The tool starts this at once: an intake
// record, and an ingest-url run whose ask names the intake instead of a book.
// The run files what it takes in into the library attached nowhere and records
// it on the intake; the card lists the topics with one suggested, and the
// reader's pick lands on the intake too. Whichever of the two comes second
// attaches the documents to the topic (intake-store.ts).
//
// A new topic is the caller's to make, through the topic API, before it is
// picked. An intake the reader never picks a topic for stays as it is: its
// documents are in the library attached nowhere, and nothing files them into
// Brief on the reader's behalf.

import { listTopics } from "../../platform/app/topics";
import { watchSource } from "../../platform/std/watch";
import type { BoxOrigin } from "../../box";
import { intakeStore, type IntakeStore, type TopicIntake } from "./intake-store";
import { topicChoicesOf, type TopicChoices } from "./topic-choice";
import { startUrlIngest, type StartedIngest, type StartIngestDeps } from "./url-run";

export type { IntakeDocument, IntakeSkipped, IntakeState, TopicIntake } from "./intake-store";
export { topicMenu, type TopicChoice, type TopicChoices } from "./topic-choice";

export interface StartedTopicIntake {
  intakeId: string;
  runId: string;
  /** Settles when this device has finished the run. Absent when nothing runs it here. */
  done?: StartedIngest["done"];
}

export interface TopicIntakeDeps {
  /** The place the turn is being held; the run's answer is delivered back to it. */
  origin?: BoxOrigin;
  store?: IntakeStore;
  /** Starting the run. startUrlIngest unless a test hands one in. */
  start?: typeof startUrlIngest;
  /** Passed through to startUrlIngest. */
  ingest?: Omit<StartIngestDeps, "origin">;
}

/**
 * Start taking a link in for a topic not yet picked: write the intake, hand
 * legion the run, answer without waiting. A run the runner refuses leaves the
 * intake `failed` with the runner's sentence, and throws it.
 */
export async function startTopicIntake(
  url: string,
  note?: string,
  deps: TopicIntakeDeps = {},
): Promise<StartedTopicIntake> {
  const store = deps.store ?? intakeStore;
  const start = deps.start ?? startUrlIngest;
  const intake = await store.create({ url, ...(note ? { note } : {}) });
  let started: StartedIngest;
  try {
    started = await start(
      { url, intakeId: intake.id, ...(note ? { note } : {}) },
      { ...deps.ingest, ...(deps.origin === undefined ? {} : { origin: deps.origin }) },
    );
  } catch (e) {
    await store.failed(intake.id, e instanceof Error ? e.message : String(e));
    throw e;
  }
  await store.setRun(intake.id, started.runId);
  return { intakeId: intake.id, runId: started.runId, ...(started.done ? { done: started.done } : {}) };
}

/**
 * The reader picked a topic on the card. Attaches the documents when the run
 * has filed them; otherwise the run attaches them when it does. Picking again
 * before then replaces the pick; after the documents are attached the intake
 * is settled and a further pick changes nothing. A new topic is made by the
 * caller (createTopic) before it is picked.
 */
export function chooseIntakeTopic(intakeId: string, topicId: string, store: IntakeStore = intakeStore): Promise<TopicIntake> {
  return store.choose(intakeId, topicId);
}

/** The intake as it stands, or null when there is no such record on this device. */
export function readIntake(intakeId: string, store: IntakeStore = intakeStore): Promise<TopicIntake | null> {
  return store.get(intakeId);
}

/** Hear about every write to any intake, by id. Returns the undo. */
export function subscribeIntakes(fn: (intakeId: string) => void, store: IntakeStore = intakeStore): () => void {
  return store.subscribe(fn);
}

/** One intake, in the shape useSyncExternalStore reads. */
export interface IntakeWatch {
  subscribe(fn: () => void): () => void;
  /** The last record read; null before the first read lands or when there is none. */
  snapshot(): TopicIntake | null;
  refresh(): Promise<void>;
}

/**
 * Watch one intake: re-read on every write to it, and keep the same object
 * until something in it changed, so React sees a stable snapshot.
 */
export function watchIntake(intakeId: string, store: IntakeStore = intakeStore): IntakeWatch {
  let current: TopicIntake | null = null;
  let seen = "null";
  const source = watchSource({
    subscribe: (fn) => store.subscribe((id) => id === intakeId && fn()),
    read: async (notify) => {
      const next = await store.get(intakeId);
      const text = JSON.stringify(next);
      if (text === seen) return;
      seen = text;
      current = next;
      notify();
    },
    failure: "could not read the link intake",
  });
  return { subscribe: source.subscribe, snapshot: () => current, refresh: source.refresh };
}

/**
 * The topics the card lists, numbered, with the suggested one marked. `pick` is
 * a model's 1-based choice from topicMenu, where the tool lets it make one.
 */
export async function listTopicChoices(url: string, note?: string, pick?: number): Promise<TopicChoices> {
  return topicChoicesOf(await listTopics(), { url, ...(note ? { note } : {}) }, pick);
}
