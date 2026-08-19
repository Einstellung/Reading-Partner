// The prompt-cache measurement (src/platform/app/cache-telemetry.ts): what one
// turn's line carries, how the gap to the previous turn on the same thread is
// dated, and that nothing but ids and numbers reaches the log.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  cacheTurnPayload,
  createCacheReporter,
  newRunId,
  resolveRetention,
  THREAD_MEMORY,
  type CacheTurnInput,
  type TurnUsage,
} from "../src/platform/app/cache-telemetry";
import { AI_EVENT_TOPIC } from "../src/platform/app/structured-output";
import type { EventPayload, EventType } from "../src/platform/app/events";

const USAGE: TurnUsage = {
  input: 120,
  output: 400,
  cacheRead: 21_490,
  cacheWrite: 17_458,
  cacheWrite1h: 0,
};

function turn(over: Partial<CacheTurnInput> = {}): CacheTurnInput {
  return {
    telemetry: { surface: "classroom", thread: "t1" },
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
    round: 1,
    startedAt: 1_000,
    usage: USAGE,
    ok: true,
    retention: "short",
    ...over,
  };
}

interface Logged {
  topicId: string;
  type: EventType;
  payload: EventPayload;
}

function reporter(now: () => number = () => 0) {
  const lines: Logged[] = [];
  const r = createCacheReporter((topicId, type, payload = {}) => {
    lines.push({ topicId, type, payload });
  }, now);
  return { r, lines };
}

// --- the payload -----------------------------------------------------------

test("a turn's line carries the three token counts, the face, the model and the retention", () => {
  const p = cacheTurnPayload(turn(), null, 3_500);
  expect(p.surface).toBe("classroom");
  expect(p.thread).toBe("t1");
  expect(p.round).toBe(1);
  expect(p.provider).toBe("anthropic");
  expect(p.model).toBe("claude-sonnet-4-5");
  expect(p.retention).toBe("short");
  expect(p.input).toBe(120);
  expect(p.cacheRead).toBe(21_490);
  expect(p.cacheWrite).toBe(17_458);
  expect(p.cacheWrite1h).toBe(0);
  expect(p.output).toBe(400);
  expect(p.ms).toBe(2_500);
  expect(p.ok).toBe(true);
});

test("the first turn of a thread has no gap to report", () => {
  expect(cacheTurnPayload(turn(), null, 1_000).sinceMs).toBeNull();
});

test("the gap is measured request to request, so an answer's own length is inside it", () => {
  // Previous request went out at 1_000 and this one at 700_000: eleven and a
  // half minutes, whatever the previous answer took to write.
  const p = cacheTurnPayload(turn({ startedAt: 700_000 }), 1_000, 700_000);
  expect(p.sinceMs).toBe(699_000);
});

test("a turn with no usage logs nulls rather than zeros somebody would read as facts", () => {
  const p = cacheTurnPayload(turn({ usage: undefined, ok: false }), null, 0);
  expect(p.input).toBeNull();
  expect(p.cacheRead).toBeNull();
  expect(p.cacheWrite).toBeNull();
  expect(p.cacheWrite1h).toBeNull();
  expect(p.output).toBeNull();
  expect(p.ok).toBe(false);
});

test("a provider that reports no 1h split is not the same as one reporting zero", () => {
  const usage: TurnUsage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
  expect(cacheTurnPayload(turn({ usage }), null, 0).cacheWrite1h).toBeNull();
});

test("nothing but ids and numbers reaches the line", () => {
  const p = cacheTurnPayload(turn(), 1, 2);
  for (const value of Object.values(p)) {
    expect(["string", "number", "boolean", "object"]).toContain(typeof value);
  }
  // The keys are fixed, so a field carrying prose cannot be added unnoticed.
  expect(Object.keys(p).sort()).toEqual([
    "cacheRead",
    "cacheWrite",
    "cacheWrite1h",
    "inline",
    "input",
    "model",
    "ms",
    "ok",
    "output",
    "provider",
    "retention",
    "round",
    "sinceMs",
    "surface",
    "thread",
  ]);
});

