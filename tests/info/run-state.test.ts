// The briefing run checkpoint (src/info/briefing/run-state.ts): the pure rules
// that decide what a resumed run still owes and what it must never fetch twice.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  applyBody,
  applySourceResult,
  applyVerdicts,
  collectProgress,
  createRunState,
  emptyProgress,
  finishScreening,
  isResumable,
  pendingBodies,
  seedRun,
  startupAction,
  pendingSources,
  retryFailedSources,
  selectedItems,
  syncSources,
  unscreenedItems,
  type CollectProgress,
  type InfoRunState,
  type RunSeed,
} from "../../src/info/briefing/run-state";
import type { InfoItem } from "../../src/info/sources/item";

// An expectation names only the counters it is about.
function progress(over: Partial<CollectProgress>): CollectProgress {
  return { ...emptyProgress(), ...over };
}

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
  expect(s.phase).toBe("discovering");
  expect(pendingSources(s).map((r) => r.id)).toEqual(["a", "b"]);
  expect(s.items).toEqual([]);
  expect(collectProgress(s)).toEqual(progress({ total: 2 }));
});

test("a settled source is off the pending list and its items are in the checkpoint", () => {
  const s = applySourceResult(fresh(), { id: "a", items: [item("a1"), item("a2")] }, 2000);
  expect(pendingSources(s).map((r) => r.id)).toEqual(["b"]);
  expect(s.items.map((i) => i.id)).toEqual(["a1", "a2"]);
  expect(collectProgress(s)).toEqual(progress({ total: 2, done: 1, items: 2, lastDone: "A" }));
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
  expect(isResumable({ ...s, version: 1 as unknown as 2 }, "2026-07-22")).toBe(false);
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

// --- the funnel's later phases (docs/35) ------------------------------------

// A run with two sources discovered and four items in hand.
function discovered(): InfoRunState {
  return applySourceResult(
    applySourceResult(fresh(), { id: "a", items: [item("a1"), item("a2")] }, 2000),
    { id: "b", items: [item("b1"), item("b2")] },
    3000,
  );
}

function verdict(id: string, keep: boolean, confidence = 2) {
  return { id, keep, why: "", confidence };
}

test("only unjudged items are owed to the screen, so a resumed run never rejudges", () => {
  const s = discovered();
  expect(unscreenedItems(s).map((i) => i.id)).toEqual(["a1", "a2", "b1", "b2"]);
  const after = applyVerdicts(s, ["a1", "a2"], [verdict("a1", true), verdict("a2", false)], 4000);
  expect(unscreenedItems(after).map((i) => i.id)).toEqual(["b1", "b2"]);
  expect(collectProgress(after)).toMatchObject({ screened: 2, kept: 1, dropped: 1 });
});

test("an item the model skipped in its reply is kept, not silently dropped", () => {
  // The batch asked about both; the reply mentions only one.
  const s = applyVerdicts(discovered(), ["a1", "a2"], [verdict("a2", false)], 4000);
  expect(s.verdicts.a1).toEqual({ id: "a1", keep: true, why: "not judged; kept by default", confidence: 0 });
  expect(s.verdicts.a2.keep).toBe(false);
});

test("finishing the screen selects the keeps in discovery order and moves to fetching", () => {
  const judged = applyVerdicts(
    discovered(),
    ["a1", "a2", "b1", "b2"],
    [verdict("b1", true), verdict("a1", true), verdict("a2", false), verdict("b2", false)],
    4000,
  );
  const done = finishScreening(judged, 120, 5000);
  expect(done.phase).toBe("fetching");
  expect(done.selection).toEqual({ ids: ["a1", "b1"], cappedOut: 0 });
  expect(selectedItems(done).map((i) => i.id)).toEqual(["a1", "b1"]);
  expect(pendingBodies(done).map((i) => i.id)).toEqual(["a1", "b1"]);
  expect(collectProgress(done)).toMatchObject({ kept: 2, dropped: 2, cappedOut: 0, bodiesTotal: 2 });
});

test("the cap cuts the least confident keeps and says how many it cut", () => {
  const judged = applyVerdicts(
    discovered(),
    ["a1", "a2", "b1", "b2"],
    [verdict("a1", true, 1), verdict("a2", true, 3), verdict("b1", true, 0), verdict("b2", true, 2)],
    4000,
  );
  const done = finishScreening(judged, 2, 5000);
  // The two the screen was surest of, back in discovery order.
  expect(done.selection).toEqual({ ids: ["a2", "b2"], cappedOut: 2 });
  expect(collectProgress(done).cappedOut).toBe(2);
  // The cut ones are dropped from the day, not left half-selected.
  expect(collectProgress(done)).toMatchObject({ kept: 2, dropped: 2 });
});

test("a fetched body is folded in and marked paid for, so a resume skips it", () => {
  const judged = applyVerdicts(
    discovered(),
    ["a1", "a2", "b1", "b2"],
    [verdict("a1", true), verdict("a2", true), verdict("b1", false), verdict("b2", false)],
    4000,
  );
  const selected = finishScreening(judged, 120, 5000);
  const withBody = applyBody(selected, { ...item("a1"), textContent: "the body" }, 6000);
  expect(pendingBodies(withBody).map((i) => i.id)).toEqual(["a2"]);
  expect(withBody.items.find((i) => i.id === "a1")!.textContent).toBe("the body");
  expect(collectProgress(withBody)).toMatchObject({ bodies: 1, bodiesTotal: 2 });
  // Applying the same body twice cannot double the tally.
  expect(applyBody(withBody, { ...item("a1"), textContent: "again" }, 7000).material).toEqual(["a1"]);
});

// --- seeding from the pool (docs/35) ----------------------------------------

function seed(over: Partial<RunSeed> = {}): RunSeed {
  return { items: [], verdicts: {}, bodies: {}, settled: [], ...over };
}

test("the pool's items join the run's own, after them and without duplicating them", () => {
  const s = seedRun(discovered(), seed({ items: [item("a1"), item("p1"), item("p2")] }), 9000);
  expect(s.items.map((i) => i.id)).toEqual(["a1", "a2", "b1", "b2", "p1", "p2"]);
  expect(s.updatedAt).toBe(9000);
});

test("a carried verdict means the screen never sees that item again", () => {
  const s = seedRun(
    discovered(),
    seed({ items: [item("p1")], verdicts: { a1: verdict("a1", false), p1: verdict("p1", true) } }),
    9000,
  );
  expect(unscreenedItems(s).map((i) => i.id)).toEqual(["a2", "b1", "b2"]);
});

test("a verdict the run produced itself wins over the pool's older one", () => {
  const judged = applyVerdicts(discovered(), ["a1"], [verdict("a1", true, 3)], 4000);
  const s = seedRun(judged, seed({ verdicts: { a1: verdict("a1", false, 0) } }), 9000);
  expect(s.verdicts.a1).toMatchObject({ keep: true, confidence: 3 });
});

test("a verdict for an item nobody is holding is not carried in", () => {
  const s = seedRun(discovered(), seed({ verdicts: { ghost: verdict("ghost", true) } }), 9000);
  expect(s.verdicts.ghost).toBeUndefined();
});

test("a body already on disk is folded in and counted as paid for, so the fetch step skips it", () => {
  const judged = applyVerdicts(
    discovered(),
    ["a1", "a2", "b1", "b2"],
    [verdict("a1", true), verdict("a2", true), verdict("b1", false), verdict("b2", false)],
    4000,
  );
  const selected = finishScreening(judged, 120, 5000);
  const s = seedRun(selected, seed({ bodies: { a1: { textContent: "cached body" } } }), 9000);
  expect(s.items.find((i) => i.id === "a1")).toMatchObject({
    textContent: "cached body",
    summaryOnly: false,
  });
  expect(s.material).toEqual(["a1"]);
  expect(pendingBodies(s).map((i) => i.id)).toEqual(["a2"]);
});

test("an item that shipped its own text keeps it rather than taking the cached copy", () => {
  const own = { ...item("a1"), textContent: "from the feed" };
  const state = applySourceResult(fresh(), { id: "a", items: [own] }, 2000);
  const s = seedRun(state, seed({ bodies: { a1: { textContent: "from the cache" } } }), 9000);
  expect(s.items[0].textContent).toBe("from the feed");
});

test("an item an earlier day settled is dropped even though a source just offered it again", () => {
  // The re-delivery the marks exist to prevent: a three-week feed window means
  // rediscovering what yesterday's briefing carried is the normal case.
  const s = seedRun(discovered(), seed({ settled: ["a1", "b2"] }), 9000);
  expect(s.items.map((i) => i.id)).toEqual(["a2", "b1"]);
  expect(unscreenedItems(s).map((i) => i.id)).toEqual(["a2", "b1"]);
});

test("a settled item this run already judged stays, so the screen's count still names what it holds", () => {
  const judged = applyVerdicts(discovered(), ["a1"], [verdict("a1", true)], 4000);
  const s = seedRun(judged, seed({ settled: ["a1"] }), 9000);
  expect(s.items.map((i) => i.id)).toEqual(["a1", "a2", "b1", "b2"]);
});

// --- what opening the app does (docs/35) -------------------------------------

const TODAY = "2026-07-22";

function halted(kind: "stopped" | "failed"): InfoRunState {
  return { ...discovered(), halt: { kind } };
}

test("a run cut off mid-flight is finished without asking", () => {
  expect(startupAction({ briefing: null, run: discovered(), today: TODAY })).toBe("resume");
});

test("a day with nothing to show collects itself", () => {
  expect(startupAction({ briefing: null, run: null, today: TODAY })).toBe("generate");
  // Yesterday's briefing is not today's, and neither is yesterday's leftover run.
  expect(startupAction({ briefing: { date: "2026-07-21" }, run: null, today: TODAY })).toBe("generate");
  expect(
    startupAction({ briefing: null, run: { ...halted("failed"), date: "2026-07-21" }, today: TODAY }),
  ).toBe("generate");
});

test("today's briefing already being here is the whole answer", () => {
  expect(startupAction({ briefing: { date: TODAY }, run: null, today: TODAY })).toBe("none");
});

test("a run the user stopped or one that failed waits to be asked again", () => {
  expect(startupAction({ briefing: null, run: halted("stopped"), today: TODAY })).toBe("none");
  expect(startupAction({ briefing: null, run: halted("failed"), today: TODAY })).toBe("none");
});
