// A book turn killed in the middle of its answer, with a real SIGKILL and the
// app's thread store over a directory: the restarted process starts with the
// book unloaded, as the app does when recovery runs before any surface opened
// it (docs/pitfall/523).

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnLogLine } from "../../../src/legion/execute/turn-log";
import { storeBookThreads } from "../../../src/reading/turn/durable-book";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, KILL_ANSWER, KILL_BOOK, KILL_LINE, seedThreadFile, slowFauxModels, threadFileMessages } from "./support/file-threads";

const CHILD = join(import.meta.dir, "durable-kill-child.ts");

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

test("killed mid-text: the half sentence lands in the book's thread file once, nothing asked again", async () => {
  const root = mkdtempSync(join(tmpdir(), "durable-kill-"));
  seedThreadFile(root);
  await killWhenArmed(root);

  const { models, faux } = slowFauxModels(["asked again"], 5000);
  const log: TurnLogLine[] = [];
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(root),
    models,
    threads: storeBookThreads(fileThreadStore(root)),
    card: async () => {},
    openDesk: async () => [],
    log: (line) => log.push(line),
  });
  expect(durable.recovered.map((r) => r.outcome)).toEqual(["mid-text"]);
  const until = Date.now() + 15_000;
  while ((await durable.runtime.harness.inspect(ctx)).tasks.length > 0) {
    if (Date.now() > until) throw new Error("tasks still live");
    await new Promise((r) => setTimeout(r, 10));
  }

  const messages = threadFileMessages(root);
  expect(messages.map((m) => m.role)).toEqual(["user", "ai"]);
  expect(messages[0]!.ts).toBe(KILL_LINE.ts);
  const half = messages[1]!.text;
  expect(half.length).toBeGreaterThanOrEqual(200);
  expect(KILL_ANSWER.startsWith(half)).toBe(true);
  expect(faux.state.callCount).toBe(0);
  // The killed process wrote the turn's start; this one writes its end.
  expect(log.map((line) => [line.event, (line as { reason?: string }).reason, (line as { conversation?: string }).conversation])).toEqual([
    ["end", "aborted", KILL_BOOK.threadId],
  ]);
  await durable.runtime.close(ctx);
});
