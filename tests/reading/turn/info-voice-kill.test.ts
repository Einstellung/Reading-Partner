// A voice call's turn killed in the middle of its answer, with a real SIGKILL
// and the app's thread store over a directory (docs/soul/87, "被杀之后"): the
// restarted process lands the half sentence under the spoken line once, asks
// nothing again and does not speak — the call is gone — and, nobody having the
// conversation open, puts the card a reply nobody saw gets.

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { infoPlace, type InfoOrigin, type MealsOrigin } from "../../../src/info/briefer/info-durable";
import { storeThreadFiles } from "../../../src/legion/durable/thread-files";
import { openReadingDurable } from "../../../src/reading/turn/durable-runtime";
import { testHost } from "../../legion/durable/support/runtime";
import { fileThreadStore, slowFauxModels } from "./support/file-threads";
import { VOICE_ANSWER, VOICE_LINE, VOICE_ORIGIN, voiceFileMessages } from "./support/info-voice-file";

const CHILD = join(import.meta.dir, "info-voice-kill-child.ts");

test("killed mid-reply in a voice call: the half sentence lands once under the spoken line, nothing asked again", async () => {
  const root = mkdtempSync(join(tmpdir(), "info-voice-kill-"));
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
    // Only this PID.
    child.kill("SIGKILL");
    await child.exited;
  }
  expect(voiceFileMessages(root).map((m) => m.role)).toEqual(["user"]);

  const { models, faux } = slowFauxModels(["asked again"], 5000);
  const cards: { origin: InfoOrigin | MealsOrigin; text: string }[] = [];
  const durable = await openReadingDurable({
    catalog: [],
    host: testHost(root),
    models,
    threads: storeThreadFiles(fileThreadStore(root)),
    openDesk: async () => [],
    places: {
      info: infoPlace({
        assembled: new Map(),
        openDesk: async () => [],
        watching: () => false,
        card: async (origin, _ts, text) => {
          cards.push({ origin, text });
        },
      }),
    },
    log: () => {},
  });
  expect(durable.recovered.map((r) => r.outcome)).toEqual(["mid-text"]);
  const until = Date.now() + 15_000;
  while ((await durable.runtime.harness.inspect(ctx)).tasks.length > 0) {
    if (Date.now() > until) throw new Error("tasks still live");
    await new Promise((r) => setTimeout(r, 10));
  }

  const messages = voiceFileMessages(root);
  expect(messages.map((m) => [m.role, m.role === "user" ? m.text : "…"])).toEqual([
    ["user", VOICE_LINE],
    ["ai", "…"],
  ]);
  const half = messages[1]!.text;
  expect(half.length).toBeGreaterThanOrEqual(200);
  expect(VOICE_ANSWER.startsWith(half)).toBe(true);
  expect(faux.state.callCount).toBe(0);
  expect(cards).toEqual([{ origin: VOICE_ORIGIN, text: half }]);
  await durable.runtime.close(ctx);
}, 30_000);
