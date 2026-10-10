// projectRun: a run's entries as conversation-file rows (docs/soul/87, "落盘").

import type { EntryId, EntryRecord } from "@earendil-works/pi-durable";
import { expect, test } from "bun:test";
import { projectRun } from "../../../src/legion/durable/turn";

let next = 0;
const entry = (kind: string, message?: object): EntryRecord =>
  ({ id: ++next as EntryId, conversationId: 1, kind, ...(message ? { model: [message] } : {}) }) as EntryRecord;
const said = (text: string, stopReason = "stop") => entry("pi.assistant", { role: "assistant", content: [{ type: "text", text }], stopReason });

test("a killed half sentence that was asked again is not joined to the second answer", () => {
  const user = entry("pi.user", { role: "user", content: "Q" });
  const rows = projectRun([user, said("潮汐是月", "aborted"), said("潮汐是月球和太阳引力共同作用的结果。")], user.id, {
    startedAt: 100,
    steerTs: new Map(),
  });
  expect(rows).toEqual([{ role: "assistant", ts: 101, text: "潮汐是月球和太阳引力共同作用的结果。", tools: [] }]);
});

test("the run's own aborted last answer is kept, and rp.partial is then not added", () => {
  const user = entry("pi.user", { role: "user", content: "Q" });
  const rows = projectRun([user, said("Half", "aborted")], user.id, { startedAt: 100, steerTs: new Map(), partial: "Half" });
  expect(rows.map((r) => r.text)).toEqual(["Half"]);
});

test("rp.partial stands in when the run has no aborted entry", () => {
  const user = entry("pi.user", { role: "user", content: "Q" });
  const call = entry("pi.assistant", {
    role: "assistant",
    content: [{ type: "text", text: "Let me look." }, { type: "toolCall", id: "c1", name: "lookup", arguments: { q: 1 } }],
    stopReason: "toolUse",
  });
  const result = entry("pi.tool-result", { role: "toolResult", toolCallId: "c1", content: [], isError: false });
  const rows = projectRun([user, call, result], user.id, { startedAt: 100, steerTs: new Map(), partial: "It says" });
  expect(rows).toEqual([
    { role: "assistant", ts: 101, text: "Let me look.\n\nIt says", tools: [{ callId: "c1", name: "lookup", args: { q: 1 }, isError: false }] },
  ]);
});
