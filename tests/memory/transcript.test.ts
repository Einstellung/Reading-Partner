// The numbered transcript, and the thread attribution it restores.
//
// The defect these cover, measured on one real store: 76 of 298 stored message
// anchors resolved against no message, and 66 of them were folded-aside lines
// printed with the parent thread's id.

import { expect, test } from "bun:test";
import { buildDistillUserMessage } from "../../src/memory/observations/distill";
import { distillUnits } from "../../src/memory/observations/arrears";
import {
  buildTranscript,
  coveredDays,
  renderTranscript,
  transcriptAnchors,
} from "../../src/memory/observations/transcript";
import { JULY_17 } from "./fakefs";

test("a message keeps its own thread id; only an unstamped one falls back", () => {
  const lines = buildTranscript(
    [
      { role: "user", text: "lesson", ts: 1, threadId: "lesson-1" },
      { role: "user", text: "aside", ts: 2, threadId: "aside-9" },
      { role: "ai", text: "single-thread pass", ts: 3 },
    ],
    "lesson-1",
  );
  expect(transcriptAnchors(lines)).toEqual(["lesson-1:1", "aside-9:2", "lesson-1:3"]);
});

test("a folded aside renders under its own thread id, not the unit's", () => {
  const [unit] = distillUnits([
    {
      id: "lesson-1",
      annotationId: "ann-1",
      messages: [
        { role: "user", text: "what is a key?", ts: 10 },
        { role: "ai", text: "a projection", ts: 30 },
      ],
    },
    // Pageless aside: no page, so it folds into the lesson and its messages are
    // merged into the lesson's transcript by timestamp.
    { id: "aside-2", annotationId: "", parentThreadId: "lesson-1", messages: [{ role: "user", text: "and a query?", ts: 20 }] },
  ]);
  const anchors = transcriptAnchors(buildTranscript(unit.messages, unit.threadId));
  expect(anchors).toEqual(["lesson-1:10", "aside-2:20", "lesson-1:30"]);
  // The unit's own id would have been the parent's for every line — the 66.
  expect(anchors[1]).not.toBe("lesson-1:20");
});

test("an index maps to the message it was printed against", () => {
  const messages = [
    { role: "user" as const, text: "a", ts: 10, threadId: "t1" },
    { role: "ai" as const, text: "b", ts: 20, threadId: "t2" },
    { role: "user" as const, text: "c", ts: 30, threadId: "t1" },
  ];
  const lines = buildTranscript(messages, "t1");
  const rendered = renderTranscript(lines);
  expect(rendered[1].startsWith("[2] ")).toBe(true);
  expect(transcriptAnchors(lines)[2 - 1]).toBe("t2:20");
});

// The same clock the store dates by (files.ts localDate): at UTC+8 an hour of
// late-night reading falls on the previous UTC day, and dating it by UTC would
// write the conversation up as the day before.
test("a line carries the local calendar day of that message", () => {
  const lateNight = new Date("2026-08-21T16:30:00Z").getTime();
  const [line] = buildTranscript([{ role: "user", text: "still awake", ts: lateNight }], "t1");
  const local = new Date(lateNight);
  const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(
    local.getDate(),
  ).padStart(2, "0")}`;
  expect(line.date).toBe(expected);
  expect(renderTranscript([line])[0]).toBe(`[1] ${expected} reader: still awake`);
});

// A row written before messages carried a timestamp: it still gets a line and a
// number, it just cannot claim a day.
test("a message with no usable timestamp renders without a date", () => {
  const [line] = buildTranscript([{ role: "ai", text: "old row", ts: 0 }], "t1");
  expect(line.date).toBeNull();
  expect(renderTranscript([line])[0]).toBe("[1] you: old row");
});

test("the distill prompt prints the folded aside's own attribution nowhere and its number everywhere", () => {
  const [unit] = distillUnits([
    { id: "lesson-1", annotationId: "ann-1", messages: [{ role: "user", text: "what is a key?", ts: JULY_17 }] },
    {
      id: "aside-2",
      annotationId: "",
      parentThreadId: "lesson-1",
      messages: [{ role: "user", text: "and a query?", ts: JULY_17 + 1000 }],
    },
  ]);
  const msg = buildDistillUserMessage({
    topicName: "attention",
    bookName: "survey.pdf",
    threadId: unit.threadId,
    annotationId: unit.annotationId,
    page: 12,
    markedText: "",
    messages: unit.messages,
    indexText: "",
    dates: { first: "2026-07-17", last: "2026-07-17" },
  });
  expect(msg).toContain("[1] 2026-07-17 reader: what is a key?");
  expect(msg).toContain("[2] 2026-07-17 reader: and a query?");
  // No id in the transcript at all, so none can be copied back wrong.
  expect(msg).not.toContain("aside-2:");
  expect(msg).not.toContain("lesson-1:");
});

// What dates an observation: the days its own cited evidence covers, which is
// finer than the pass's span — the whole point being that the day the pass runs
// is not the day the reader was here.
test("coveredDays spans the days it is given and drops the ones it is not", () => {
  expect(coveredDays(["2026-07-09", "2026-07-01", "2026-07-03"])).toEqual({
    first: "2026-07-01",
    last: "2026-07-09",
  });
  expect(coveredDays(["2026-07-01"])).toEqual({ first: "2026-07-01", last: "2026-07-01" });
  expect(coveredDays([null, "2026-07-01", undefined])).toEqual({
    first: "2026-07-01",
    last: "2026-07-01",
  });
  expect(coveredDays([])).toBeNull();
  expect(coveredDays([null, null])).toBeNull();
});
