// A turn at the door with a brief open (docs/info/88 「简报的对话」): the
// conversation replayed is the door's, the material on the desk is the brief,
// and where the reader is rides the line sent to the model, not the thread.

import { beforeEach, expect, test } from "bun:test";
import { registerDeskItemKind, type DeskItemKind } from "../../src/desk";
import { FULLTEXT_VERSION, type Fulltext } from "../../src/fulltext/types";
import { DEFAULT_SETTINGS, type Settings } from "../../src/platform/app/settings";
import { appendMessage, getBookThread, rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import type { Annotation } from "../../src/platform/app/reader-contract";
import { issueDeskKind } from "../../src/reading/issue-desk";
import { doorKey, openDoorThread, openDoorTurn, prepareDoorTurn } from "../../src/soul";
import { doorAssemblies } from "../../src/soul/door-durable";
import { quotedQuestion } from "../../src/ui/components/chat/quoted-question";
import { issueDoorTurn, noteOnLastLine, type OpenIssue } from "../../src/ui/components/companion/issue-context";
import { installAppData } from "../support/appdata-fake";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  defaultProviderId: "anthropic",
  defaultModelId: "claude-sonnet-4-5",
};

const brief: Fulltext = {
  version: FULLTEXT_VERSION,
  status: "ok",
  pages: [
    "Oct 15 brief",
    "Contents. AI for science / proofs: a model writes proofs.",
    "Notes",
    "A lab says its model writes proofs a referee accepts.",
  ],
  outline: [],
};

const original: Fulltext = { ...brief, pages: ["The paper itself."] };

const issueKind = issueDeskKind({
  listSupplements: async () => [{ hash: "orig-1", title: "Proofs by machine" }],
  fulltext: async (hash) => (hash === "orig-1" ? original : null),
});

const openIssue: OpenIssue = {
  bookId: "issue-1",
  title: "Oct 15 brief",
  where: () => ({ page: 2, pageCount: 4 }),
  fulltext: async () => brief,
  marks: () => [{ id: "m1", type: "highlight", text: "a model writes proofs", position: { pageIndex: 1 } } as Annotation],
  jump: () => {},
};

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
});

test("the door's conversation is replayed, the brief is the material, the note is on the line only", async () => {
  const off = registerDeskItemKind(issueKind);
  try {
    const date = "2026-10-15";
    const key = doorKey(date);
    const thread = await openDoorThread(date, () => "door-1");
    const asked = quotedQuestion("writes proofs a referee accepts", "Is that new?");
    appendMessage(key, thread.id, { role: "user", text: "Morning", ts: 1 });
    appendMessage(key, thread.id, { role: "ai", text: "Morning. The brief is in.", ts: 2 });
    appendMessage(key, thread.id, { role: "user", text: asked, ts: 3 });
    const said = getBookThread(key)!.messages.map(({ role, text }) => ({ role, text }));

    const { desk, note } = await issueDoorTurn(openIssue, asked);
    expect(desk).toEqual([{ kind: "issue", ref: { bookId: "issue-1", title: "Oct 15 brief", fulltext: brief } }]);
    expect(note).toContain("on page 2 of 4");
    expect(note).toContain('p.2 "a model writes proofs"');
    expect(note).toContain("quoted at the top of this message is on page 4");

    const prepared = await prepareDoorTurn(
      { threadId: thread.id, date, history: noteOnLastLine(said, note), desk, signal: new AbortController().signal },
      { loadSettings: async () => settings, openTurn: openDoorTurn },
    );
    if (prepared.kind !== "turn") throw new Error(`expected a turn, got ${prepared.kind}`);

    // History: the door's own rows before the line, nothing of the brief's.
    expect(doorAssemblies.get(prepared.key)!.history).toEqual(said.slice(0, -1));
    // The line the model reads carries the note.
    expect(prepared.line).toBe(asked + note);
    // Material: the brief's text, page anchored, and the tools to read it and its originals.
    expect(prepared.systemPrompt).toContain('a brief open beside this conversation: "Oct 15 brief"');
    expect(prepared.systemPrompt).toContain("=== Page 4 === [p.4]\nA lab says its model writes proofs");
    expect(prepared.systemPrompt).toContain("- Proofs by machine");
    const names = prepared.tools.map((t) => t.name);
    expect(names).toContain("read_pages");
    expect(names).toContain("read_supplement");
    // The thread keeps the line as it was said.
    expect(getBookThread(key)!.messages.map((m) => m.text)).toEqual(["Morning", "Morning. The brief is in.", asked]);
  } finally {
    off();
  }
});

test("with no brief open nothing is laid on the desk and nothing is noted", async () => {
  expect(await issueDoorTurn(null, "hello")).toEqual({ desk: [], note: "" });
  const turn = await openDoorTurn({ settings, threadId: "d1", date: "2026-10-15" });
  expect(turn!.tools.map((t) => t.name)).not.toContain("read_pages");
});

test("an item that brings a conversation of its own is refused at the door", async () => {
  const talker: DeskItemKind = {
    kind: "talker",
    open: async () => ({
      kind: "talker",
      label: "",
      tools: [],
      toolPrompts: [],
      rungs: [],
      prompt: () => "",
      history: { compose: () => [{ role: "user", text: "not the door's" }] },
    }),
  };
  const off = registerDeskItemKind(talker);
  try {
    await expect(
      openDoorTurn({ settings, threadId: "d1", date: "2026-10-15", desk: [{ kind: "talker", ref: {} }] }),
    ).rejects.toThrow("carries a conversation of its own");
  } finally {
    off();
  }
});
