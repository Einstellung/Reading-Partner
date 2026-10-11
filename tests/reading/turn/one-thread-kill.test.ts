// A coach turn and a retell's opening turn killed in the middle of their
// answers, with a real SIGKILL and the app's thread store over a directory
// (docs/soul/87, "被杀之后"; docs/pitfall/391, 395): the restarted process
// lands the half sentence in the thing's thread file once and asks nothing
// again. The retell's kickoff, never a row, is not written either.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnLogLine } from "../../../src/legion/execute/turn-log";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "./support/file-threads";
import { KILL_CASES, KILL_REPLY, killFileMessages, seedKillFile, type KillCase } from "./support/one-thread-file";

const CHILD = join(import.meta.dir, "one-thread-kill-child.ts");

/** Run the child until it prints ARMED, then SIGKILL it (only this PID). */
async function killWhenArmed(root: string, c: KillCase): Promise<void> {
  const child = Bun.spawn(["bun", CHILD, root, c.name], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
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

for (const c of Object.values(KILL_CASES)) {
  test(`${c.name} killed mid-text: the half sentence lands in its thread file once, nothing asked again`, async () => {
    const root = mkdtempSync(join(tmpdir(), `${c.name}-kill-`));
    seedKillFile(root, c);
    await killWhenArmed(root, c);

    const { models, faux } = slowFauxModels(["asked again"], 5000);
    const log: TurnLogLine[] = [];
    const durable = await openReadingDurable({
      catalog: [],
      host: testHost(root),
      models,
      threads: storeThreadFiles(fileThreadStore(root)),
      openDesk: async () => [],
      places: { [c.place]: c.factory() },
      log: (line) => log.push(line),
    });
    expect(durable.recovered.map((r) => r.outcome)).toEqual(["mid-text"]);
    const until = Date.now() + 15_000;
    while ((await durable.runtime.harness.inspect(ctx)).tasks.length > 0) {
      if (Date.now() > until) throw new Error("tasks still live");
      await new Promise((r) => setTimeout(r, 10));
    }

    const messages = killFileMessages(root, c);
    expect(messages.map((m) => m.role)).toEqual([...c.seed.map((m) => m.role), "ai"]);
    const half = messages[messages.length - 1]!.text;
    expect(half.length).toBeGreaterThanOrEqual(200);
    expect(KILL_REPLY.startsWith(half)).toBe(true);
    expect(faux.state.callCount).toBe(0);
    expect(log.map((line) => [line.event, (line as { reason?: string }).reason, (line as { conversation?: string }).conversation])).toEqual([
      ["end", "aborted", c.origin.id],
    ]);
    await durable.runtime.close(ctx);
  });
}
