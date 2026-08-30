// What observation_update will accept as evidence. The message id is never a
// tool parameter: the model cites a transcript line number and the mount turns
// it back into "<threadId>:<ts>" (transcript.ts), so an anchor that resolves to
// nothing has no way in.

import { expect, test } from "bun:test";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import { ObservationFileStore } from "../../src/memory/observations/store";
import { buildObservationTools } from "../../src/memory/observations/tools";
import type { TranscriptLine } from "../../src/memory/observations/transcript";
import { JULY_17, makeFakeFs } from "./fakefs";

// The rendered transcript the mount is given: each line carries the anchor that
// lands on disk and the day that line happened. A bare string is a line whose
// timestamp was unusable, so it has no day.
function lines(...specs: (string | [string, string])[]): TranscriptLine[] {
  return specs.map((spec, i) => {
    const [anchor, date] = typeof spec === "string" ? [spec, null] : spec;
    return { index: i + 1, anchor, date, role: "user" as const, text: "…" };
  });
}

function mount(opts: Parameters<typeof buildObservationTools>[1] = {}) {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore("t", fs, () => JULY_17);
  return { store, ...mountOn(store, opts) };
}

// A second pass over a store that already has observations in it — the sweep
// coming back to the same topic with a different stretch of evidence.
function mountOn(
  store: ObservationFileStore,
  opts: Parameters<typeof buildObservationTools>[1] = {},
) {
  const adapter = new FileObservationAdapter(store);
  const write = buildObservationTools(adapter, opts).find((t) => t.name === "observation_update")!;
  return { write };
}

const CREATE = {
  action: "create",
  type: "stuck-point",
  summary: "Stuck on the key/query split",
  body: "Asked on 2026-07-17.",
};

test("an index is stored as the anchor of the line it was printed against", async () => {
  // Line 2 came from a folded aside, so its anchor is that aside's thread —
  // the case that produced 66 of the 76 broken anchors on disk.
  const { store, write } = mount({ messageLines: lines("lesson-1:10", "aside-2:20", "lesson-1:30") });
  await write.execute({ ...CREATE, messageIndices: [2] });
  expect((await store.list())[0].anchors.messageIds).toEqual(["aside-2:20"]);
});

test("indices are stored sorted and de-duplicated, in the transcript's order", async () => {
  const { store, write } = mount({ messageLines: lines("t:10", "t:20", "t:30") });
  await write.execute({ ...CREATE, messageIndices: [3, 1, 3] });
  expect((await store.list())[0].anchors.messageIds).toEqual(["t:10", "t:30"]);
});

test("the schema bounds an index to the lines actually rendered", () => {
  const { write } = mount({ messageLines: lines("t:10", "t:20") });
  const schema = write.parameters as { properties: Record<string, any> };
  expect(schema.properties.messageIndices.items).toMatchObject({
    type: "integer",
    minimum: 1,
    maximum: 2,
  });
  // And the id form is gone: there is no string parameter left to invent one in.
  expect(schema.properties.messageIds).toBeUndefined();
});

test("an out-of-range index is refused rather than stored", async () => {
  const { store, write } = mount({ messageLines: lines("t:10", "t:20") });
  await expect(write.execute({ ...CREATE, messageIndices: [3] })).rejects.toThrow(
    "not a transcript line (1-2)",
  );
  expect(await store.list()).toHaveLength(0);
});

test("a mount with no transcript offers no message parameter at all", () => {
  const { write } = mount({});
  const schema = write.parameters as { properties: Record<string, any> };
  expect(schema.properties.messageIndices).toBeUndefined();
});

test("requireAnchor refuses a create with nothing pointing back at it", async () => {
  const { store, write } = mount({ messageLines: lines("t:10"), requireAnchor: true });
  await expect(write.execute({ ...CREATE })).rejects.toThrow("requires evidence");
  await expect(write.execute({ ...CREATE, annotationIds: [] })).rejects.toThrow("requires evidence");
  expect(await store.list()).toHaveLength(0);
  // Either kind of anchor satisfies it, so the marks pass — which has annotation
  // ids and no transcript — is not broken by the rule.
  await write.execute({ ...CREATE, annotationIds: ["ann-1"] });
  expect(await store.list()).toHaveLength(1);
});

test("the marks pass can satisfy requireAnchor with annotation ids alone", async () => {
  const { store, write } = mount({ requireAnchor: true });
  await expect(write.execute({ ...CREATE })).rejects.toThrow("requires evidence");
  await write.execute({ ...CREATE, annotationIds: ["ann-1"] });
  expect((await store.list())[0].anchors).toEqual({ annotationIds: ["ann-1"], messageIds: [] });
});

// The live reading and retell turns mount these tools mid-conversation, where
// there is no listing to cite. Requiring an anchor there would refuse every
// observation the reader's own conversation produces.
test("without requireAnchor a create with no evidence still goes through", async () => {
  const { store, write } = mount({});
  await write.execute({ ...CREATE });
  expect((await store.list())[0].anchors).toEqual({ annotationIds: [], messageIds: [] });
});

