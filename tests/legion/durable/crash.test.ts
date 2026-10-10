// A child process starts a turn and is SIGKILLed at a chosen point; this
// process reopens the same database and conversation file, recovers before
// resume() and checks what landed (docs/soul/87, "被杀之后", "落盘").

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverBeforeResume } from "../../../src/legion/durable/recover";
import { openTestRuntime, type TestRuntime } from "./support/runtime";

const CHILD = join(import.meta.dir, "crash-child.ts");
const CRASH_ANSWER = "潮汐是月球和太阳引力共同作用的结果，".repeat(40);

/** Run the child until it prints ARMED, SIGKILL it (only this PID), return what followed ARMED. */
async function killWhenArmed(mode: string, root: string): Promise<string> {
  const child = Bun.spawn(["bun", CHILD, mode, root], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (!out.includes("ARMED")) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`child exited before arming: ${out}`);
      out += decoder.decode(value);
    }
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
  return out.slice(out.indexOf("ARMED") + 6).split("\n")[0]!.trim();
}

async function settle(t: TestRuntime): Promise<void> {
  const until = Date.now() + 15_000;
  while ((await t.runtime.harness.inspect(ctx)).tasks.length > 0) {
    if (Date.now() > until) throw new Error("tasks still live");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const assistants = (t: TestRuntime) =>
  t.file.rows().filter((r) => r.role === "assistant") as { text: string; tools: { name: string; isError: boolean }[] }[];

test("killed mid-text: the half sentence lands once and nothing is asked again", async () => {
  const root = mkdtempSync(join(tmpdir(), "durable-crash-"));
  const armedAt = Number(await killWhenArmed("mid-text", root));
  const t = await openTestRuntime({ root, responses: [fauxAssistantMessage(fauxText("asked again"))] });
  expect((await recoverBeforeResume(t.runtime, ctx)).map((r) => r.outcome)).toEqual(["mid-text"]);
  await settle(t);
  expect(t.requests).toHaveLength(0);
  const said = assistants(t);
  expect(said).toHaveLength(1);
  expect(said[0]!.text.length).toBeGreaterThanOrEqual(armedAt);
  expect(CRASH_ANSWER.startsWith(said[0]!.text)).toBe(true);
  await t.runtime.close(ctx);
}, 30_000);

test("killed inside an unsafe tool: the model gets interrupted and the turn finishes", async () => {
  const root = mkdtempSync(join(tmpdir(), "durable-crash-"));
  await killWhenArmed("unsafe-tool", root);
  let notes = 0;
  const t = await openTestRuntime({
    root,
    responses: [fauxAssistantMessage(fauxText("The note may not have been written."))],
    desk: { note: async () => (notes++, "noted") },
  });
  expect((await recoverBeforeResume(t.runtime, ctx)).map((r) => r.outcome)).toEqual(["in-tool"]);
  await settle(t);
  expect(notes).toBe(0);
  expect(t.requests[0]![t.requests[0]!.length - 1]).toContain("interrupted");
  const said = assistants(t);
  expect(said).toHaveLength(1);
  expect(said[0]!.text).toBe("The note may not have been written.");
  expect(said[0]!.tools.map((x) => [x.name, x.isError])).toEqual([["note", true]]);
  await t.runtime.close(ctx);
}, 30_000);

test("killed inside a replay-safe tool: the tool runs again and the turn finishes", async () => {
  const root = mkdtempSync(join(tmpdir(), "durable-crash-"));
  await killWhenArmed("safe-tool", root);
  let lookups = 0;
  const t = await openTestRuntime({
    root,
    responses: [fauxAssistantMessage(fauxText("Found it."))],
    desk: { lookup: async (q) => (lookups++, `text of ${q}`) },
  });
  expect((await recoverBeforeResume(t.runtime, ctx)).map((r) => r.outcome)).toEqual(["in-tool"]);
  await settle(t);
  expect(lookups).toBe(1);
  const said = assistants(t);
  expect(said.map((r) => r.text)).toEqual(["Found it."]);
  expect(said[0]!.tools.map((x) => [x.name, x.isError])).toEqual([["lookup", false]]);
  await t.runtime.close(ctx);
}, 30_000);

test("killed between writing the file and the landed memo: the rerun writes nothing twice", async () => {
  const root = mkdtempSync(join(tmpdir(), "durable-crash-"));
  await killWhenArmed("land", root);
  const t = await openTestRuntime({ root, responses: [] });
  expect(t.file.rows().map((r) => r.text)).toEqual(["Explain the tides.", "Short answer."]);
  expect(await recoverBeforeResume(t.runtime, ctx)).toEqual([]);
  await settle(t);
  expect(t.file.rows().map((r) => r.text)).toEqual(["Explain the tides.", "Short answer."]);
  await t.runtime.close(ctx);
}, 30_000);
