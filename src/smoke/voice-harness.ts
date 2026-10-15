// The silent voice bench's trigger (docs/platform/560, 静默语音测试). Loaded in
// dev builds only, alongside the app: it waits for `voice-harness:run` on the
// Vite HMR socket, which scripts/ios-linux/voice-run.sh sends through the dev
// server, and then runs one script against the voice call on screen.
//
// The script and its clips are read from the dev server (tests/fixtures/
// voice-scripts/), copied into the run's directory on the device, and fed
// through the native harness. Progress goes back to the dev server, where the
// Linux script is polling for it; the run's files stay in the app container
// for `apps pull`.

import { addPluginListener, invoke } from "@tauri-apps/api/core";
import {
  armVoiceTrace,
  disarmVoiceTrace,
  onVoiceTrace,
  voiceCallHost,
  voiceTrace,
} from "../soul/voice/harness/trace";
import { parseScript, runScript } from "../soul/voice/harness/script";

const CMD = "plugin:voice|harness";
const FIXTURES = "/tests/fixtures/voice-scripts/";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function report(id: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`/__voice-harness/status?id=${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ ...body, at: new Date().toISOString() }),
  }).catch(() => {});
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function fetchOk(path: string): Promise<Response> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
}

let running = false;

export async function runVoiceHarness(scriptName: string, id: string): Promise<void> {
  if (running) throw new Error("A harness run is already going.");
  running = true;
  try {
    await report(id, { state: "starting", script: scriptName });
    const script = parseScript(await (await fetchOk(`${FIXTURES}${scriptName}.json`)).json());
    const host = voiceCallHost();
    if (!host) throw new Error("No voice call on screen: open the info page so Lumen is showing.");

    const run = `${script.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const armed = await invoke<{ dir: string }>(CMD, { op: "arm", run });

    // Twenty round trips; the analysis keeps the tightest.
    for (let i = 0; i < 20; i++) {
      const perf0 = performance.now();
      const { t } = await invoke<{ t: number }>(CMD, { op: "clock" });
      const perf1 = performance.now();
      await invoke(CMD, { op: "mark", name: "clock-sync", perfMs: perf1, data: { perf0, perf1, native: t } });
    }

    for (const clip of new Set(script.steps.map((s) => s.clip))) {
      const bytes = new Uint8Array(await (await fetchOk(`${FIXTURES}${clip}`)).arrayBuffer());
      await invoke(CMD, { op: "clip", name: clip, wav: base64(bytes) });
    }

    armVoiceTrace(
      {
        mark: (m) => {
          void invoke(CMD, { op: "mark", name: m.name, perfMs: m.perfMs, data: m.data ?? {} }).catch(() => {});
        },
      },
      { locale: script.locale },
    );
    const speech = await addPluginListener<{ kind: string; value: number }>("voice", "speech", (e) => {
      if (e.kind === "speaking") voiceTrace("speech:speaking", { value: e.value });
    });
    await report(id, { state: "running", script: script.name, run, dir: armed.dir });
    let failure: unknown = null;
    try {
      voiceTrace("call-start", { script: script.name });
      host.start();
      await runScript(script, {
        subscribe: onVoiceTrace,
        feed: async (clip) => {
          await invoke(CMD, { op: "feed", name: clip });
        },
        sleep,
        now: () => performance.now(),
        mark: (name, data) => {
          voiceTrace(name, data);
          if (name === "step-feed") void report(id, { state: "running", run, dir: armed.dir, step: data });
          // A step fed on a timeout or after its moment passed: the run is worth less.
          else if (name === "step-timeout" || name === "settle-timeout" || name === "step-late") {
            void report(id, { state: "running", run, dir: armed.dir, warning: name, step: data });
          }
        },
      });
    } catch (e) {
      failure = e;
    } finally {
      voiceTrace("call-stop");
      host.stop();
      // Let the last rows land and the stack come down before the files close.
      await sleep(1500);
      await speech.unregister().catch(() => {});
      disarmVoiceTrace();
      await invoke(CMD, { op: "disarm" }).catch(() => {});
    }
    if (failure) throw failure;
    await report(id, { state: "done", script: script.name, run, dir: armed.dir });
  } finally {
    running = false;
  }
}

if (import.meta.hot) {
  import.meta.hot.on("voice-harness:run", (d: { script: string; id: string }) => {
    void runVoiceHarness(d.script, d.id).catch((e: unknown) =>
      report(d.id, { state: "failed", message: e instanceof Error ? e.message : String(e) }),
    );
  });
}