// --- the reporter ----------------------------------------------------------

test("every turn writes one line to the shared AI log", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn());
  expect(lines).toHaveLength(1);
  expect(lines[0].topicId).toBe(AI_EVENT_TOPIC);
  expect(lines[0].type).toBe("prompt-cache");
});

test("consecutive turns on one thread are dated against each other", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn({ startedAt: 1_000 }));
  r.recordTurn(turn({ startedAt: 61_000, round: 1 }));
  expect(lines[0].payload.sinceMs).toBeNull();
  expect(lines[1].payload.sinceMs).toBe(60_000);
});

test("two threads do not date each other, even on the same face", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn({ telemetry: { surface: "reading", thread: "a" }, startedAt: 1_000 }));
  r.recordTurn(turn({ telemetry: { surface: "reading", thread: "b" }, startedAt: 2_000 }));
  expect(lines[1].payload.sinceMs).toBeNull();
});

test("the same thread id on two faces is two threads", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn({ telemetry: { surface: "reading", thread: "t1" }, startedAt: 1_000 }));
  r.recordTurn(turn({ telemetry: { surface: "classroom", thread: "t1" }, startedAt: 2_000 }));
  expect(lines[1].payload.sinceMs).toBeNull();
});

test("later rounds of one loop are dated too, and say which round they are", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn({ round: 1, startedAt: 1_000 }));
  r.recordTurn(turn({ round: 2, startedAt: 4_000 }));
  expect(lines[1].payload.round).toBe(2);
  expect(lines[1].payload.sinceMs).toBe(3_000);
});

test("a failed round is recorded: it spent its input tokens either way", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn({ ok: false }));
  expect(lines).toHaveLength(1);
  expect(lines[0].payload.ok).toBe(false);
});

test("only the most recent threads are remembered, and a used thread stays", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn({ telemetry: { surface: "reading", thread: "old" }, startedAt: 0 }));
  // Keep touching "old" so it is never the least recently written one.
  for (let i = 0; i < THREAD_MEMORY * 2; i++) {
    r.recordTurn(turn({ telemetry: { surface: "reading", thread: `x${i}` }, startedAt: i }));
    r.recordTurn(turn({ telemetry: { surface: "reading", thread: "old" }, startedAt: i }));
  }
  expect(lines[lines.length - 1].payload.sinceMs).not.toBeNull();
});

test("a thread pushed out of memory reports no gap rather than a wrong one", () => {
  const { r, lines } = reporter();
  r.recordTurn(turn({ telemetry: { surface: "reading", thread: "old" }, startedAt: 0 }));
  for (let i = 0; i <= THREAD_MEMORY; i++) {
    r.recordTurn(turn({ telemetry: { surface: "reading", thread: `x${i}` }, startedAt: i }));
  }
  r.recordTurn(turn({ telemetry: { surface: "reading", thread: "old" }, startedAt: 9_000 }));
  expect(lines[lines.length - 1].payload.sinceMs).toBeNull();
});

// --- retention -------------------------------------------------------------

test("retention defaults to the five-minute one, which is pi's own default", () => {
  expect(resolveRetention(undefined, {})).toBe("short");
});

test("PI_CACHE_RETENTION=long is the only value that changes it, matching pi", () => {
  expect(resolveRetention(undefined, { PI_CACHE_RETENTION: "long" })).toBe("long");
  expect(resolveRetention(undefined, { PI_CACHE_RETENTION: "1h" })).toBe("short");
  expect(resolveRetention(undefined, { PI_CACHE_RETENTION: "" })).toBe("short");
});

test("what the call passes wins over the environment, matching pi", () => {
  expect(resolveRetention("none", { PI_CACHE_RETENTION: "long" })).toBe("none");
});

// --- run ids ---------------------------------------------------------------

test("a run with no conversation gets an id of its own each time", () => {
  expect(newRunId()).not.toBe(newRunId());
});
