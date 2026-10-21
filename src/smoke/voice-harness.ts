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
import { RunGate, endState, hangUp } from "../soul/voice/harness/run";

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

const gate = new RunGate();

// The device ends a run a little before the script on the Linux side gives up
// waiting, so a timeout is reported by the app, after the call is down.
const DEADLINE_MARGIN_S = 15;
// A call that has not opened by then is not going to.
const CALL_UP_MS = 20_000;

// `vad` is docs/136's A/B: "energy" runs the call on the old dB line, anything
// else (or nothing) on the neural VAD and Smart Turn.
export async function runVoiceHarness(
  scriptName: string,
  id: string,
  timeoutSec?: number,
  vad?: string,
): Promise<void> {
  const deadlineMs = timeoutSec && timeoutSec > 2 * DEADLINE_MARGIN_S ? (timeoutSec - DEADLINE_MARGIN_S) * 1000 : undefined;
  // Throws, and so reports `failed` under this id, when another run holds the gate.
  const signal = gate.begin(id, deadlineMs);
  let failure: unknown = null;
  let armed: { dir: string } | null = null;
  let run: string | undefined;
  let name = scriptName;
  let speech: { unregister(): Promise<void> } | null = null;
  const host = voiceCallHost();
  try {
    await report(id, { state: "starting", script: scriptName });
    const script = parseScript(await (await fetchOk(`${FIXTURES}${scriptName}.json`)).json());
    name = script.name;
    if (!host) throw new Error("No voice call on screen: open the info page so the companion is showing.");

    // A call an earlier run left up would swallow this run's start.
    await hangUp(host, sleep);

    run = `${script.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    armed = await invoke<{ dir: string }>(CMD, { op: "arm", run, vad });

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
    speech = await addPluginListener<{ kind: string; value: number }>("voice", "speech", (e) => {
      if (e.kind === "speaking") voiceTrace("speech:speaking", { value: e.value });
    });
    await report(id, { state: "running", script: script.name, run, dir: armed.dir });
    voiceTrace("call-start", { script: script.name });
    host.start();
    await runScript(script, {
      subscribe: onVoiceTrace,
      feed: async (clip) => {
        await invoke(CMD, { op: "feed", name: clip });
      },
      sleep,
      now: () => performance.now(),
      signal,
      callUpMs: CALL_UP_MS,
      mark: (mark, data) => {
        voiceTrace(mark, data);
        if (mark === "step-feed") void report(id, { state: "running", run, dir: armed?.dir, step: data });
        // A step fed on a timeout or after its moment passed: the run is worth less.
        else if (mark === "step-timeout" || mark === "settle-timeout" || mark === "step-late") {
          void report(id, { state: "running", run, dir: armed?.dir, warning: mark, step: data });
        }
      },
    });
  } catch (e) {
    failure = e;
  } finally {
    // However the run ended: hang up, let the last rows land and the stack come
    // down, close the files, free the gate. Only then is the end reported.
    voiceTrace("call-stop", failure ? { failed: true } : undefined);
    if (host) await hangUp(host, sleep);
    await speech?.unregister().catch(() => {});
    disarmVoiceTrace();
    if (armed) await invoke(CMD, { op: "disarm" }).catch(() => {});
    gate.end(id);
  }
  await report(id, { ...endState(failure), script: name, run, dir: armed?.dir });
}

if (import.meta.hot) {
  import.meta.hot.on("voice-harness:run", (d: { script: string; id: string; timeoutSec?: number; vad?: string }) => {
    void runVoiceHarness(d.script, d.id, d.timeoutSec, d.vad).catch((e: unknown) => report(d.id, endState(e)));
  });
  import.meta.hot.on("voice-harness:cancel", (d: { id: string }) => {
    gate.cancel(d.id, "The run was cancelled from the Linux side.");
  });
}
