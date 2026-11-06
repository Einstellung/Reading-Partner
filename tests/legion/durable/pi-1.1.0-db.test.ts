// A device database written by pi-durable 1.1.0, opened by this build. The
// fixture is one settled reader turn with a lookup round (fixtures/pi-1.1.0,
// written by the app at pi 1.1.0 and VACUUMed to one file). pi-durable 1.4
// migrates the file to schema 2 on open, which 1.3 and earlier cannot read
// back: there is no downgrade.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTurn } from "../../../src/legion/durable/turn";
import { KEY, ORIGIN, openTestRuntime, readerTurn } from "./support/runtime";
import { viewState } from "./support/view-state";

const FIXTURE = join(import.meta.dir, "fixtures", "pi-1.1.0");
const DB = "turns-1793951660339.sqlite";

function schemaVersion(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("SELECT version FROM durable_schema").get() as { version: number }).version;
  } finally {
    db.close();
  }
}

test("a 1.1.0 database migrates on open, keeps its conversation and runs the next turn to the end", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-1.1.0-db-"));
  mkdirSync(join(root, "durable"));
  copyFileSync(join(FIXTURE, DB), join(root, "durable", DB));
  copyFileSync(join(FIXTURE, "thread.jsonl"), join(root, "thread.jsonl"));
  expect(schemaVersion(join(root, "durable", DB))).toBe(1);

  const t = await openTestRuntime({ root, responses: [fauxAssistantMessage(fauxText("Twice a day."))] });
  // The same generation, not a fresh one: the thread key still finds conversation 2.
  const conversation = await t.runtime.conversationFor(KEY, ORIGIN, ctx);
  expect(String(conversation.id)).toBe("2");
  // Its 1.1.0 entries read back through the migrated tables.
  expect((await viewState(conversation, ctx)).value.entries.length).toBeGreaterThan(0);

  const turn = await startTurn(t.runtime, readerTurn(t, "And how often?", 2000), ctx);
  expect(await turn.settled).toEqual({ status: "done", landed: true });
  expect(t.requests).toHaveLength(1);
  expect(t.requests[0]).toEqual(
    expect.arrayContaining(["user:Explain the tides.", "assistant:The tides follow the moon.", "user:And how often?"]),
  );
  const lines = readFileSync(join(root, "thread.jsonl"), "utf8").trim().split("\n");
  expect(lines.map((line) => (JSON.parse(line) as { text: string }).text)).toEqual([
    "Explain the tides.",
    "The tides follow the moon.",
    "And how often?",
    "Twice a day.",
  ]);

  await t.runtime.harness.close(ctx);
  expect(schemaVersion(join(root, "durable", DB))).toBe(2);
});
