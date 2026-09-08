// The talk as a thing on the desk (src/reading/rehearsal/desk.ts, docs/61):
// that it opens into the coach's prompt and the five tools that write an
// outline, and that the assembly puts what is known about the reader in front of
// it — a talk is pitched at an audience, but it is given by this reader.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { assembleTurn } from "../../../src/ai/assemble";
import { openDesk, type DeskEnv } from "../../../src/desk";
import { createThread, rebuildThreadStoreForTests } from "../../../src/platform/app/threads";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import { registerRehearsalDesk, OUTLINE_KIND } from "../../../src/reading/rehearsal/desk";
import { putSegment, setSpine } from "../../../src/reading/talk/edit";
import { talkThreadKey } from "../../../src/reading/talk";
import { newTalkOutline, type TalkOutline } from "../../../src/reading/talk/types";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

function talk(): TalkOutline {
  let outline = newTalkOutline({ id: "o1", topicId: "t1", name: "The eye", now: 1 });
  outline = setSpine(
    outline,
    { thesis: "The eye throws most of it away", audience: "people with no vision course" },
    1,
  );
  return putSegment(outline, { body: "## Opening\n\nask what they see" }, 1, () => "s1");
}

// No topic scope: the coach hears a pass and edits the talk, so the observation
// tools do not ride it.
const env: DeskEnv = {
  settings,
  topic: { id: null, name: "Vision" },
  thread: { key: talkThreadKey("o1"), id: "o1" },
};

function ref(outline: TalkOutline) {
  return {
    outline,
    topicName: "Vision",
    history: [{ role: "user" as const, text: "I have just given this talk out loud — pass 1" }],
    talk: { read: async () => outline, edit: async () => outline },
  };
}

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
  registerRehearsalDesk();
});

test("the talk opens into the coach's prompt and the five tools that write it", async () => {
  const desk = await openDesk([{ kind: OUTLINE_KIND, ref: ref(talk()) }], env);
  expect(desk.items).toHaveLength(1);
  const item = desk.items[0];
  expect(item.label).toBe("The eye");
  expect(item.tools.map((t) => t.name).sort()).toEqual([
    "move_talk_segment",
    "read_talk_outline",
    "remove_talk_segment",
    "set_talk_spine",
    "write_talk_segment",
  ]);
  const prompt = item.prompt({
    dropped: new Set(),
    memory: "",
    toolNames: [],
    toolPrompts: [],
  });
  expect(prompt).toContain('The talk: "The eye" (topic: Vision).');
  expect(item.history!.compose(new Set())).toHaveLength(1);
});

test("what is known about the reader rides the assembled coach turn", async () => {
  disk.files.set(
    "statements.json",
    JSON.stringify({
      version: 1,
      statements: [
        {
          id: "s-1",
          kind: "profile",
          author: "reader",
          text: "Gets lost when a talk opens on definitions",
          created: "2026-09-01",
          updated: "2026-09-01",
          evidence: [],
        },
      ],
    }),
  );
  createThread(talkThreadKey("o1"), "", "o1");
  const desk = await openDesk([{ kind: OUTLINE_KIND, ref: ref(talk()) }], env);
  const turn = await assembleTurn({ desk });
  expect(turn).not.toBeNull();
  expect(turn!.systemPrompt).toContain("Gets lost when a talk opens on definitions");
  // Nothing is retrieved for a talk, so the memory paragraph is the statements
  // and nothing else.
  expect(turn!.systemPrompt).not.toContain("Still open in this book");
});