// --- what dates an observation ---
//
// The clock the pass runs on is not the day the reader was here: the arrears
// sweep comes back to a thread every half hour for as long as it is owed. On
// one real store 38 of 110 placeable observations carry a date their own
// evidence does not support, the worst off by 17 days. Everything below is that
// date coming off the evidence instead. The store's clock in these tests is
// 2026-07-17, so a date that is not that is a date the evidence produced.

test("a create is dated by the lines it cited, not by the day the pass runs", async () => {
  const { store, write } = mount({
    messageLines: lines(
      ["t:10", "2026-07-01"],
      ["t:20", "2026-07-03"],
      ["t:30", "2026-07-09"],
    ),
  });
  await write.execute({ ...CREATE, messageIndices: [2, 3] });
  const [entry] = await store.list();
  expect(entry.created).toBe("2026-07-03");
  expect(entry.updated).toBe("2026-07-09");
});

test("an observation made of marks is dated by when the marks were made", async () => {
  const { store, write } = mount({
    annotationDates: new Map([
      ["ann-1", "2026-06-20"],
      ["ann-2", "2026-06-28"],
      ["ann-3", "2026-07-05"],
    ]),
    requireAnchor: true,
  });
  await write.execute({ ...CREATE, annotationIds: ["ann-3", "ann-1"] });
  const [entry] = await store.list();
  expect(entry.created).toBe("2026-06-20");
  expect(entry.updated).toBe("2026-07-05");
});

test("cited marks and cited lines are dated together", async () => {
  const { store, write } = mount({
    messageLines: lines(["t:10", "2026-07-11"]),
    annotationDates: new Map([["ann-1", "2026-07-02"]]),
  });
  await write.execute({ ...CREATE, annotationIds: ["ann-1"], messageIndices: [1] });
  const [entry] = await store.list();
  expect(entry.created).toBe("2026-07-02");
  expect(entry.updated).toBe("2026-07-11");
});

test("a citation that carries no day falls back to what the pass covered", async () => {
  // Rows written before messages carried a timestamp: the line is real, its day
  // is not knowable, and the pass's own span is the honest answer.
  const { store, write } = mount({
    messageLines: lines("t:10", ["t:20", "2026-07-04"], ["t:30", "2026-07-06"]),
  });
  await write.execute({ ...CREATE, messageIndices: [1] });
  const [entry] = await store.list();
  expect(entry.created).toBe("2026-07-04");
  expect(entry.updated).toBe("2026-07-06");
});

// The live reading and retell turns mount no transcript, because the
// conversation is happening now — and then the clock is the right answer.
test("a mount with no evidence behind it still dates by the clock", async () => {
  const { store, write } = mount({});
  await write.execute({ ...CREATE });
  const [entry] = await store.list();
  expect(entry.created).toBe("2026-07-17");
  expect(entry.updated).toBe("2026-07-17");
});

test("an update moves updated to the evidence's last day, restated or not", async () => {
  const { store, write } = mount({
    messageLines: lines(["t:10", "2026-07-02"], ["t:20", "2026-07-08"]),
  });
  await write.execute({ ...CREATE, messageIndices: [1] });
  const id = (await store.list())[0].id;
  expect((await store.list())[0].updated).toBe("2026-07-02");

  // Citing the later line moves it there.
  await write.execute({ action: "update", id, body: "b2", messageIndices: [2] });
  expect((await store.list())[0].updated).toBe("2026-07-08");

  // An update that restates no anchor is still dated by the pass, never by the
  // day the sweep happens to run.
  const { store: store2, write: write2 } = mount({
    messageLines: lines(["t:10", "2026-07-02"], ["t:20", "2026-07-08"]),
  });
  await write2.execute({ ...CREATE, messageIndices: [1] });
  const id2 = (await store2.list())[0].id;
  await write2.execute({ action: "update", id: id2, body: "b2" });
  expect((await store2.list())[0].updated).toBe("2026-07-08");
  expect((await store2.list())[0].created).toBe("2026-07-02");
});

// The sweep drains its backlog oldest-first, so a pass over an older
// conversation must not make an observation look older than what it already
// carries: updated is the last day of ALL the evidence, not of the newest pass.
test("an update by older evidence does not move updated backwards", async () => {
  const { store, write } = mount({ messageLines: lines(["t:10", "2026-07-14"]) });
  await write.execute({ ...CREATE, messageIndices: [1] });
  const id = (await store.list())[0].id;

  const { write: older } = mountOn(store, { messageLines: lines(["t:5", "2026-07-01"]) });
  await older.execute({ action: "update", id, body: "b2", messageIndices: [1] });
  const [entry] = await store.list();
  expect(entry.updated).toBe("2026-07-14");
  expect(entry.created).toBe("2026-07-14");
});
