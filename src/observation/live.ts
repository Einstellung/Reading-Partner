// Live wiring of the observation module: the Tauri fs behind ObservationFs, one
// adapter per topic for the app's lifetime, the hangup/trim distillation entry
// points (real model through runAgentTurn, same provider config as chat), and a
// tiny change feed so the observations panel refreshes after background writes.

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
import { logEvent } from "../platform/app/events";
import { FileObservationAdapter, type ObservationAdapter } from "./adapter";
import { ObservationFileStore, type ObservationFs } from "./store";
import type { ObservationIndexEntry } from "./types";
import { runDistillPass, type DistillAnnotation, type DistillMessage } from "./distill";

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

export interface DistillThreadOptions {
  topicId: string;
  topicName: string;
  bookName: string;
  threadId: string;
  annotationId: string;
  page: number | null;
  markedText: string;
  messages: DistillMessage[];
  // The book's annotations, so distillation can fold in silent marks made since
  // the last pass (docs/02 part 2). Absent/empty is fine.
  annotations?: DistillAnnotation[];
  // Cancels the pass. Neither of the two triggers passes one, and the reason is
  // the same for both: a pass has to outlive the thing that started it.
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

// Message count per thread at its last distillation, so hangup after a trim
// distillation (or a re-opened and immediately re-closed thread) doesn't
// re-distill the same transcript.
const distilledCounts = new Map<string, number>();
const inFlight = new Set<string>();

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
// a long conversation.
export async function distillThread(
  opts: DistillThreadOptions,
  minNewMessages = 1,
): Promise<void> {
  const { threadId, messages } = opts;
  if (inFlight.has(threadId)) return;
  // Nothing the reader said → nothing that can't be re-derived from the book
  // and the annotation itself.
  if (!messages.some((m) => m.role === "user" && m.text.trim() !== "")) return;
  const since = distilledCounts.get(threadId) ?? 0;
  if (messages.length - since < minNewMessages) return;

  inFlight.add(threadId);
  try {
    // Distillation runs on the chat model config, not the pipelines' — it is a
    // silent turn of the same conversation, so the sub-agent's own default
    // (the background-pipeline thinking setting) is overridden here.
    const model = await resolveModel("chat");
    const result = await runDistillPass(
      {
        topicName: opts.topicName,
        bookName: opts.bookName,
        threadId,
        annotationId: opts.annotationId,
        page: opts.page,
        markedText: opts.markedText,
        messages,
        annotations: opts.annotations,
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
    if (!result.ok) {
      // The pass did not finish, so neither stamp moved (runDistillPass) and the
      // next trigger will redo this transcript. Whatever writes it managed are
      // already on disk, so the panel is still told about those.
      console.warn("observation distillation did not finish:", result.failure);
      logEvent(opts.topicId, "distill-failed", {
        threadId,
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
    distilledCounts.set(threadId, messages.length);
    logEvent(opts.topicId, "distill-run", {
      threadId,
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
    logEvent(opts.topicId, "distill-failed", { threadId, outcome: "failed" });
  } finally {
    inFlight.delete(threadId);
  }
}
