// The briefing run checkpoint (src/info/briefing/run-state.ts): the pure rules
// that decide what a resumed run still owes and what it must never fetch twice.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  applySourceResult,
  collectProgress,
  createRunState,
  isResumable,
  pendingSources,
  retryFailedSources,
  syncSources,
  type InfoRunState,
} from "../../src/info/briefing/run-state";
import type { InfoItem } from "../../src/info/briefing/types";

function item(id: string): InfoItem {
  return { id, source: "s", sourceName: "S", title: id, url: `https://x/${id}`, publishedAt: "" };
}

function fresh(): InfoRunState {
  return createRunState("2026-07-22", 1000, [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
}

test("a new run owes every source and holds nothing", () => {
  const s = fresh();
  expect(s.phase).toBe("collecting");
  expect(pendingSources(s).map((r) => r.id)).toEqual(["a", "b"]);
  expect(s.items).toEqual([]);
  expect(collectProgress(s)).toEqual({ total: 2, done: 0, failed: 0, items: 0, lastDone: null });
});

test("a settled source is off the pending list and its items are in the checkpoint", () => {
  const s = applySourceResult(fresh(), { id: "a", items: [item("a1"), item("a2")] }, 2000);
  expect(pendingSources(s).map((r) => r.id)).toEqual(["b"]);
  expect(s.items.map((i) => i.id)).toEqual(["a1", "a2"]);
  expect(collectProgress(s)).toEqual({ total: 2, done: 1, failed: 0, items: 2, lastDone: "A" });
});

test("a failed source is settled too, so a resume does not sit waiting on it", () => {
  const s = applySourceResult(fresh(), { id: "b", items: [], error: "host down" }, 2000);
  expect(pendingSources(s).map((r) => r.id)).toEqual(["a"]);
  expect(s.sources.find((x) => x.id === "b")).toMatchObject({ status: "failed", error: "host down" });
  expect(collectProgress(s).failed).toBe(1);
});

test("the same source applied twice cannot double the day's items", () => {
  const once = applySourceResult(fresh(), { id: "a", items: [item("a1")] }, 2000);
  const twice = applySourceResult(once, { id: "a", items: [item("a1"), item("a2")] }, 3000);
  expect(twice.items.map((i) => i.id)).toEqual(["a1", "a2"]);
});

test("only today's unhalted run is resumable", () => {
  const s = fresh();
  expect(isResumable(s, "2026-07-22")).toBe(true);
  // Yesterday's leftover: the news is stale, finishing it is not worth tokens.
  expect(isResumable(s, "2026-07-23")).toBe(false);
  expect(isResumable(null, "2026-07-22")).toBe(false);
  expect(isResumable({ ...s, halt: { kind: "stopped" } }, "2026-07-22")).toBe(false);
  expect(isResumable({ ...s, halt: { kind: "failed", error: "x" } }, "2026-07-22")).toBe(false);
  expect(isResumable({ ...s, version: 0 as unknown as 1 }, "2026-07-22")).toBe(false);
});

test("syncSources adopts a new source, drops an unsubscribed one, keeps what already ran", () => {
  const collected = applySourceResult(fresh(), { id: "a", items: [item("a1")] }, 2000);
  // "b" is gone, "c" is new — and "a" has already been fetched, so it stays
  // whether or not the user still subscribes to it.
  const synced = syncSources(collected, [{ id: "c", name: "C" }]);
  expect(synced.sources.map((s) => s.id)).toEqual(["a", "c"]);
  expect(pendingSources(synced).map((r) => r.id)).toEqual(["c"]);
  expect(synced.items.map((i) => i.id)).toEqual(["a1"]);
});

test("retryFailedSources requeues only the failures", () => {
  const s = applySourceResult(
    applySourceResult(fresh(), { id: "a", items: [item("a1")] }, 2000),
    { id: "b", items: [], error: "host down" },
    3000,
  );
  const retried = retryFailedSources(s);
  expect(pendingSources(retried).map((r) => r.id)).toEqual(["b"]);
  expect(retried.sources.find((x) => x.id === "b")!.error).toBeUndefined();
  expect(retried.items.map((i) => i.id)).toEqual(["a1"]);
  // Nothing failed: the state is returned untouched.
  const clean = applySourceResult(fresh(), { id: "a", items: [] }, 2000);
  expect(retryFailedSources(clean)).toBe(clean);
});
