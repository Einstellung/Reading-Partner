// The legion side of a topic-search run (docs/info/88 「两种 run」「排队」): the
// worker of kind `topic-search`, the asks that make the runs, and the nightly
// tick. Ports in; the live wiring is runs-live.ts.
//
// The worker is a program worker that only a desktop collector claims
// (`requires: [WEBVIEW_FETCH]`). It runs the `rp.topicsearch` task under the
// run's id, so a retry or a restart finds the task already there and waits for
// it. The gates are on this side (docs/pitfall/210): each ask is keyed
// (`topic-search:<id>:first`, `topic-search:<id>:<night>`,
// `topic-search:<id>:retry:<n>`, `topic-search:<id>:update:<n>`) and the run store
// hands back the run already under the key; the nightly tick also refuses to
// overlap itself and remembers the night it asked for.

import type { AnyTask, TaskOutcome } from "@earendil-works/pi-durable";
import type { DurableRuntime } from "../../legion/durable/harness";
import { runProgramTask } from "../../legion/durable/program-task";
import type { Delegated, DelegateInput, Worker } from "../../legion/runner/worker";
import { GiveUpError, StoppedError } from "../../legion/stop";
import type { Run } from "../../legion/run";
import { inNightWindow, planNight, type NightConditions } from "./nightly";
import { nextRetryNumber } from "./retry";
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
  // A study's update: the version it made, or why the brief stays as it was.
  if (result.version !== undefined) {
    return result.version === null
      ? `no new version: ${result.unjudged ?? 0} candidates not judged, kept for the next update; the brief stays as it was`
      : `version ${result.version} made: ${result.changes ?? "no change"}`;
  }
  const x = result.x ? `${result.x.posts} posts read (${result.x.status}); ` : "";
  const unjudged = result.unjudged ? `${result.status === "delivered" ? "; " : ""}${result.unjudged} candidates not judged, kept for the next run` : "";
  if (result.status === "empty") return `${x}${unjudged || "nothing new"}`;
  return `${x}${result.itemCount} items delivered${unjudged}`;
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
    delegator: { kind: "program", name: DELEGATOR[brief.kind] },
    brief: encodeBrief(brief),
  });
}

const DELEGATOR = {
  first: "topic-search first run",
  daily: "topic-search nightly",
  retry: "topic-search retry",
  update: "topic-search study update",
} as const;

/** What asking for a retry of a first look came to. */
export type RetryAsk =
  | { status: "asked"; run: Run; n: number }
  /** The first look or an earlier retry of it is still pending or running. */
  | { status: "busy"; run: Run; what: "first" | "retry" }
  | { status: "refused"; reason: string };

/**
 * Ask for a retry of a search's first look (retry.ts). Keyed by the number one
 * past the search's retries still on file, so two asks racing from two devices
 * reach one run; an ask while the first look or a retry is still going is not
 * made.
 */
export async function askRetryRun(
  searchId: string,
  ports: { runs(): Promise<Run[]>; delegate(input: DelegateInput): Promise<Delegated> },
): Promise<RetryAsk> {
  const mine = (await ports.runs())
    .map((run) => ({ run, brief: parseBrief(run.brief) }))
    .filter((r) => r.brief?.searchId === searchId);
  const busy = mine.find((r) => r.brief!.kind !== "daily" && (r.run.state === "pending" || r.run.state === "running"));
  if (busy) return { status: "busy", run: busy.run, what: busy.brief!.kind === "first" ? "first" : "retry" };
  const n = nextRetryNumber(
    mine.map((r) => r.run.idempotencyKey),
    searchId,
  );
  const asked = await askTopicSearchRun({ searchId, kind: "retry", night: null, n }, ports.delegate);
  if (!asked.ok) return { status: "refused", reason: asked.reason };
  return { status: "asked", run: asked.run, n };
}

/** What asking for a study's update came to. */
export type UpdateAsk =
  | { status: "asked"; run: Run; n: number }
  /** The first look, a retry or an earlier update of the study is still pending or running. */
  | { status: "busy"; run: Run; what: "first" | "retry" | "update" }
  | { status: "refused"; reason: string };

const UPDATE_KEY = /^topic-search:(.+):update:(\d+)$/;

/** The number the next update ask of a study is keyed by: one past the highest still on file. */
export function nextUpdateNumber(keys: readonly (string | undefined)[], searchId: string): number {
  let most = 0;
  for (const key of keys) {
    const m = key ? UPDATE_KEY.exec(key) : null;
    if (m && m[1] === searchId) most = Math.max(most, Number(m[2]));
  }
  return most + 1;
}

/**
 * Ask for a study's update (docs/info/91 更新): the next version of its brief,
 * from the confirmed lines (`lines`, ids; absent: every confirmed line no
 * version used yet) and with the extra queries (`queries`, ids already in the
 * topic's config). Not made while the first look, a retry or an update of the
 * study is pending or running: the reader is told it is still being revised.
 * Keyed by the number one past the study's update asks on file, so two asks
 * racing from two devices reach one run; the version number is the build's
 * (one past the file's newest), since a failed ask makes none.
 *
 * The seam the door's update_study_brief (slice F) calls once it has written
 * the lines, the config and the labels.
 */
export async function askUpdateRun(
  searchId: string,
  ask: { lines?: readonly string[]; queries?: readonly string[] },
  ports: { runs(): Promise<Run[]>; delegate(input: DelegateInput): Promise<Delegated> },
): Promise<UpdateAsk> {
  const mine = (await ports.runs())
    .map((run) => ({ run, brief: parseBrief(run.brief) }))
    .filter((r) => r.brief?.searchId === searchId);
  const busy = mine.find((r) => r.brief!.kind !== "daily" && (r.run.state === "pending" || r.run.state === "running"));
  if (busy) return { status: "busy", run: busy.run, what: busy.brief!.kind as "first" | "retry" | "update" };
  const n = nextUpdateNumber(
    mine.map((r) => r.run.idempotencyKey),
    searchId,
  );
  const brief: TopicSearchBrief = {
    searchId,
    kind: "update",
    night: null,
    n,
    ...(ask.lines ? { lines: [...ask.lines] } : {}),
    ...(ask.queries?.length ? { queries: [...ask.queries] } : {}),
  };
  const asked = await askTopicSearchRun(brief, ports.delegate);
  if (!asked.ok) return { status: "refused", reason: asked.reason };
  return { status: "asked", run: asked.run, n };
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
