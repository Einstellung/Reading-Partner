// What the confirmation card says after the reader answers it
// (ui/components/chat/housekeeper-confirm.ts, docs/platform/687 确认), over real
// pending records: confirmed lands, declined deletes, a record that is gone or
// data that moved voids the card.

import { expect, test } from "bun:test";
import {
  buildEditTools,
  confirmPending,
  declinePending,
  pendingPath,
  pendingWaits,
  type HousekeeperConfirmCard,
} from "../../../../src/housekeeper/write";
import { stateAfterConfirm } from "../../../../src/ui/components/chat/housekeeper-confirm";
import { testQuickJsWasm } from "../../../support/quickjs";
import { NOTES_KIND, NOTES_PATH, memIo, notesDeps, notesEntry, readNotes, seedNotes } from "../../../housekeeper/write-fixture";

async function waiting() {
  const io = memIo();
  seedNotes(io);
  const clock = { now: 1_000 };
  const deps = notesDeps(io, notesEntry(io), clock);
  const cards: HousekeeperConfirmCard[] = [];
  const [edit] = buildEditTools([], { initiator: { threadId: "t1" }, raiseCard: (c) => cards.push(c) }, {
    wasm: testQuickJsWasm,
    runner: "inline",
    write: deps,
  });
  await edit!.execute({ kind: NOTES_KIND, code: "data.title = 'Market'; return data;", why: "rename" });
  const pendingId = cards[0]!.pendingId;
  expect(await pendingWaits(pendingId, deps)).toBe(true);
  return { io, deps, pendingId };
}

test("confirming lands the write and the card says applied", async () => {
  const s = await waiting();
  expect(stateAfterConfirm(await confirmPending(s.pendingId, s.deps))).toEqual({ phase: "applied" });
  expect(readNotes(s.io).title).toBe("Market");
  expect(s.io.files.has(pendingPath(s.pendingId))).toBe(false);
});

test("declining deletes the record, and a later confirm finds it gone", async () => {
  const s = await waiting();
  await declinePending(s.pendingId, s.deps);
  expect(await pendingWaits(s.pendingId, s.deps)).toBe(false);
  expect(stateAfterConfirm(await confirmPending(s.pendingId, s.deps))).toEqual({ phase: "gone" });
  expect(readNotes(s.io).title).toBe("Groceries");
});

test("a record reclaimed by age voids the card", async () => {
  const s = await waiting();
  s.io.files.delete(pendingPath(s.pendingId));
  expect(stateAfterConfirm(await confirmPending(s.pendingId, s.deps))).toEqual({ phase: "gone" });
});

test("data changed since the card was raised voids it and writes nothing", async () => {
  const s = await waiting();
  const moved = { ...readNotes(s.io), title: "Elsewhere" };
  s.io.files.set(NOTES_PATH, JSON.stringify(moved));
  expect(stateAfterConfirm(await confirmPending(s.pendingId, s.deps))).toEqual({ phase: "stale" });
  expect(readNotes(s.io).title).toBe("Elsewhere");
  expect(s.io.files.has(pendingPath(s.pendingId))).toBe(false);
});

test("a failure carries its reason, and any other outcome is a failure named by its status", () => {
  expect(stateAfterConfirm({ status: "failed", reason: "disk full" })).toEqual({ phase: "failed", reason: "disk full" });
  expect(stateAfterConfirm({ status: "rejected", problems: [], printed: "" } as never)).toEqual({
    phase: "failed",
    reason: "rejected",
  });
});
