// The turn log's file (src/legion/execute/turn-log.ts): lines from turns that
// write at the same moment all land, and an export reads them back.
// Run: scripts/t.sh tests/legion/execute/turn-log.test.ts

import { beforeEach, expect, test } from "bun:test";
import { appTurnLog, readTurnLog, TURN_LOG } from "../../../src/legion/execute/turn-log";
import { PALACE } from "../../../src/palace";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;
beforeEach(() => {
  disk = installAppData();
});

test("an export of a device no turn has run on is empty", async () => {
  expect(await readTurnLog()).toBe("");
});

test("lines written at the same moment by two turns all land, one JSON object each", async () => {
  appTurnLog({ at: 1, turn: "t1", event: "start", provider: "p", model: "m", held: true, conversation: "a" });
  appTurnLog({ at: 1, turn: "t2", event: "start", provider: "p", model: "m", held: true, conversation: "b" });
  appTurnLog({ at: 2, turn: "t1", event: "end", reason: "timed-out", ms: 1 });
  await Bun.sleep(10);
  const lines = (await readTurnLog()).trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.map((l) => `${l.turn}:${l.event}`)).toEqual(["t1:start", "t2:start", "t1:end"]);
  expect(disk.files.has(TURN_LOG)).toBe(true);
});

test("the file is a local log whose tail the housekeeper keeps", () => {
  const row = PALACE.find((k) => k.kind === "turn-log")!;
  expect(row.sync).toBe("local");
  expect(row.retention).toEqual({ rule: "tail", lines: 5000 });
  expect(row.match(TURN_LOG)).not.toBeNull();
});
