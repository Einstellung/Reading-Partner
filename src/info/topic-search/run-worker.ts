// The legion side of a topic-search run (docs/info/88 「两种 run」「排队」): the
// worker of kind `topic-search`, the asks that make the runs, and the nightly
// tick. Ports in; the live wiring is runs-live.ts.
//
// The worker is a program worker that only a desktop collector claims
// (`requires: [WEBVIEW_FETCH]`). It runs the `rp.topicsearch` task under the
// run's id, so a retry or a restart finds the task already there and waits for
// it. The gates are on this side (docs/pitfall/210): each ask is keyed
// (`topic-search:<id>:first`, `topic-search:<id>:<night>`) and the run store
// hands back the run already under the key; the nightly tick also refuses to
// overlap itself and remembers the night it asked for.

import type { AnyTask, TaskOutcome } from "@earendil-works/pi-durable";
import type { DurableRuntime } from "../../legion/durable/harness";
import { runProgramTask } from "../../legion/durable/program-task";
import type { Delegated, DelegateInput, Worker } from "../../legion/runner/worker";
import { GiveUpError, StoppedError } from "../../legion/stop";
import { inNightWindow, planNight, type NightConditions } from "./nightly";
import {
  encodeBrief,
  NO_BUILDER,
  parseBrief,
  TOPIC_SEARCH_KIND,
  topicSearchRunKey,
  type TopicSearchBrief,
  type TopicSearchRunResult,
} from "./run";
import type { TopicSearch } from "./types";

/** How often a run says it is alive while it reads; the runner calls a run stuck after 15 quiet minutes. */
export const HEARTBEAT_MS = 5 * 60_000;

export interface TopicSearchWorkerPorts {
  runtime(signal: AbortSignal): Promise<DurableRuntime>;
  task: AnyTask;
  /** Where the task's phases say how far they got, by run id. */
  reporters: Map<string, (text: string) => void>;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

function line(result: TopicSearchRunResult): string {
  if (result.status === "skipped") return `skipped: ${result.why ?? ""}`.trim();
  const x = result.x ? `${result.x.posts} posts read (${result.x.status}); ` : "";
  return result.status === "empty" ? `${x}nothing new` : `${x}${result.itemCount} items delivered`;
}

export function topicSearchWorker(ports: TopicSearchWorkerPorts): Worker {
  return (brief, ctx) => {
    const stop = new AbortController();
    const done = (async () => {
      const parsed = parseBrief(brief);
      if (!parsed) throw new GiveUpError("not a topic-search brief");
      let last = "starting";
      ports.reporters.set(ctx.run.id, (text) => {
        last = text;
        void ctx.report(text);
      });
      const beat = ports.setInterval(() => void ctx.report(last), HEARTBEAT_MS);
      try {
        const outcome: TaskOutcome<TopicSearchRunResult> = await runProgramTask(
          await ports.runtime(stop.signal),
          { task: ports.task, key: ctx.run.id, name: TOPIC_SEARCH_KIND, input: { runId: ctx.run.id, brief: parsed }, signal: stop.signal },
        );
        if (outcome.status === "completed") {
          const output = outcome.result.resultFile ?? undefined;
          return { ...(output ? { output } : {}), progress: line(outcome.result) };
        }
        if (outcome.status === "aborted" || stop.signal.aborted) throw new StoppedError();
        const why = outcome.status === "failed" || outcome.status === "faulted" ? outcome.error.message : outcome.reason;
        if (why === NO_BUILDER) throw new GiveUpError(why);
        throw new Error(why);
      } finally {
        ports.clearInterval(beat);
        ports.reporters.delete(ctx.run.id);
      }
    })();
    return { cancel: () => stop.abort(), done };
  };
}

/** Ask for a run. Keyed, so asking again reaches the run already there. */
export function askTopicSearchRun(
  brief: TopicSearchBrief,
  delegate: (input: DelegateInput) => Promise<Delegated>,
): Promise<Delegated> {
  return delegate({
    kind: TOPIC_SEARCH_KIND,
    idempotencyKey: topicSearchRunKey(brief),
    delegator: { kind: "program", name: brief.kind === "first" ? "topic-search first run" : "topic-search nightly" },
    brief: encodeBrief(brief),
  });
}

export interface NightPorts {
  now(): number;
  deviceId(): string;
  /** The conditions, asked only inside the night's window. */
  conditions(night: string): Promise<NightConditions>;
  delegate(input: DelegateInput): Promise<Delegated>;
}

/** The nightly tick: once a night, inside the window, one daily run per active search. */
export function createNightTick(ports: NightPorts): () => Promise<string[]> {
  let ticking = false;
  let asked: string | null = null;
  return async () => {
    if (ticking) return [];
    ticking = true;
    try {
      const { night, open } = inNightWindow(ports.now(), ports.deviceId());
      if (!open || asked === night) return [];
      const plan = planNight(await ports.conditions(night));
      if ("wait" in plan) return [];
      const ids: string[] = [];
      for (const search of plan.dispatch) {
        const result = await askTopicSearchRun({ searchId: search.id, kind: "daily", night }, ports.delegate);
        if (result.ok || result.run) ids.push(search.id);
      }
      asked = night;
      return ids;
    } finally {
      ticking = false;
    }
  };
}

/** The first run, asked for when a search is applied (first-run.ts). */
export function firstRunDispatcher(delegate: (input: DelegateInput) => Promise<Delegated>) {
  return async (search: TopicSearch): Promise<void> => {
    await askTopicSearchRun({ searchId: search.id, kind: "first", night: null }, delegate);
  };
}
