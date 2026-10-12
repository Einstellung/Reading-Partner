// A turn at the door killed in the middle of its answer, with a real SIGKILL
// and the app's thread store over a directory (docs/soul/87, "被杀之后";
// docs/pitfall/391, 395): the restarted process lands the half sentence in the
// day's file once, asks nothing again, and — nobody having the conversation
// open — puts the card a reply nobody saw gets.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnLogLine } from "../../src/legion/durable/turn-log-sink";
import { storeThreadFiles } from "../../src/legion/durable/thread-files";
import { openReadingDurable } from "../../src/reading/turn/durable-runtime";
import { doorPlace } from "../../src/soul/door-durable";
import { testHost } from "../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "../reading/turn/support/file-threads";
import { DOOR, DOOR_ANSWER, DOOR_LINE, doorFileMessages, seedDoorFile } from "./support/door-file";

const CHILD = join(import.meta.dir, "door-kill-child.ts");

/** Run the child until it prints ARMED, then SIGKILL it (only this PID). */
async function killWhenArmed(root: string): Promise<void> {
  const child = Bun.spawn(["bun", CHILD, root], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (!out.includes("ARMED")) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`child exited before arming: ${out}`);
      out += decoder.decode(value);
    }
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
}

test("killed mid-text at the door: the half sentence lands in the day's file once, nothing asked again", async () => {
  const root = mkdtempSync(join(tmpdir(), "door-kill-"));
  seedDoorFile(root);
  await killWhenArmed(root);

  const { models, faux } = slowFauxModels(["asked again"], 5000);
  const log: TurnLogLine[] = [];
  const cards: string[] = [];
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(root),
    models,
    threads: storeThreadFiles(fileThreadStore(root)),
    openDesk: async () => [],
    places: {
      door: doorPlace({
        assembled: new Map(),
        openDesk: async () => [],
        watching: () => false,
        card: async (_origin, _ts, text) => {
          cards.push(text);
        },
      }),
    },
    log: (line) => log.push(line),
  });
  expect(durable.recovered.map((r) => r.outcome)).toEqual(["mid-text"]);
  const until = Date.now() + 15_000;
  while ((await durable.runtime.harness.inspect(ctx)).tasks.length > 0) {
    if (Date.now() > until) throw new Error("tasks still live");
    await new Promise((r) => setTimeout(r, 10));
  }

  const messages = doorFileMessages(root);
  expect(messages.map((m) => m.role)).toEqual(["user", "ai"]);
  expect(messages[0]!.ts).toBe(DOOR_LINE.ts);
  const half = messages[1]!.text;
  expect(half.length).toBeGreaterThanOrEqual(200);
  expect(DOOR_ANSWER.startsWith(half)).toBe(true);
  expect(faux.state.callCount).toBe(0);
  expect(cards).toEqual([half]);
  // The killed process wrote the turn's start; this one writes its end, under the door's thread.
  expect(log.map((line) => [line.event, (line as { reason?: string }).reason, (line as { conversation?: string }).conversation])).toEqual([
    ["end", "aborted", DOOR.threadId],
  ]);
  // Under the start line's turn id, so the two pair up.
  const started = readFileSync(join(root, "child-turn-log.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TurnLogLine)
    .filter((line) => line.event === "start");
  expect(started).toHaveLength(1);
  expect(log[0]!.turn).toBe(started[0]!.turn);
  await durable.runtime.close(ctx);
});
