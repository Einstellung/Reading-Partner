// Answering a bell in the briefing it was asked about (src/info/briefer/
// deliver.ts, docs/68): the reply lands at the end of that day's info thread,
// not at the door, and a card goes in the box pointing back at it.
// Run: scripts/t.sh tests/info/briefer/deliver.test.ts

import { beforeEach, expect, test } from "bun:test";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { answerBell, doorDate, doorKey, type SendBellTurn } from "../../../src/soul";
import { createBellStore, type BellStore } from "../../../src/legion/bell";
import { createBoxStore, type BoxStore } from "../../../src/box";
import { mapDisk } from "../../support/map-disk";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import {
  appendMessage,
  createThread,
  rebuildThreadStoreForTests,
  threadFileName,
} from "../../../src/platform/app/threads";
import { registerInfoDesk } from "../../../src/info/briefer/desk";
import { registerSecretaryRole } from "../../../src/info/briefer/role";
import { registerBriefingDelivery, registerMealsDelivery } from "../../../src/info/briefer/deliver";
import { registerMealsDesk } from "../../../src/info/meals/desk";
import { EMPTY_MEALS } from "../../../src/info/meals/types";
import type { AgentTool } from "../../../src/legion/execute/turn";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";
import type { Turn } from "../../support/scripted-turn";
import { scriptedBellSender } from "../../support/scripted-runner";

const DATE = "2026-09-16";
const BOOK = `info-${DATE}`;
const THREAD = `briefing-${DATE}`;
const NOW = new Date(2026, 8, 16, 9, 0, 0).getTime();

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

registerInfoDesk();
registerMealsDesk();
registerSecretaryRole();

let disk: FakeDisk;
beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
});

function bellStore(): BellStore {
  return createBellStore(mapDisk());
}

function boxStore(): { box: BoxStore; files: Map<string, string> } {
  const io = mapDisk();
  return { box: createBoxStore(io), files: io.files };
}

// What each round was asked to say, which is the half of the turn this file
// reads.
function sender(turns: Turn[]): { send: SendBellTurn; prompts: string[] } {
  const prompts: string[] = [];
  const send = scriptedBellSender(turns, {
    onContext: (context) => void prompts.push(getCurrentSystemPrompt(context.messages)),
  });
  return { send, prompts };
}

function threadMessages(key: string, id: string): { role: string; text: string }[] | null {
  const text = disk.files.get(threadFileName(key));
  if (!text) return null;
  const parsed = JSON.parse(text) as {
    threads: Record<string, { messages: { role: string; text: string }[] }>;
  };
  return parsed.threads[id]?.messages ?? null;
}

// The opener the info domain registers, over records handed in rather than read
// off disk: what is being tested is the delivery, not the day's collection.
function briefingDelivery(): () => void {
  return registerBriefingDelivery({
    briefing: async () => null,
    context: async () => ({ reader: "Follows trade policy.", sources: [], collecting: true }),
    tools: async () => [],
  });
}

test("a run delegated from the briefing is answered in that day's thread, and leaves a card", async () => {
  const off = briefingDelivery();
  try {
    createThread(BOOK, "info", THREAD);
    appendMessage(BOOK, THREAD, {
      role: "user",
      text: "What was the tariff before this?",
      ts: NOW - 60_000,
    });

    const bells = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-done",
      {
        runId: "r-t1",
        kind: "tasking",
        brief: "It was 8% from March.",
        output: "legion/outputs/r-t1.md",
        deliverTo: JSON.stringify({ place: "briefing", date: DATE }),
      },
      { at: NOW - 1000 },
    );
    const { send, prompts } = sender([{ text: "It was 8%, set in March. The cable is from 商务部." }]);
    // What the run wrote, where the soul reads it back from.
    disk.files.set("legion/outputs/r-t1.md", "8% from March, per 商务部 announcement 2026-03-11.");

    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);

    // The day's own thread holds the question and the answer, in that order; the
    // bell itself was never written down.
    const messages = threadMessages(BOOK, THREAD)!;
    expect(messages.map((m) => m.role)).toEqual(["user", "ai"]);
    expect(messages[messages.length - 1]!.text).toContain("It was 8%");
    // The door was never opened.
    expect(disk.files.get(threadFileName(doorKey(doorDate(new Date(NOW)))))).toBeUndefined();
    // Assembled as the secretary's desk, not as a stranger at the door.
    expect(prompts[0]).toContain("daily briefing");

    const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
    expect(item.boxId).toBe("r-t1");
    expect(item.kind).toBe("tasking");
    expect(item.origin).toEqual({ place: "briefing", date: DATE });
    // The card carries what the run produced, not the path to a file that does
    // not travel with it (src/soul/bell.ts).
    expect(item.body).toBe("8% from March, per 商务部 announcement 2026-03-11.");
    expect(String(item.cover)).toContain("It was 8%");
  } finally {
    off();
  }
});

test("a run that comes back before anything was said that day still has somewhere to land", async () => {
  const off = briefingDelivery();
  try {
    const bells = bellStore();
    const { box } = boxStore();
    await bells.ring(
      "run-done",
      {
        runId: "r-t2",
        kind: "tasking",
        brief: "Nothing filed says.",
        deliverTo: JSON.stringify({ place: "briefing", date: DATE }),
      },
      { at: NOW - 1000 },
    );
    const { send } = sender([{ text: "Nothing on file answers that." }]);

    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);
    expect(threadMessages(BOOK, THREAD)!.map((m) => m.role)).toEqual(["ai"]);
  } finally {
    off();
  }
});

// The meals conversation is one standing thread in a file of its own. A run
// delegated from it comes back there, on the meals desk with the meals tools,
// and not into that day's briefing.
test("a run delegated from the meals conversation is answered in the meals thread, on the meals desk", async () => {
  const mealsTool: AgentTool = {
    name: "propose_meals_plan",
    label: () => "Propose",
    description: "stand-in",
    parameters: { type: "object", properties: {} } as never,
    effect: "read",
    execute: async () => "",
  };
  const off = registerMealsDelivery({
    state: async () => EMPTY_MEALS,
    today: () => DATE,
    tools: async () => [mealsTool],
  });
  try {
    createThread("info-meals", "info", "meals");
    appendMessage("info-meals", "meals", { role: "user", text: "Is tofu cheaper this week?", ts: NOW - 60_000 });

    const bells = bellStore();
    const { box, files } = boxStore();
    await bells.ring(
      "run-done",
      {
        runId: "r-m1",
        kind: "tasking",
        brief: "Tofu is down 10%.",
        deliverTo: JSON.stringify({ place: "meals" }),
      },
      { at: NOW - 1000 },
    );
    const { send: scripted, prompts } = sender([{ text: "Tofu is 10% cheaper this week." }]);
    const tools: string[][] = [];
    const send: SendBellTurn = (turn) => {
      tools.push(turn.tools.map((t) => t.name));
      return scripted(turn);
    };

    expect(await answerBell({ settings, bells, box, send, now: () => NOW })).toBe(1);

    expect(threadMessages("info-meals", "meals")!.map((m) => m.role)).toEqual(["user", "ai"]);
    expect(threadMessages(BOOK, THREAD)).toBeNull();
    expect(disk.files.get(threadFileName(doorKey(doorDate(new Date(NOW)))))).toBeUndefined();
    expect(prompts[0]).toContain("You plan their meals");
    expect(tools[0]).toContain("propose_meals_plan");

    const item = JSON.parse([...files.values()][0]!) as Record<string, unknown>;
    expect(item.origin).toEqual({ place: "meals" });
  } finally {
    off();
  }
});
