// A model turn that stops without an answer, on the info side. The loop has two
// exits (src/ai/agent.ts) and the companion used to wire only one, so a refusal
// — the round cap, or a call that outgrew the window — arrived through onError
// and was drawn as a failed reply. It goes through onRefusal now and lands as a
// notice on the row (src/ui/components/chat/turn-rows.ts). The loop is driven by
// a scripted fake stream: no provider, no network. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  Type,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import { runAgentLoop, REFUSE_ROUNDS, type AgentTool, type StreamFn } from "../../../src/ai/agent";
import { refusalRow } from "../../../src/ui/components/chat/turn-rows";
import type { ThreadMessage } from "../../../src/ui/components/common/types";

const MODEL = {} as Model<Api>;

const echoTool: AgentTool = {
  name: "echo",
  description: "Echo the value back",
  parameters: Type.Object({ value: Type.String() }),
  execute: async (args) => `echo:${args.value as string}`,
};

// A model that only ever asks for the tool again, so the loop runs out of rounds
// — the refusal the companion is most likely to meet.
const alwaysCallsTool: StreamFn = (_model: Model<Api>, _context: Context) => {
  const stream = createAssistantMessageEventStream();
  const message = fauxAssistantMessage([fauxToolCall("echo", { value: "again" })], {
    stopReason: "toolUse",
  });
  const events: AssistantMessageEvent[] = [{ type: "done", reason: "toolUse", message }];
  void (async () => {
    for (const ev of events) {
      await Promise.resolve();
      stream.push(ev);
    }
    stream.end();
  })();
  return stream;
};

// The companion's row, patched the way InfoCall patches it.
async function rowAfterRefusal(start: ThreadMessage): Promise<ThreadMessage> {
  let row = start;
  await runAgentLoop({
    stream: alwaysCallsTool,
    model: MODEL,
    messages: [{ role: "user", content: "go", timestamp: 0 }],
    tools: [echoTool],
    maxRounds: 1,
    onDelta: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onDone: (text) => {
      row = { ...row, text, streaming: false };
    },
    onError: (message) => {
      // What the companion does with a genuine transport failure, and what a
      // refusal must not be dressed as.
      row = { ...row, text: message || "The reply failed.", failed: true, streaming: false };
    },
    onRefusal: (message) => {
      row = { ...row, ...refusalRow(row, message) };
    },
  });
  return row;
}

test("a refusal under a written answer is a quiet notice, not a failure", async () => {
  const row = await rowAfterRefusal({
    role: "ai",
    text: "Here is what I found so far.",
    ts: 1,
    streaming: true,
    tools: [
      { name: "echo", label: "echoing", state: "running" },
      { name: "probe", label: "probing", state: "error" },
    ],
  });

  expect(row.notice).toBe(REFUSE_ROUNDS);
  expect(row.failed).toBeUndefined();
  // The model's own words are left exactly as they were written.
  expect(row.text).toBe("Here is what I found so far.");
  expect(row.streaming).toBe(false);
  // The trace keeps what explains the stop and drops the calls that went fine.
  expect(row.tools?.map((t) => t.name)).toEqual(["probe"]);
});

test("a refusal with nothing written takes the row, and is still not an error", async () => {
  const row = await rowAfterRefusal({ role: "ai", text: "", ts: 1, streaming: true });

  expect(row.text).toBe(REFUSE_ROUNDS);
  // Marked so it renders as the app talking rather than as the model's prose —
  // but never through the error path's wording.
  expect(row.failed).toBe(true);
  expect(row.text).not.toContain("The reply failed.");
  expect(row.notice).toBeUndefined();
});

// The bug was a missing callback, so the guard is that the callback is there:
// nothing else in this file can tell whether the companion wires it.
test("the companion's agent turn wires the refusal exit", () => {
  const source = readFileSync(
    new URL("../../../src/ui/components/info/InfoCall.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("onRefusal:");
});
