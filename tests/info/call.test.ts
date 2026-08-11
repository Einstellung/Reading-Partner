// The React-free half of the info call (src/info/companion/call.ts): the thread
// id, the one briefing card's progress -> ready/failed lifecycle read off a
// pipeline snapshot, and the synthetic turns the thread carries. Pure — no
// React, no pipeline, no filesystem. Run: bun test.

import { expect, test } from "bun:test";
import {
  briefingJobUpdate,
  briefingProgressCard,
  infoBookId,
  profileAppliedNote,
  sourceAddedNote,
} from "../../src/info/companion/call";
import type { InfoSnapshot } from "../../src/info/briefing/pipeline";
import type { Briefing } from "../../src/info/briefing/types";
import type { ProfileUpdateCardData } from "../../src/info/briefing/cards";
import type { ProbeConfirmCardData } from "../../src/info/sources/source-cards";

const IDLE: InfoSnapshot = {
  briefing: null,
  running: false,
  stopping: false,
  phase: "idle",
  collect: null,
  activity: null,
  error: null,
};

function snapshot(patch: Partial<InfoSnapshot>): InfoSnapshot {
  return { ...IDLE, ...patch };
}

// Two must-reads + one out-of-lane = 3 "worth your time"; one one-liner; two filtered.
function briefing(patch: Partial<Briefing> = {}): Briefing {
  return {
    date: "2026-07-25",
    generatedAt: 1_700_000_000_000,
    overview: "Two real papers, the rest is vendor noise.",
    mustRead: [
      { itemId: "a", reason: "matches your robotics lane" },
      { itemId: "b", reason: "the eval you asked about" },
    ],
    oneLiners: [{ itemId: "c", line: "A funding round, nothing technical." }],
    outOfLane: [{ itemId: "d", reason: "outside your lane but load-bearing" }],
    filtered: [
      { itemId: "e", category: "vendor PR" },
      { itemId: "f", category: "conference recap" },
    ],
    items: {},
    ...patch,
  };
}

test("info threads are namespaced per day", () => {
  expect(infoBookId("2026-07-25")).toBe("info-2026-07-25");
  expect(infoBookId("2026-07-24")).not.toBe(infoBookId("2026-07-25"));
});

// --- the progress card ------------------------------------------------------

test("the card a job starts with takes its phase from the job, not a snapshot", () => {
  // Nothing has been collected or triaged yet, so both readouts are empty.
  expect(briefingProgressCard("first", null)).toEqual({
    kind: "briefing-progress",
    phase: "discovering",
    collect: null,
    triage: null,
    stopping: false,
    title: undefined,
  });
  // A re-triage never fetches: it opens straight in the triaging phase.
  expect(briefingProgressCard("retriage", null)).toMatchObject({
    phase: "triaging",
    title: "Re-running today's triage",
  });
  expect(briefingProgressCard("full", null)).toMatchObject({
    phase: "discovering",
    title: "Regenerating today's briefing",
  });
});

test("the progress card mirrors the snapshot's phase and collection counts", () => {
  const collect = {
    total: 4,
    done: 2,
    failed: 1,
    items: 17,
    lastDone: "Robot Report",
    screened: 0,
    kept: 0,
    dropped: 0,
    cappedOut: 0,
    bodies: 0,
    bodiesTotal: 0,
  };
  expect(briefingProgressCard("first", snapshot({ running: true, phase: "discovering", collect }))).toEqual({
    kind: "briefing-progress",
    phase: "discovering",
    collect,
    triage: null,
    stopping: false,
    title: undefined,
  });
});

test("the progress card carries triage liveness once the AI call starts", () => {
  const s = snapshot({
    running: true,
    phase: "triaging",
    collect: {
      total: 4,
      done: 4,
      failed: 0,
      items: 17,
      lastDone: "Robot Report",
      screened: 17,
      kept: 5,
      dropped: 12,
      cappedOut: 0,
      bodies: 5,
      bodiesTotal: 5,
    },
    activity: { startedAt: 1000, chars: 240, attempt: 2, attempts: 3 },
  });
  const card = briefingProgressCard("full", s);
  expect(card.phase).toBe("triaging");
  expect(card.triage).toEqual({ startedAt: 1000, chars: 240, attempt: 2, attempts: 3 });
});

// --- the job update (running -> ready / failed) -----------------------------

