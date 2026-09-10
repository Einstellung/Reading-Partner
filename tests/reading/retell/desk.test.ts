// The retell as a thing on the desk (src/reading/retell/desk.ts, docs/61): that
// what it opens into is the prompt and the tools the retell has always had, and
// that the assembly now puts what is known about the reader in front of it.
//
// The retell reads the standing statements here for the first time: how this
// reader wants things explained is as true of a retell as it is of a lesson, and
// before the desk existed nothing carried it into this conversation.
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { assembleTurn } from "../../../src/soul";
import { openDesk, type DeskEnv } from "../../../src/desk";
import type { Fulltext } from "../../../src/fulltext/types";
import { createThread, rebuildThreadStoreForTests } from "../../../src/platform/app/threads";
import { DEFAULT_SETTINGS, type Settings } from "../../../src/platform/app/settings";
import { registerRetellDesk, RETELL_KIND } from "../../../src/reading/retell/desk";
import { retellThreadKey } from "../../../src/reading/retell/store";
import type { LoadedMaterial } from "../../../src/reading/retell/material";
import type { Retell } from "../../../src/reading/retell/types";
import { newTalkOutline } from "../../../src/reading/talk/types";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

function fulltext(): Fulltext {
  return {
    version: 1,
    status: "ok",
    pages: ["Page one.", "Page two.", "Page three.", "Page four."],
    outline: [
      { title: "One", page: 1, level: 0 },
      { title: "Two", page: 3, level: 0 },
    ],
  };
}

function material(): LoadedMaterial {
  return {
    bookId: "b1",
    title: "Eye and Brain",
    fulltext: fulltext(),
    annotations: [],
    skeleton: {
      source: "outline",
      chapters: [
        { index: 1, title: "One", startPage: 1, endPage: 2, hasNote: false },
        { index: 2, title: "Two", startPage: 3, endPage: 4, hasNote: false },
      ],
    },
    figures: [],
    prep: null,
    prepNotes: [],
  };
}

const retell: Retell = {
  version: 1,
  id: "t1",
  name: "A retell",
  topicId: "topic-1",
  materials: [{ bookId: "b1", title: "Eye and Brain" }],
  createdAt: 1,
  updatedAt: 1,
  decisions: [],
};

const env: DeskEnv = {
  settings,
  topic: { id: "topic-1", name: "Vision" },
  thread: { key: retellThreadKey(retell.id), id: retell.id },
};

function ref() {
  const outline = newTalkOutline({ id: "o1", topicId: "topic-1", retellId: "t1", now: 1 });
  return {
    retell,
    materials: [material()],
    topicName: "Vision",
    history: [{ role: "user" as const, text: "carry on" }],
    record: async () => {},
    talk: { read: async () => outline, edit: async () => outline },
  };
}

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
  registerRetellDesk();
});

test("the retell opens into its own prompt and its own tools", async () => {
  const desk = await openDesk([{ kind: RETELL_KIND, ref: ref() }], env);
  expect(desk.items).toHaveLength(1);
  const item = desk.items[0];
  expect(item.label).toBe("Eye and Brain");
  // The reading tools over the retell's materials, the ones that record a
  // decision, and the five that write the talk (docs/44).
  const names = item.tools.map((t) => t.name);
  expect(names).toContain("search_topic");
  expect(names).toContain("record_chapter_decision");
  expect(names).toContain("write_talk_segment");
  // The tools that write memory are the soul's and are not the item's.
  expect(names).not.toContain("observation_update");
  expect(names).not.toContain("statement_write");
  // The kickoff still opens the replay, and the item carries the history.
  expect(item.history!.compose(new Set())[0].text).toContain("retell");
});

test("what is known about the reader rides the assembled retell turn", async () => {
  disk.files.set(
    "statements.json",
    JSON.stringify({
      version: 1,
      statements: [
        {
          id: "s-1",
          kind: "profile",
          author: "reader",
          text: "Wants the derivation in full and no diagrams",
          created: "2026-09-01",
          updated: "2026-09-01",
          evidence: [],
        },
      ],
    }),
  );
  // A reader message on the retell's own thread, so the soul has something to
  // hang a new statement's evidence on.
  createThread(retellThreadKey(retell.id), "", retell.id);
  const desk = await openDesk([{ kind: RETELL_KIND, ref: ref() }], env);
  const turn = await assembleTurn({ desk });
  expect(turn).not.toBeNull();
  expect(turn!.systemPrompt).toContain("Wants the derivation in full and no diagrams");
  // The statements come last, after the retell's own material.
  const marks = turn!.systemPrompt.indexOf("You are sitting in on a retell");
  expect(marks).toBeGreaterThanOrEqual(0);
  expect(turn!.systemPrompt.indexOf("Wants the derivation")).toBeGreaterThan(marks);
});
