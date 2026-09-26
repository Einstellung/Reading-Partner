// A model turn that stops without an answer, on the info side. The loop has two
// exits (src/ai/agent.ts) and the companion used to wire only one, so a refusal
// — the round cap, or a call that outgrew the window — arrived through onError
// and was drawn as a failed reply. It goes through onRefusal now and lands in
// the row's `notice` (src/ai/turn-view/turn-rows.ts), which keeps it out
// of `text` and so out of the next request. The loop is driven by a scripted
// fake stream: no provider, no network. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createAssistantMessageEventStream,
  Type,
  type Context,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import { runHarnessTurn, REFUSE_ROUNDS, type AgentTool, type StreamFn } from "../../../../src/legion/execute/turn";
import { createSessionFileSystem } from "../../../../src/platform/app/session-fs";
import { memoryAppData } from "../../../support/memory-appdata";
import { turnEvents } from "../../../support/scripted-turn";
import {
  holdsNoAnswer,
  refusalRow,
  replayableHistory,
} from "../../../../src/ai/turn-view/turn-rows";
import type { ThreadMessage } from "../../../../src/ui/components/chat/types";

const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;

const echoTool: AgentTool = {
  name: "echo",
  label: () => "Running the fake tool",
  effect: "read" as const,
  description: "Echo the value back",
  parameters: Type.Object({ value: Type.String() }),
  execute: async (args) => `echo:${args.value as string}`,
};

// A model that only ever asks for the tool again, so the loop runs out of rounds
// — the refusal the companion is most likely to meet.
const alwaysCallsTool: StreamFn = (_model: Model<Api>, _context: Context) => {
  const stream = createAssistantMessageEventStream();
  const events = turnEvents({ calls: [{ name: "echo", args: { value: "again" } }] });
  void (async () => {
    for (const ev of events) {
      await Promise.resolve();
      stream.push(ev);
    }
    stream.end();
  })();
  return stream;
};

// The companion's row, patched the way use-info-call patches it — including blanking
// the row when a tool starts, which is why a refusal never has anything written
// under it.
async function rowAfterRefusal(start: ThreadMessage): Promise<ThreadMessage> {
  let row = start;
  await runHarnessTurn({
    stream: alwaysCallsTool,
    fileSystem: createSessionFileSystem(memoryAppData()),
    model: MODEL,
    messages: [{ role: "user", content: "go", timestamp: 0 }],
    tools: [echoTool],
    maxRounds: 1,
    onDelta: (chunk) => {
      row = { ...row, text: row.text + chunk };
    },
    onToolStart: () => {
      row = { ...row, text: "" };
    },
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

test("a refusal under a written answer is a quiet notice, not a failure", () => {
  const row: ThreadMessage = {
    role: "ai",
    text: "Here is what I found so far.",
    ts: 1,
    streaming: true,
    tools: [
      { name: "echo", label: "echoing", state: "running" },
      { name: "probe", label: "probing", state: "error" },
    ],
  };
  const next = { ...row, ...refusalRow(row, REFUSE_ROUNDS) };

  expect(next.notice).toBe(REFUSE_ROUNDS);
  // Said, not merely left unsaid: refusalRow names the mark and clears it.
  expect(next.failed).toBe(false);
  // The model's own words are left exactly as they were written.
  expect(next.text).toBe("Here is what I found so far.");
  expect(next.streaming).toBe(false);
  // The trace keeps every call: the ones that went fine are what the turn did,
  // and the one that failed is what explains the stop.
  expect(next.tools?.map((t) => t.name)).toEqual(["echo", "probe"]);
});

// The shape the companion actually meets. Both refusal exits fire after at least
// one tool round, and onToolStart blanks the row, so there is never anything
// written underneath: the sentence is the whole row. It still is not a failure.
test("a refusal with nothing written is a notice on an empty row, not an error", async () => {
  const row = await rowAfterRefusal({ role: "ai", text: "", ts: 1, streaming: true });

  expect(row.notice).toBe(REFUSE_ROUNDS);
  expect(row.text).toBe("");
  // Not red, and no Retry anywhere reads it as one.
  expect(row.failed).toBe(false);
  expect(row.notice).not.toContain("The reply failed.");
  expect(row.streaming).toBe(false);
});

// The reason the sentence may not sit in `text`: the companion assembles the
// next request from the rows on screen, so an app sentence parked there comes
// back to the model as something the assistant said.
test("a notice-only row is not replayed to the model as the assistant's words", async () => {
  const stopped = await rowAfterRefusal({ role: "ai", text: "", ts: 2, streaming: true });
  const conversation: ThreadMessage[] = [
    { role: "user", text: "add this feed", ts: 1 },
    stopped,
    { role: "user", text: "try again", ts: 3 },
  ];

  const history = replayableHistory(conversation);

  expect(history).toEqual([
    { role: "user", text: "add this feed" },
    { role: "user", text: "try again" },
  ]);
  expect(history.some((m) => m.text.includes(REFUSE_ROUNDS))).toBe(false);
});

// A genuine transport failure keeps its words in `text` — and is kept out of the
// replay for the same reason: they are the app's, not the assistant's.
test("a failed row is not replayed either", () => {
  const history = replayableHistory([
    { role: "user", text: "add this feed", ts: 1 },
    { role: "ai", text: "The reply failed.", ts: 2, failed: true },
  ]);

  expect(history).toEqual([{ role: "user", text: "add this feed" }]);
});

// A fresh attempt replaces the row that stopped, the way it replaced the failed
// one before: the stop had no answer in it. A card row also has no text of its
// own and is not one of these.
test("a notice-only row is cleared by the next attempt; a card row is not", () => {
  const rows: ThreadMessage[] = [
    { role: "user", text: "add this feed", ts: 1 },
    { role: "ai", text: "", ts: 2, notice: REFUSE_ROUNDS },
    { role: "ai", text: "", ts: 3, parts: [{ type: "card", id: "c1", card: { kind: "probe" } as never }] },
    { role: "ai", text: "The reply failed.", ts: 4, failed: true },
    { role: "ai", text: "half an answ", ts: 5, streaming: true },
    { role: "ai", text: "a finished answer", ts: 6 },
  ];

  expect(rows.filter((m) => !holdsNoAnswer(m)).map((m) => m.ts)).toEqual([1, 3, 6]);
});

// The bug was a missing callback, so the guard is that the callback is there:
// nothing else in this file can tell whether the companion wires it. The
// companion hands its turn the streaming hook's callbacks, and the hook is
// where the refusal exit is.
test("the companion's agent turn wires the refusal exit", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  expect(read("../../../../src/ui/components/info/use-info-call.ts")).toContain("...run.handlers(");
  expect(read("../../../../src/ui/components/chat/useStreamingTurn.ts")).toContain("onRefusal:");
});
