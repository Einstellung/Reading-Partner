// Answering a bell in the briefing it was asked about (src/info/briefer/
// deliver.ts, docs/68): the reply lands at the end of that day's info thread,
// not at the door, and a card goes in the box pointing back at it.
// Run: scripts/t.sh tests/info/briefer/deliver.test.ts

import { beforeEach, expect, test } from "bun:test";
import {
  createAssistantMessageEventStream,
  type Api,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { answerBell, doorDate, doorKey, type SendBellTurn } from "../../../src/soul";
import { createBellStore, type BellStore } from "../../../src/legion/bell";
import { createBoxStore, type BoxStore } from "../../../src/box";
import { mapDisk } from "../../support/map-disk";
import { holdHarness } from "../../../src/legion/execute/held";
import { runHarnessTurn, type StreamFn } from "../../../src/legion/execute/turn";
import { toPiMessages } from "../../../src/ai/providers";
import { createSessionFileSystem } from "../../../src/platform/app/session-fs";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import {
  appendMessage,
  createThread,
  rebuildThreadStoreForTests,
  threadFileName,
} from "../../../src/platform/app/threads";
import { registerInfoDesk } from "../../../src/info/briefer/desk";
import { registerSecretaryRole } from "../../../src/info/briefer/role";
import { registerBriefingDelivery } from "../../../src/info/briefer/deliver";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";
import { memoryAppData } from "../../support/memory-appdata";
import { turnEvents, type Turn } from "../../support/scripted-turn";

const DATE = "2026-09-16";
const BOOK = `info-${DATE}`;
const THREAD = `briefing-${DATE}`;
const NOW = new Date(2026, 8, 16, 9, 0, 0).getTime();

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

const MODEL = { id: "m", provider: "faux" } as unknown as Model<Api>;

registerInfoDesk();
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

// The real turn machinery with the provider scripted: what is under test is the
// desk the bell is answered over and where the reply goes.
function sender(turns: Turn[]): { send: SendBellTurn; prompts: string[] } {
  const prompts: string[] = [];
  let round = 0;
  const stream: StreamFn = (_model, context: Context) => {
    const i = round++;
    prompts.push(String(context.systemPrompt ?? ""));
    const out = createAssistantMessageEventStream();
    const events = turnEvents(turns[i] ?? { error: "no scripted turn" });
    (async () => {
      for (const ev of events) {
        await Promise.resolve();
        out.push(ev);
      }
      out.end();
    })();
    return out;
  };
  const held = holdHarness({
    lane: { name: "soul", sessions: "soul" },
    fileSystem: createSessionFileSystem(memoryAppData()),
  });
  const send: SendBellTurn = (turn) =>
    new Promise<string>((resolve, reject) => {
      void runHarnessTurn({
        stream,
        model: MODEL,
        systemPrompt: turn.systemPrompt,
        messages: toPiMessages(turn.messages),
        tools: turn.tools,
        maxRounds: 4,
        held,
        onDelta: () => {},
        onToolStart: () => {},
        onToolEnd: () => {},
        onDone: (text) => resolve(text),
        onError: (message) => reject(new Error(message)),
      });
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
    expect(item.body).toBe("legion/outputs/r-t1.md");
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
