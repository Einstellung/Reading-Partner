// What prompt caching did, one line per model turn.
//
// A cache read is priced at roughly a tenth of a fresh input token and a write
// above one, so two runs of the same conversation differ several-fold in cost
// depending on whether the cached prefix survived. pi places the cache
// breakpoints (system end, last tool, last user block) and reports the outcome
// in each turn's usage as cacheRead / cacheWrite; nothing in the app read those
// numbers until now.
//
// This measures before deciding, and the decision it feeds is whether the prompt
// needs reordering at all. A miss has two possible causes that want opposite
// fixes: the assembly put a line that changes every turn early enough to push
// everything after it out of the cached prefix, or the five-minute retention ran
// out between two questions, which no reordering can help. `sinceMs` is the
// field that tells them apart, which is why a line without it is worth nothing.
//
// Ids and numbers only, like every other line in this log: no prompt, no reply,
// no tool argument, no page text.

import { logEvent, type EventPayload, type EventType } from "./events";
import { AI_EVENT_TOPIC } from "./structured-output";

// Which face of the app the turn ran on. Classroom is its own value rather than
// a flag on "reading" because the two assemble different prompts at different
// sizes, and telling them apart is the first thing a summary has to do.
export type AiSurface =
  // The reading companion (docs/03).
  | "reading"
  // Classroom mode, carrying the prep notes (docs/09).
  | "classroom"
  // Rehearsing a talk (docs/31).
  | "talk"
  // The info companion.
  | "info"
  // An isolated sub-agent run (src/ai/subagent).
  | "subagent"
  // One book-note chapter.
  | "notes"
  // A lesson-prep paper digest, in its tool-loop form.
  | "digest";

// Which conversation a turn belongs to. `thread` is the id whose previous turn
// the gap is measured against; a run with no conversation of its own (a chapter
// note, a sub-agent) gets a fresh id per run, which is the truth — nothing
// before it shares its prefix.
export interface TurnTelemetry {
  surface: AiSurface;
  thread: string;
}

// A one-off id for such a run. Never persisted and never shown: it only has to
// differ from the last run's, so the gap to that run is reported as absent
// rather than as a number about a different prefix.
export function newRunId(): string {
  return crypto.randomUUID();
}

// The part of pi's Usage this reads. Structural on purpose: platform/app imports
// no provider SDK, and pi's Usage satisfies this.
export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  // The share of cacheWrite written with 1h retention. Only Anthropic reports
  // this split, and it is the one field that says whether a long-retention
  // setting actually reached the wire.
  cacheWrite1h?: number;
}

export type CacheRetention = "none" | "short" | "long";

// The retention pi will apply, by pi's own rule (its api/anthropic-messages:
// an explicit StreamOptions.cacheRetention wins, then PI_CACHE_RETENTION, then
// "short"). Recorded rather than assumed, because two measurements taken under
// different retention cannot be compared.
//
// In the packaged app the env branch can never fire: pi reads process.env and a
// webview has no process. So this answers "short" until the app passes
// cacheRetention itself — and when it does, it must pass the same value here,
// or the log describes a setting the request did not carry.
export function resolveRetention(
  explicit?: CacheRetention,
  env: Record<string, string | undefined> = processEnv(),
): CacheRetention {
  if (explicit) return explicit;
  return env.PI_CACHE_RETENTION === "long" ? "long" : "short";
}

function processEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? {};
}

export interface CacheTurnInput {
  telemetry: TurnTelemetry;
  providerId: string;
  modelId: string;
  // 1-based model turn within this run. Round 2 of a tool loop follows round 1
  // by seconds, so a gap only means what it looks like when read together with
  // this — the TTL question is about round 1 of consecutive runs.
  round: number;
  // When the request went out. The entry a turn reads was written when the
  // previous request went out, so start-to-start is the interval the retention
  // window is spent on; end-to-start would undercount it by a whole answer.
  startedAt: number;
  // pi's usage for the turn. Absent when the stream failed before the provider
  // reported any, in which case the token fields are logged as null rather than
  // as zeros somebody would read as facts.
  usage?: TurnUsage;
  // Whether the round produced a final message. A failed round still spent its
  // input tokens, so it is recorded rather than dropped.
  ok: boolean;
  retention: CacheRetention;
}

// One line's worth of accounting. `previousStartedAt` is null on a thread's
// first turn, `endedAt` is when the turn settled.
export function cacheTurnPayload(
  input: CacheTurnInput,
  previousStartedAt: number | null,
  endedAt: number,
): EventPayload {
  const usage = input.usage;
  return {
    surface: input.telemetry.surface,
    thread: input.telemetry.thread,
    round: input.round,
    provider: input.providerId,
    model: input.modelId,
    retention: input.retention,
    ok: input.ok,
    // Prompt tokens that were neither read from nor written to the cache. The
    // whole prompt is input + cacheRead + cacheWrite; pi reports the remainder
    // here, the way the provider does.
    input: usage?.input ?? null,
    cacheRead: usage?.cacheRead ?? null,
    cacheWrite: usage?.cacheWrite ?? null,
    // Null when the provider reports no 1h split at all, which is not the same
    // as reporting a split of zero.
    cacheWrite1h: usage?.cacheWrite1h ?? null,
    output: usage?.output ?? null,
    sinceMs: previousStartedAt === null ? null : input.startedAt - previousStartedAt,
    // How long this turn took, so a long gap can be read as an idle reader
    // rather than as a slow answer.
    ms: endedAt - input.startedAt,
  };
}

// How many threads' last-turn stamps to keep. A stamp is one number and exists
// only to date the turn just before, so an old thread's is worth no more than
// it costs to hold.
export const THREAD_MEMORY = 64;

type LogFn = (topicId: string, type: EventType, payload?: EventPayload) => void;

export interface CacheReporter {
  recordTurn(input: CacheTurnInput): void;
}

export function createCacheReporter(log: LogFn, now: () => number = Date.now): CacheReporter {
  // Request-start of the last recorded turn, per surface+thread. Insertion order
  // is write order, so the first key is the least recently written one.
  const lastStart = new Map<string, number>();

  return {
    recordTurn(input: CacheTurnInput): void {
      const key = `${input.telemetry.surface}:${input.telemetry.thread}`;
      const previous = lastStart.get(key) ?? null;
      lastStart.delete(key);
      lastStart.set(key, input.startedAt);
      if (lastStart.size > THREAD_MEMORY) {
        const oldest = lastStart.keys().next().value;
        if (oldest !== undefined) lastStart.delete(oldest);
      }
      log(AI_EVENT_TOPIC, "prompt-cache", cacheTurnPayload(input, previous, now()));
    },
  };
}

// The app's reporter, bound to the event log. Fire-and-forget like every other
// event: instrumentation must never break the turn it observes.
const live = createCacheReporter(logEvent);

export const recordCacheTurn = live.recordTurn;
