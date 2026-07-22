// The info-briefing orchestrator (src/info/pipeline.ts) as a state machine: the
// snapshot it exposes must carry live progress so the chat/vestibule UI can show
// a run is alive — per-source collection counts during fetching, then triage
// streaming liveness. Deps are injected, so this runs headless. Run: bun test.

import { expect, test } from "bun:test";
import { InfoPipeline, type InfoDeps, type InfoSnapshot } from "../../src/info/pipeline";
import type { CollectEvent } from "../../src/info/engine";
import type { InfoItem, TriageResult } from "../../src/info/types";

function item(id: string): InfoItem {
  return { id, source: "s", sourceName: "S", title: id, url: `https://x/${id}`, publishedAt: "" };
}

const EMPTY_TRIAGE: TriageResult = {
  overview: "ov",
  mustRead: [],
  oneLiners: [],
  outOfLane: [],
  filtered: [],
};

// A minimal set of injected deps; individual tests override collect/triage.
function makeDeps(over: Partial<InfoDeps>): InfoDeps {
  return {
    loadBriefing: async () => null,
    loadProfile: async () => "",
    loadFeedback: async () => [],
    collect: async () => [],
    triage: async () => EMPTY_TRIAGE,
    saveBriefing: async () => {},
    saveArticles: async () => {},
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    setTimer: (ms, cb) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    },
    today: () => "2026-07-22",
    ...over,
  };
}

test("collection progress accumulates into the snapshot: total, done, failed, items, lastDone", async () => {
  const snaps: InfoSnapshot[] = [];
  const events: CollectEvent[] = [
    { kind: "source-start", source: "a", sourceName: "Alpha", index: 0, total: 3 },
    { kind: "source-start", source: "b", sourceName: "Beta", index: 1, total: 3 },
    { kind: "source-start", source: "c", sourceName: "Gamma", index: 2, total: 3 },
    { kind: "source-done", source: "a", sourceName: "Alpha", index: 0, total: 3, items: 5 },
    { kind: "source-error", source: "b", sourceName: "Beta", index: 1, total: 3, error: "boom" },
    { kind: "source-done", source: "c", sourceName: "Gamma", index: 2, total: 3, items: 4 },
  ];

  const p = new InfoPipeline(
    makeDeps({
      collect: async (onProgress) => {
        for (const e of events) onProgress?.(e);
        return [item("1"), item("2")];
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate();

  // The last fetching-phase snapshot reflects all sources settled.
  const fetching = snaps.filter((s) => s.phase === "fetching" && s.collect);
  const last = fetching[fetching.length - 1];
  expect(last.collect).toEqual({ total: 3, done: 3, failed: 1, items: 9, lastDone: "Gamma" });

  // A mid-run snapshot (after Alpha done, before the rest) proves it is live.
  const afterFirstDone = fetching.find((s) => s.collect!.done === 1);
  expect(afterFirstDone!.collect).toEqual({ total: 3, done: 1, failed: 0, items: 5, lastDone: "Alpha" });
});

test("triage activity surfaces streaming char counts, then clears when finished", async () => {
  const snaps: InfoSnapshot[] = [];
  // A stepping clock so each char update clears the 250ms activity-notify throttle.
  let t = 1000;
  const p = new InfoPipeline(
    makeDeps({
      now: () => (t += 300),
      collect: async () => [item("1")],
      triage: async (_input, opts) => {
        opts.onProgress(120);
        opts.onProgress(480);
        return EMPTY_TRIAGE;
      },
    }),
  );
  p.subscribe(() => snaps.push(p.snapshot()));
  await p.generate();

  const triaging = snaps.filter((s) => s.phase === "triaging" && s.activity);
  expect(triaging.length).toBeGreaterThan(0);
  const maxChars = Math.max(...triaging.map((s) => s.activity!.chars));
  expect(maxChars).toBe(480);
  expect(triaging.every((s) => s.activity!.attempt === 1 && s.activity!.attempts === 3)).toBe(true);

  // Terminal snapshot: not running, collect/activity cleared, briefing set.
  const final = p.snapshot();
  expect(final.running).toBe(false);
  expect(final.collect).toBeNull();
  expect(final.activity).toBeNull();
  expect(final.briefing?.overview).toBe("ov");
});

test("a collect that returns no items fails the run and leaves an error", async () => {
  const p = new InfoPipeline(makeDeps({ collect: async () => [] }));
  await p.generate();
  const s = p.snapshot();
  expect(s.running).toBe(false);
  expect(s.briefing).toBeNull();
  expect(s.error).toBeTruthy();
});
