// A turn in an info or meals conversation killed in the middle of its answer,
// with a real SIGKILL and the app's thread store over a directory
// (docs/soul/87, "被杀之后"; docs/pitfall/391, 395): the restarted process lands
// the half sentence in the conversation's file once, asks nothing again, and —
// nobody having the conversation open — puts the card a reply nobody saw gets.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnLogLine } from "../../../src/legion/execute/turn-log";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { infoAddress, infoPlace, mealsPlace, type InfoOrigin, type MealsOrigin } from "../../../src/info/briefer/info-durable";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "../../reading/turn/support/file-threads";
import { INFO_ANSWER, INFO_LINE, KILL_ORIGINS, infoFileMessages, seedInfoFile } from "./support/info-file";

const CHILD = join(import.meta.dir, "info-kill-child.ts");

/** Run the child until it prints ARMED, then SIGKILL it (only this PID). */
async function killWhenArmed(root: string, place: string): Promise<void> {
  const child = Bun.spawn(["bun", CHILD, root, place], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
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

for (const place of ["info", "meals"] as const) {
  test(`killed mid-text in the ${place} conversation: the half sentence lands once, nothing asked again`, async () => {
    const origin = KILL_ORIGINS[place];
    const root = mkdtempSync(join(tmpdir(), `${place}-kill-`));
    seedInfoFile(root, origin);
    await killWhenArmed(root, place);

    const { models, faux } = slowFauxModels(["asked again"], 5000);
    const log: TurnLogLine[] = [];
    const cards: { origin: InfoOrigin | MealsOrigin; text: string }[] = [];
    const deps = {
      assembled: new Map(),
      openDesk: async () => [],
      watching: () => false,
      card: async (o: InfoOrigin | MealsOrigin, _ts: number, text: string) => {
        cards.push({ origin: o, text });
      },
    };
    const durable = await openReadingDurable({
      catalog: [],
      host: testHost(root),
      models,
      threads: storeThreadFiles(fileThreadStore(root)),
      openDesk: async () => [],
      places: { info: infoPlace(deps), meals: mealsPlace(deps) },
      log: (line) => log.push(line),
    });
    expect(durable.recovered.map((r) => r.outcome)).toEqual(["mid-text"]);
    const until = Date.now() + 15_000;
    while ((await durable.runtime.harness.inspect(ctx)).tasks.length > 0) {
      if (Date.now() > until) throw new Error("tasks still live");
      await new Promise((r) => setTimeout(r, 10));
    }

    const messages = infoFileMessages(root, origin);
    expect(messages.map((m) => m.role)).toEqual(["user", "ai"]);
    expect(messages[0]!.ts).toBe(INFO_LINE.ts);
    const half = messages[1]!.text;
    expect(half.length).toBeGreaterThanOrEqual(200);
    expect(INFO_ANSWER.startsWith(half)).toBe(true);
    expect(faux.state.callCount).toBe(0);
    expect(cards).toEqual([{ origin, text: half }]);
    expect(
      log.map((line) => [line.event, (line as { reason?: string }).reason, (line as { conversation?: string }).conversation]),
    ).toEqual([["end", "aborted", infoAddress(origin).threadId]]);
    await durable.runtime.close(ctx);
  }, 30_000);
}
