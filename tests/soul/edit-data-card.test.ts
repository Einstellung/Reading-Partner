// A soul turn's edit_data change that waits for the reader puts its card where
// the surface said (AssembleInput.raiseConfirmCard, docs/platform/687 确认),
// over the live write path: the palace row, the registry and the app's files.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { openDesk } from "../../src/desk";
import { appWriteIo, registerWritable, type HousekeeperConfirmCard } from "../../src/housekeeper/write";
import { replaceQuickJsWasm } from "../../src/legion/codemode";
import type { ToolResult } from "../../src/legion/durable/contract";
import { PALACE, type PalaceRow } from "../../src/palace";
import { DEFAULT_SETTINGS } from "../../src/platform/app/settings";
import { rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import { assembleTurn } from "../../src/soul";
import { installAppData, type FakeDisk } from "../support/appdata-fake";
import { testQuickJsWasm } from "../support/quickjs";
import { NOTES_KIND, NOTES_PATH, NOTES_ROW, notesEntry, seedNotes } from "../housekeeper/write-fixture";

const undo: (() => void)[] = [];
let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
  const rows = PALACE as PalaceRow[];
  rows.push(NOTES_ROW);
  undo.push(() => rows.splice(rows.indexOf(NOTES_ROW), 1));
  undo.push(registerWritable(notesEntry(appWriteIo)));
  undo.push(replaceQuickJsWasm(testQuickJsWasm));
  seedNotes({ ...appWriteIo, files: disk.files });
});

afterEach(() => {
  while (undo.length) undo.pop()!();
});

async function editData(raise?: (card: HousekeeperConfirmCard) => void): Promise<ToolResult> {
  const desk = await openDesk([], { settings: DEFAULT_SETTINGS, thread: { key: "door-test", id: "t1" } });
  const turn = await assembleTurn({
    desk,
    origin: { place: "meals" },
    ...(raise ? { raiseConfirmCard: raise } : {}),
  });
  const tool = turn!.tools.find((t) => t.name === "edit_data")!;
  const out = await tool.execute({ kind: NOTES_KIND, code: "data.title = 'Market'; return data;", why: "rename it" });
  return typeof out === "string" ? { text: out } : out;
}

const pendings = () => [...disk.files.keys()].filter((p) => p.startsWith("housekeeper-pending/"));

test("a gated change in a soul turn raises its card on the surface's port and writes nothing", async () => {
  const cards: HousekeeperConfirmCard[] = [];
  const out = await editData((card) => cards.push(card));
  expect(out.text).toContain("A card is waiting for the reader to confirm it");
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ kind: "housekeeper-confirm", dataKind: NOTES_KIND, gate: "replace", lines: ["Title: Market"] });
  expect(pendings()).toEqual([`housekeeper-pending/${cards[0]!.pendingId}.json`]);
  const record = JSON.parse(disk.files.get(pendings()[0]!)!) as { initiator: unknown };
  expect(record.initiator).toEqual({ threadId: "t1", place: "meals" });
  expect(JSON.parse(disk.files.get(NOTES_PATH)!).title).toBe("Groceries");
});

test("a surface with no port refuses the change and keeps no record", async () => {
  const out = await editData();
  expect(out.text).toContain("no card can be shown here");
  expect(pendings()).toEqual([]);
});
