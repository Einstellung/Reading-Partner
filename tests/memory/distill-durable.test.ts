// Distillation end to end on the durable runtime (legion/durable/background.ts)
// with the faux provider: the pass's own observation tools, validated against
// the run's own schema, and an empty pass that still counts as finished
// (docs/soul/87, 第三阶段验收).

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBackgroundTurnOn } from "../../src/legion/durable/background";
import { FileObservationAdapter } from "../../src/memory/observations/adapter";
import { runDistillPass, type DistillPassInput } from "../../src/memory/observations/distill";
import { ObservationFileStore, topicPassStore } from "../../src/memory/observations/store";
import { openTestRuntime } from "../legion/durable/support/runtime";
import { JULY_17, makeFakeFs } from "./fakefs";

const TOPIC = "t";
const MODEL = { providerId: "faux" as never, modelId: "faux-1" };

function makeStore() {
  const { fs } = makeFakeFs();
  const store = new ObservationFileStore(fs, () => JULY_17);
  return { store, pass: topicPassStore(store, TOPIC), adapter: new FileObservationAdapter(store, TOPIC) };
}

function passInput(): DistillPassInput {
  return {
    topicName: "attention",
    bookId: "book-1",
    bookName: "survey.pdf",
    threadId: "thread-1",
    annotationId: "ann-1",
    page: 12,
    markedText: "the marked sentence",
    messages: [
      { role: "user", text: "why is this quadratic?", ts: 100 },
      { role: "ai", text: "because every token attends to every token", ts: 200 },
    ],
    annotations: [],
  };
}

test("an empty pass is a finished pass: nothing written, the cursors move, nothing live", async () => {
  const t = await openTestRuntime({
    root: mkdtempSync(join(tmpdir(), "distill-durable-")),
    responses: [fauxAssistantMessage(fauxText("Nothing new to record."))],
  });
  const { store, pass, adapter } = makeStore();
  const result = await runDistillPass(passInput(), {
    store: pass,
    adapter,
    now: () => JULY_17,
    model: MODEL,
    run: (request) => runBackgroundTurnOn({ runtime: t.runtime }, request),
  });
  expect(result).toMatchObject({ ran: true, ok: true, created: 0, updated: 0, deleted: 0, outcome: "answered" });
  expect((await store.getMeta(TOPIC)).distilledMessages).toEqual({ "thread-1": 2 });
  expect(await store.list()).toHaveLength(0);
  const inspection = await t.runtime.harness.inspect(ctx);
  expect(inspection.tasks.length + inspection.submissions.length).toBe(0);
  await t.runtime.close(ctx);
});

test("a pass writes through its own observation tool on the durable runtime", async () => {
  const t = await openTestRuntime({
    root: mkdtempSync(join(tmpdir(), "distill-durable-")),
    responses: [
      fauxAssistantMessage(
        [
          fauxToolCall("observation_update", {
            action: "create",
            relation: "new",
            type: "stuck-point",
            summary: "Stuck on quadratic attention cost",
            body: "Asked why attention is O(n^2).",
            annotationIds: ["ann-1"],
            messageIndices: [1],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("done")),
    ],
  });
  const { store, pass, adapter } = makeStore();
  const result = await runDistillPass(passInput(), {
    store: pass,
    adapter,
    now: () => JULY_17,
    model: MODEL,
    run: (request) => runBackgroundTurnOn({ runtime: t.runtime }, request),
  });
  expect(result).toMatchObject({ ran: true, ok: true, created: 1 });
  const entries = await store.list();
  expect(entries.map((e) => e.summary)).toEqual(["Stuck on quadratic attention cost"]);
  expect(entries[0]!.anchors).toEqual({ annotationIds: ["ann-1"], messageIds: ["thread-1:100"] });
  expect(t.recorded).toBe(2);
  await t.runtime.close(ctx);
});