test("a running snapshot yields the progress card and no note", () => {
  const s = snapshot({ running: true, phase: "fetching", collect: null });
  const update = briefingJobUpdate("first", s);
  expect(update.status).toBe("running");
  expect(update.card.kind).toBe("briefing-progress");
  expect(update).not.toHaveProperty("note");
});

test("a settled first briefing becomes the ready card, keeping the onboarding copy", () => {
  const update = briefingJobUpdate("first", snapshot({ briefing: briefing() }));
  expect(update).toMatchObject({
    status: "ready",
    card: { kind: "briefing-ready", date: "2026-07-25", worth: 3, oneLiners: 1, filtered: 2 },
  });
  // "first" overrides nothing, so the card falls back to its onboarding heading/note.
  const card = update.card as { title?: string; note?: string };
  expect(card.title).toBeUndefined();
  expect(card.note).toBeUndefined();
});

test("the completion note re-anchors the AI on the new briefing's overview and counts", () => {
  const update = briefingJobUpdate("first", snapshot({ briefing: briefing() }));
  const note = update.status === "ready" ? update.note : "";
  expect(note).toContain("has been generated");
  expect(note).toContain("Two real papers, the rest is vendor noise.");
  expect(note).toContain("worth your time: 3");
  expect(note).toContain("one-liners: 1");
  expect(note).toContain("filtered: 2");
  expect(note).toContain("not the earlier one");
});

test("a re-triage settles with its own card copy and verb", () => {
  const update = briefingJobUpdate("retriage", snapshot({ briefing: briefing() }));
  expect(update.card).toMatchObject({
    title: "Briefing updated",
    note: "Re-triaged today's items with your updated profile.",
  });
  expect(update.status === "ready" && update.note).toContain("has been re-sorted");
});

test("a full regeneration settles with its own card copy and verb", () => {
  const update = briefingJobUpdate("full", snapshot({ briefing: briefing() }));
  expect(update.card).toMatchObject({
    title: "Briefing regenerated",
    note: "Re-collected every source and re-triaged.",
  });
  expect(update.status === "ready" && update.note).toContain("has been regenerated");
});

test("a settled run with no briefing becomes the failed card, quoting the error", () => {
  const update = briefingJobUpdate("full", snapshot({ error: "No articles could be fetched" }));
  expect(update).toMatchObject({
    status: "failed",
    card: { kind: "briefing-failed", message: "No articles could be fetched" },
  });
  expect(update.status === "failed" && update.note).toBe(
    "The briefing regeneration failed: No articles could be fetched.",
  );
});

test("a failed run does not report the briefing it failed to replace", () => {
  // The pipeline keeps the previous briefing on failure, so a re-triage that
  // died must still settle as failed rather than announcing "Briefing updated"
  // over the old one's counts.
  const update = briefingJobUpdate("retriage", snapshot({ briefing: briefing(), error: "no provider" }));
  expect(update.status).toBe("failed");
  expect(update.card).toEqual({ kind: "briefing-failed", message: "no provider" });
});

test("the failure note names the job, and both card and note survive a null error", () => {
  const retriage = briefingJobUpdate("retriage", snapshot({ error: "boom" }));
  expect(retriage.status === "failed" && retriage.note).toBe("The briefing re-triage failed: boom.");
  const blank = briefingJobUpdate("first", snapshot({ error: null }));
  expect(blank.card).toEqual({ kind: "briefing-failed", message: "The briefing could not be generated." });
  expect(blank.status === "failed" && blank.note).toBe("The briefing regeneration failed: unknown error.");
});

// --- the synthetic turns a card gesture injects ----------------------------

test("a card gesture reports itself to the AI in the user's voice", () => {
  const probe = {
    kind: "probe-confirm",
    descriptor: { id: "s1", name: "量子位", enabled: true },
    pipeLabel: "RSS (full text)",
    samples: [],
  } as unknown as ProbeConfirmCardData;
  expect(sourceAddedNote(probe)).toBe('Added "量子位" to my sources.');

  const profile: ProfileUpdateCardData = {
    kind: "profile-update",
    summary: "Harsher on vendor PR",
    profile: "…",
    phase: "draft",
  };
  expect(profileAppliedNote(profile)).toBe("Applied the profile update: Harsher on vendor PR.");
});
