// The retell pass as the live wiring runs it (src/memory/live/live.ts): the
// line it logs names the trigger that started it, like the transcript and marks
// passes do. The sweep reaches a retell through the same source table as every
// other conversation, so a retell line that always said "talk-exit" would hide
// every sweep-driven pass behind the exit that did not happen. Run: bun test.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as modelCall from "../../src/ai/model-call";
import * as subagent from "../../src/legion/subagent";
import * as events from "../../src/platform/app/events";
import * as topics from "../../src/platform/app/topics";
import type { Topic } from "../../src/platform/app/topics";
import { registerDistillSource } from "../../src/memory/distill/sources";
import { sweepDistillation } from "../../src/memory/live/live";
import type { EventPayload, EventType } from "../../src/platform/app/events";
import { installAppData } from "../support/appdata-fake";
import { scriptedSubagentRunner } from "../support/scripted-runner";

const TOPIC = "t";

let logged: { type: EventType; payload: EventPayload }[];
let undoSource: () => void = () => {};

beforeEach(() => {
  installAppData();
  logged = [];
  spyOn(events, "logEvent").mockImplementation((_topicId, type, payload = {}) => {
    logged.push({ type, payload });
  });
  spyOn(topics, "listTopics").mockResolvedValue([{ id: TOPIC, name: "minds" } as Topic]);
  spyOn(modelCall, "resolveModel").mockResolvedValue({
    providerId: "anthropic",
    modelId: "m",
    reasoning: undefined,
    aiLanguage: "en",
  } as modelCall.ResolvedModel);
  spyOn(subagent, "runSubagentTurnLive").mockImplementation(
    scriptedSubagentRunner([{ text: "done" }]).run,
  );
  undoSource = registerDistillSource({
    kind: "retell-thread",
    listUnits: async () => [
      {
        cursor: "distilledMessages",
        id: "retell-thread-1",
        topicId: TOPIC,
        label: "A Brief History of Intelligence",
        messages: [
          { role: "ai", text: "Chapter 22. What is the argument resting on?", ts: 100 },
          { role: "user", text: "he gets there from the lesion studies", ts: 200 },
        ],
        retell: {
          retellId: "r1",
          retellName: "A Brief History of Intelligence",
          materials: ["A Brief History of Intelligence"],
        },
      },
    ],
    cursor: "distilledMessages",
    afterEnd: "keep",
  });
});

afterEach(() => {
  undoSource();
});

test("a retell pass the sweep ran is logged under the sweep's trigger", async () => {
  await sweepDistillation("timer");

  const runs = logged.filter((e) => e.type === "distill-run");
  expect(runs).toHaveLength(1);
  expect(runs[0].payload).toMatchObject({
    threadId: "retell-thread-1",
    retellId: "r1",
    trigger: "timer",
    created: 0,
    updated: 0,
    deleted: 0,
    // The same write breakdown every other pass logs.
    relNew: 0,
    refusedBadIndex: 0,
  });
});
