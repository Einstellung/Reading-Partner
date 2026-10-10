// The SQLite-backend scenes on the bun:sqlite stand-in for the Rust host, all
// on the faux provider. The same scenes run in the Tauri app over the real IPC
// (sqlite-probe-main.ts); docs/research/pi-durable-spike.md has both sets of
// numbers. DURABLE_REPORT=1 prints each scene's result.

import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDurableSqlite, removeDurableSqlite } from "../../../src/platform/app/durable-sqlite";
import {
  collaborationScene,
  concurrencyScene,
  crashResume,
  latencyScene,
  rotationScene,
  type SceneHost,
} from "../../../src/legion/durable/sqlite-scenes";
import { bunSqliteHost } from "../../platform/app/durable-sqlite-host";

function host(root = mkdtempSync(join(tmpdir(), "durable-scenes-"))) {
  let calls = 0;
  const inner = bunSqliteHost(root);
  const call = (command: string, args: Record<string, unknown>) => {
    calls++;
    return inner(command, args);
  };
  const sceneHost: SceneHost = { open: (p) => openDurableSqlite(p, call), remove: (p) => removeDurableSqlite(p, call) };
  return { root, sceneHost, calls: () => calls };
}

const report = (name: string, value: unknown) => {
  if (process.env.DURABLE_REPORT) console.log(name, JSON.stringify(value, null, 1));
};

test("commits stay short while a reply streams", async () => {
  const h = host();
  const result = await latencyScene(h.sceneHost, "lat.sqlite", { tokensPerSecond: 1500, rounds: 2, calls: h.calls });
  report("latency", result);
  expect(result.runs).toHaveLength(2);
  expect(result.commit.n).toBeGreaterThan(4);
  for (const run of result.runs) expect(run.growth).toBeGreaterThan(0);
}, 60_000);

test("twelve conversations with subagents and steers all settle", async () => {
  const result = await concurrencyScene(host().sceneHost, "conc.sqlite", 12, 60_000);
  report("concurrency", result);
  expect(result.stuck).toBe(false);
  if (result.stuck) return;
  expect(result.children).toBe(4);
  for (const c of result.conversations ?? []) {
    expect(c.status.every((s) => s === "done")).toBe(true);
    if (c.mode === "lookup") {
      expect(c.kinds).toEqual(["pi.user", "pi.assistant", "pi.tool-result", "pi.user", "pi.assistant"]);
    }
    if (c.mode === "delegate") expect(c.kinds).toEqual(["pi.user", "pi.assistant", "pi.tool-result", "pi.assistant"]);
  }
}, 90_000);

test("a tool in one conversation asks another and gets its answer", async () => {
  const result = await collaborationScene(host().sceneHost, "peer.sqlite");
  report("collaboration", result);
  expect(result.status).toBe("done");
  expect(result.a[result.a.length - 1].text).toBe("A heard: B says: the moon.");
  expect(result.b.map((l) => l.kind)).toEqual(["pi.user", "pi.assistant"]);
}, 30_000);

test("the generation swap runs end to end", async () => {
  const result = await rotationScene(host().sceneHost, "gen");
  report("rotation", result);
  expect(result.idle).toBe(true);
  expect(result.oldGone).toBe(true);
  expect(result.seededRoles.filter((r) => r !== "system")).toEqual(["user", "assistant", "user", "assistant", "user"]);
}, 30_000);

test("a stream killed mid-reply reopens with the half sentence in pi.live and finishes", async () => {
  const h = host();
  const child = Bun.spawn(["bun", join(import.meta.dir, "sqlite-crash-child.ts"), h.root, "crash.sqlite"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = child.stdout.getReader();
  let out = "";
  while (!out.includes("ARMED")) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  child.kill("SIGKILL");
  await child.exited;
  const result = await crashResume(host(h.root).sceneHost, "crash.sqlite");
  report("crash", { armed: out.trim(), ...result });
  expect(result.partialAtReopenChars).toBeGreaterThanOrEqual(200);
  expect(result.status).toBe("done");
  expect(result.requestRoles.filter((r) => r !== "system")).toEqual(["user"]);
  expect(result.finalAnswerIsFull).toBe(true);
}, 60_000);
