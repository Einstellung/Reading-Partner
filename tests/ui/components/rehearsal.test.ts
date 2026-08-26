// The rehearsal's logic without React (src/ui/components/rehearsal/rehearsal.ts):
// what it puts on the bar and how a pass ends. The view is a scrolling note and
// a microphone; everything that can be wrong is in here. Run: bun test.

import { expect, test } from "bun:test";
import {
  endEvent,
  finishRun,
  formatElapsed,
  rehearsalReadiness,
  utteranceEvent,
} from "../../../src/ui/components/rehearsal/rehearsal";
import type {
  RehearsalEvent,
  RehearsalRun,
  TranscriptSource,
} from "../../../src/reading/rehearsal";

test("what was said and where a pass ended become timestamped events", () => {
  expect(utteranceEvent({ text: "so", startedAt: 5, endedAt: 9 })).toEqual({
    kind: "utterance",
    at: 5,
    endedAt: 9,
    text: "so",
  });
  expect(endEvent(7)).toEqual({ kind: "end", at: 7 });
});

test("elapsed time reads in minutes until it needs hours", () => {
  expect(formatElapsed(0)).toBe("0:00");
  expect(formatElapsed(9_000)).toBe("0:09");
  expect(formatElapsed(61_000)).toBe("1:01");
  expect(formatElapsed(11 * 60_000 + 7_000)).toBe("11:07");
  expect(formatElapsed(3_600_000)).toBe("1:00:00");
  expect(formatElapsed(3_723_000)).toBe("1:02:03");
  expect(formatElapsed(-5)).toBe("0:00");
});

test("the Rehearse button says why it is off", () => {
  expect(rehearsalReadiness({ segments: null }).ok).toBe(false);
  expect(rehearsalReadiness({ segments: null }).title).toContain("Looking");
  const none = rehearsalReadiness({ segments: 0 });
  expect(none.ok).toBe(false);
  expect(none.title).toContain("no segments");
  expect(rehearsalReadiness({ segments: 3 }).ok).toBe(true);
});

test("a rehearsal being started holds the button, outline or no outline", () => {
  const starting = rehearsalReadiness({ segments: 3, preparing: true });
  expect(starting.ok).toBe(false);
  expect(starting.title).toContain("Starting");
  // The gate lifts on its own, so the same retell is rehearsable again afterwards.
  expect(rehearsalReadiness({ segments: 3, preparing: false }).ok).toBe(true);
});

// --- ending a rehearsal ------------------------------------------------------

// A source whose last words only arrive while it is being stopped, which is what
// the desktop one does: stop() sends the final segment and waits for every
// upload still out.
function lateSource(events: RehearsalEvent[], said: string): TranscriptSource {
  return {
    start: async () => {},
    cut: () => {},
    stop: async () => {
      events.push(utteranceEvent({ text: said, startedAt: 2_000, endedAt: 3_000 }));
    },
  };
}

const said = (text: string, at: number): RehearsalEvent =>
  utteranceEvent({ text, startedAt: at, endedAt: at + 500 });

const finishInput = (events: RehearsalEvent[], save: (run: RehearsalRun) => Promise<unknown>) => ({
  rehearsalId: "t-1",
  id: "run-1",
  startedAt: 1_000,
  endedAt: 4_000,
  events: () => events,
  save,
});

// The claim the whole surface rests on (docs/44): the reader talks from a note
// that turns no pages, nothing records where they were, and the pass comes out
// as one stretch holding everything they said. buildRun is untouched and drops
// anything said before the first page event, so finishRun opens the pass with
// one — without it a run would be no pages and no words at all.
test("a pass is one page holding the whole transcript", async () => {
  const written: RehearsalRun[] = [];
  const saved = await finishRun(
    finishInput(
      [said("Good evening.", 1_500), said("So that is it.", 3_000)],
      async (run) => void written.push(run),
    ),
  );
  expect(saved).toBe(true);
  expect(written[0].pages).toHaveLength(1);
  expect(written[0].pages[0].transcript).toBe("Good evening.\nSo that is it.");
  // No id on it, so the entry written off this run covers no segments.
  expect(written[0].pages[0].kind).toBe("");
  expect(written[0].pages[0].enteredAt).toBe(1_000);
  expect(written[0].pages[0].leftAt).toBe(4_000);
});

test("the run is built out of what arrived while the source was stopping", async () => {
  const events: RehearsalEvent[] = [];
  const written: RehearsalRun[] = [];
  const saved = await finishRun({
    ...finishInput(events, async (run) => void written.push(run)),
    source: lateSource(events, "the last thing I said"),
  });
  expect(saved).toBe(true);
  expect(written).toHaveLength(1);
  expect(written[0].pages[0].transcript).toBe("the last thing I said");
  // Stamped when the reader finished, not when the upload came back.
  expect(written[0].endedAt).toBe(4_000);
});

// No STT key on the desktop and no dictation on the host record a pass with no
// words in it, and that is the ordinary case rather than a failure. Nothing is
// left to tell it apart from a rehearsal the reader turned round in, so every
// pass is written.
test("a pass given in silence is still written", async () => {
  const written: RehearsalRun[] = [];
  const saved = await finishRun(finishInput([], async (run) => void written.push(run)));
  expect(saved).toBe(true);
  expect(written).toHaveLength(1);
  expect(written[0].pages[0].transcript).toBe("");
});

test("a write that failed is not reported as a run", async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const saved = await finishRun(
      finishInput([said("Good evening.", 1_500)], () => Promise.reject(new Error("disk full"))),
    );
    expect(saved).toBe(false);
  } finally {
    console.warn = realWarn;
  }
});

// docs/44: stopping is handing the pass in. The handoff runs on the far side of
// the write, so what the coach is told about is a pass the reader can open.
test("a written run is handed to the conversation, after the write", async () => {
  const order: string[] = [];
  const saved = await finishRun({
    ...finishInput([said("Good evening.", 1_500)], async () => {
      order.push("save");
      return "entry-1";
    }),
    handoff: async (run, entry) => {
      order.push(`handoff ${entry} ${run.id}`);
    },
  });
  expect(saved).toBe(true);
  expect(order).toEqual(["save", "handoff entry-1 run-1"]);
});

test("a pass that was never written is not handed over", async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const handed: string[] = [];
    const saved = await finishRun({
      ...finishInput([said("Good evening.", 1_500)], () => Promise.reject(new Error("disk full"))),
      handoff: async () => void handed.push("handed"),
    });
    expect(saved).toBe(false);
    expect(handed).toEqual([]);
  } finally {
    console.warn = realWarn;
  }
});

// The pass happened whatever the conversation did with it: a handoff that threw
// must not turn a recorded pass into one the caller reads as lost.
test("a handoff that fails still leaves the pass recorded", async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const saved = await finishRun({
      ...finishInput([said("Good evening.", 1_500)], async () => "entry-1"),
      handoff: () => Promise.reject(new Error("no thread")),
    });
    expect(saved).toBe(true);
  } finally {
    console.warn = realWarn;
  }
});

test("a source that will not stop still costs only its own words", async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const written: RehearsalRun[] = [];
    const saved = await finishRun({
      ...finishInput([], async (run) => void written.push(run)),
      source: {
        start: async () => {},
        cut: () => {},
        stop: () => Promise.reject(new Error("the recorder is gone")),
      },
    });
    expect(saved).toBe(true);
    expect(written[0].pages[0].transcript).toBe("");
  } finally {
    console.warn = realWarn;
  }
});
