// The running turn's rows projected from a durable conversation view
// (reading/turn/durable-view.ts): the splitting rules of docs/pitfall/291, 360
// and 510, the inbox's queued lines, and a stopped run.

import type { EntryRecord } from "@earendil-works/pi-durable";
import { expect, test } from "bun:test";
import { projectView, type ProjectViewOptions, type ViewSource } from "../../../src/reading/turn/durable-view";

let nextId = 1;
const entry = (kind: string, message: unknown): EntryRecord => ({ id: nextId++, kind, model: [message] }) as unknown as EntryRecord;
const user = (text: string) => entry("pi.user", { role: "user", content: text });
const said = (text: string, calls: string[] = [], stopReason = "stop") =>
  entry("pi.assistant", {
    role: "assistant",
    stopReason,
    content: [
      ...(text ? [{ type: "text", text }] : []),
      ...calls.map((id) => ({ type: "toolCall", id, name: "lookup", arguments: {} })),
    ],
  });
const result = (id: string) => entry("pi.tool-result", { role: "toolResult", toolCallId: id, isError: false, content: [] });
const busy = (half?: string, tools?: unknown[]) => ({
  run: { taskId: 1, inputs: [1] },
  ...(half !== undefined ? { generation: { attempt: 0, message: { role: "assistant", content: [{ type: "text", text: half }] } } } : {}),
  ...(tools ? { tools } : {}),
});
const view = (entries: EntryRecord[], live?: unknown, inbox?: unknown[]): ViewSource => ({
  entries,
  docs: { ...(live ? { "pi.live": live } : {}), ...(inbox ? { "pi.inbox": { items: inbox } } : {}) },
});
const options = (steerTs = new Map<number, number>(), queuedTs = new Map<number, number>()): ProjectViewOptions => ({
  startedAt: 1000,
  steerTs: steerTs as unknown as ProjectViewOptions["steerTs"],
  queuedTs,
  describe: (name) => ({ label: `Using ${name}` }),
});

test("the words written before a tool call stay on the row while the tool runs and after (291)", () => {
  const entries = [user("Q"), said("Let me look.", ["c1"], "toolUse")];
  const running = projectView(view(entries, busy(undefined, [{ callId: "c1", name: "lookup", status: "running" }])), options());
  expect(running.phase).toBe("tool");
  expect(running.rows).toEqual([
    {
      role: "ai",
      ts: 1001,
      text: "Let me look.",
      tools: [{ callId: "c1", name: "lookup", label: "Using lookup", state: "running" }],
      streaming: true,
    },
  ]);
  const answered = projectView(view([...entries, result("c1")], busy("Found it.")), options());
  expect(answered.phase).toBe("writing");
  expect(answered.rows).toHaveLength(1);
  expect(answered.rows[0]).toMatchObject({ ts: 1001, text: "Let me look.\n\nFound it.", streaming: true });
  expect((answered.rows[0] as { tools: { state: string }[] }).tools.map((t) => t.state)).toEqual(["done"]);
});

test("a steer after a tool-only round closes that row and the answer opens after the steer (510)", () => {
  const steer = user("Only page one");
  const entries = [user("Q"), said("", ["c1"], "toolUse"), result("c1"), steer];
  const out = projectView(view(entries, busy("Page one.")), options(new Map([[steer.id as number, 5000]])));
  expect(out.rows.map((r) => [r.role, r.ts, r.text])).toEqual([
    ["ai", 1001, ""],
    ["user", 5000, "Only page one"],
    ["ai", 5001, "Page one."],
  ]);
  expect(out.rows[0]).toMatchObject({ streaming: false });
  expect((out.rows[0] as { tools: unknown[] }).tools).toHaveLength(1);
  expect(out.rows[2]).toMatchObject({ streaming: true });
});

test("a steer handed over before a word was written leaves no empty row above it (360)", () => {
  const steer = user("Actually, chapter two");
  const out = projectView(view([user("Q"), steer], busy()), options(new Map([[steer.id as number, 5000]])));
  expect(out.phase).toBe("thinking");
  expect(out.rows.map((r) => [r.role, r.ts, r.text])).toEqual([
    ["user", 5000, "Actually, chapter two"],
    ["ai", 5001, ""],
  ]);
});

test("a steer still in the inbox is a queued line under the row being written", () => {
  const out = projectView(
    view([user("Q")], busy("Half"), [{ id: 9, mode: "steer", content: "Shorter" }]),
    options(new Map(), new Map([[9, 7000]])),
  );
  expect(out.rows).toEqual([
    { role: "ai", ts: 1001, text: "Half", tools: [], streaming: true },
    { role: "user", ts: 7000, text: "Shorter", queued: true },
  ]);
});

test("a stopped run keeps its half sentence and nothing streams", () => {
  const out = projectView(view([user("Q"), said("Half a sen", [], "aborted")]), options());
  expect(out.busy).toBe(false);
  expect(out.phase).toBeNull();
  expect(out.rows).toEqual([{ role: "ai", ts: 1001, text: "Half a sen", tools: [], streaming: false }]);
});
