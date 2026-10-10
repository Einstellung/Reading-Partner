// The SQLite scenes inside the Tauri app, over the real IPC to
// src-tauri/src/durable_sqlite.rs. Dev-only: built into a page of its own and
// loaded as the window of a probe build with a separate identifier, so its
// AppData is not the app's (docs/research/pi-durable-spike.md, "SQLite 后端").
// Results land as JSON in AppData/durable-probe/.
//
// Two launches. The first runs the scenes, then starts the crash stream and
// writes crash-armed.json once 200 characters are committed; the driver
// SIGKILLs the process there. The second finds the pending submission and
// writes crash.json.
//
// Build and run (Linux shown; on the Mac the same page goes into a .dev build
// for the simulator or the iPad, and the JSON comes out of the app container):
//
//   bunx vite build scripts/durable-probe --outDir <dir>/dist --emptyOutDir
//   bun run tauri build --debug --no-bundle --config \
//     '{"identifier":"com.xinyuan.readingpartner.durableprobe","build":{"frontendDist":"<dir>/dist","beforeBuildCommand":""}}'
//   xvfb-run -a src-tauri/target/debug/reading-partner   # run, note its PID
//
// Wait for AppData/durable-probe/crash-armed.json, SIGKILL that PID, start the
// binary once more and read AppData/durable-probe/{latency,concurrency,
// collaboration,rotation,crash}.json (AppData of the probe identifier).

import { invoke } from "@tauri-apps/api/core";
import { openDurableSqlite, removeDurableSqlite, type HostCall } from "../../src/platform/app/durable-sqlite";
import {
  collaborationScene,
  concurrencyScene,
  crashResume,
  crashStart,
  latencyScene,
  rotationScene,
  spread,
  type SceneHost,
} from "../../tests/legion/durable/support/sqlite-scenes";

const DIR = "durable-probe";
let calls = 0;
let times: number[] = [];
const call: HostCall = async (command, args) => {
  calls++;
  const start = performance.now();
  try {
    return await invoke(command, args);
  } finally {
    times.push(performance.now() - start);
  }
};
const host: SceneHost = { open: (p) => openDurableSqlite(p, call), remove: (p) => removeDurableSqlite(p, call) };
const write = (name: string, data: unknown) =>
  invoke("write_text_file_atomic", { path: `${DIR}/${name}.json`, contents: JSON.stringify(data, null, 1) });
const show = (text: string) => {
  document.body.textContent = text;
};

async function pendingCrash(path: string): Promise<boolean> {
  const db = await host.open(path);
  const tables = (await db.get<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE name = 'submissions'"))!.n;
  const pending = tables
    ? (await db.get<{ n: number }>("SELECT count(*) AS n FROM submissions WHERE status IN ('queued', 'placed')"))!.n
    : 0;
  await db.close();
  return pending > 0;
}

async function main() {
  const crashPath = `${DIR}/crash.sqlite`;
  if (await pendingCrash(crashPath)) {
    show("crash: resuming");
    await write("crash", await crashResume(host, crashPath));
    show("crash: done");
    return;
  }
  for (const name of ["crash", "latency", "concurrency", "peer"]) await host.remove(`${DIR}/${name}.sqlite`);
  const env = { userAgent: navigator.userAgent };

  // The bare IPC round trip, for scale: one cached SELECT per call.
  const ping = await host.open(`${DIR}/ping.sqlite`);
  times = [];
  for (let i = 0; i < 300; i++) await ping.get("SELECT 1 AS one");
  const ipc = spread(times);
  await ping.close();
  await host.remove(`${DIR}/ping.sqlite`);

  show("latency");
  times = [];
  const latency = await latencyScene(host, `${DIR}/latency.sqlite`, { tokensPerSecond: 70, rounds: 3, calls: () => calls });
  await write("latency", { env, ipc, latencyCalls: spread(times), ...latency });

  show("concurrency");
  await write("concurrency", await concurrencyScene(host, `${DIR}/concurrency.sqlite`, 12));
  show("collaboration");
  await write("collaboration", await collaborationScene(host, `${DIR}/peer.sqlite`));
  show("rotation");
  await write("rotation", await rotationScene(host, `${DIR}/gen`));

  show("crash: streaming");
  await crashStart(host, crashPath, (partial) => void write("crash-armed", { chars: partial.length }));
}

main().catch((error: unknown) => {
  show(`error: ${String(error)}`);
  void write("error", { message: String(error), stack: (error as Error)?.stack ?? null });
});
