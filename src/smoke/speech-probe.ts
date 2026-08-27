// The unattended half of the playback experiments (docs/33, M-voice-2).
//
// Six legs, one after another, on a fixture already pushed into the app's data
// container. Nothing here synthesises: what is being measured is the player and
// the engine, and a vendor's latency jitter in the middle of it would be noise.
// The whole answer is written to speech/speech-result.json and pulled off the
// device with scripts/ios-dictation/fetch-result.sh.
//
// The event name is `speech`, not `dictation`. Swift's `trigger` fans out by the
// name the webview registered, so a second stream costs nothing on either side
// and every promise the dictation event makes stays intact.

import { addPluginListener, type PluginListener } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { holdTheScreen } from "./wake-lock";

export const SPEECH_RESULT_DIR = "speech";
export const SPEECH_RESULT_FILE = "speech/speech-result.json";
const SPEECH_FIXTURE_DIR = "speech-fixture";

type SpeechEvent = { kind: string; value: number; reason?: string };

type Leg = {
  label: string;
  source: "trimmed" | "raw";
  pace: "burst" | "measured";
  vpio?: boolean;
  capture?: boolean;
  limit?: number;
};

type LegResult = {
  label: string;
  ok: boolean;
  error: string | null;
  /// Every level event the leg produced, in arrival order.
  levels: number[];
  /// Milliseconds between consecutive level events, as the webview saw them.
  levelGaps: number[];
  speaking: { value: number; reason?: string; atMs: number }[];
  wallMs: number;
  /// What Swift measured. Its own `label` belongs to the last leg that set one:
  /// the live leg is started from Rust and sets none.
  report: unknown;
  /// What the relay did with every sentence, on the live leg only. Null on the
  /// fixture legs, which have no relay in front of them.
  relay: unknown;
};

type SpeechResult = {
  ok: boolean;
  stage: string;
  fixtureDir: string;
  legs: LegResult[];
  interrupts: unknown;
  error: string | null;
  timestamp: string;
};

// The two paces matter separately: `burst` asks whether the scheduler splices,
// `measured` asks whether it still splices when the sentences arrive at the
// speed the vendor really produced them. Only one leg captures a tape — the
// comparison is sample-for-sample against the source files and one is enough.
const LEGS: Leg[] = [
  { label: "trimmed-burst", source: "trimmed", pace: "burst", capture: true },
  { label: "trimmed-measured", source: "trimmed", pace: "measured", capture: true },
  { label: "raw-burst", source: "raw", pace: "burst", capture: true },
  { label: "vpio-off", source: "trimmed", pace: "burst", vpio: false, limit: 4 },
  { label: "vpio-on", source: "trimmed", pace: "burst", vpio: true, limit: 4 },
];

function render(result: SpeechResult): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "font:13px/1.5 -apple-system,system-ui,sans-serif;padding:14px;color:#111;background:#fff;min-height:100vh";
  const head = document.createElement("div");
  head.style.cssText = `font-size:20px;font-weight:700;margin-bottom:10px;color:${
    result.ok ? "#0a7d28" : "#c00"
  }`;
  head.textContent = result.ok ? "SPEECH PROBE DONE" : `RUNNING — ${result.stage}`;
  box.appendChild(head);
  const pre = document.createElement("pre");
  pre.style.cssText = "white-space:pre-wrap;font-size:11px;margin:0";
  pre.textContent = JSON.stringify(result, null, 2);
  box.appendChild(pre);
  root.appendChild(box);
}

async function write(result: SpeechResult): Promise<void> {
  try {
    await mkdir(SPEECH_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(SPEECH_RESULT_FILE, JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("writing the speech result failed", e);
  }
}

/// What every leg does around whatever starts it: subscribe, start it, wait for
/// the run to say it has stopped, take the measurement record. The timeout is
/// generous — the fixture is 75 s of speech and the measured pace adds its
/// synthesis times on top — but it exists: a leg that never said
/// `speaking:false` is the failure this whole probe is for.
async function watch(label: string, begin: () => Promise<unknown>): Promise<LegResult> {
  const out: LegResult = {
    label,
    ok: false,
    error: null,
    levels: [],
    levelGaps: [],
    speaking: [],
    wallMs: 0,
    report: null,
    relay: null,
  };
  const began = performance.now();
  let lastLevelAt = 0;
  let done: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    done = resolve;
  });

  let listener: PluginListener | null = null;
  try {
    listener = await addPluginListener("voice", "speech", (event: SpeechEvent) => {
      if (event.kind === "level") {
        out.levels.push(event.value);
        const now = performance.now();
        if (lastLevelAt > 0) out.levelGaps.push(Math.round(now - lastLevelAt));
        lastLevelAt = now;
        return;
      }
      if (event.kind === "speaking") {
        out.speaking.push({
          value: event.value,
          reason: event.reason,
          atMs: Math.round(performance.now() - began),
        });
        if (event.value === 0) done?.();
      }
    });

    out.relay = await begin();

    await Promise.race([
      finished,
      new Promise<void>((resolve) => setTimeout(resolve, 180_000)),
    ]);
    out.report = await invoke("plugin:voice|speech_report");
    // A leg that never got as far as speaking also says `speaking: 0`, with
    // `failed` on it. Both the reason and the record's own error have to be
    // clear before the leg counts.
    const stopped = out.speaking.find((s) => s.value === 0);
    const reported = (out.report ?? {}) as { error?: string | null };
    out.ok = !!stopped && stopped.reason !== "failed" && !reported.error;
    if (reported.error) out.error = reported.error;
  } catch (e) {
    out.error = String(e);
  } finally {
    await listener?.unregister();
    out.wallMs = Math.round(performance.now() - began);
  }
  return out;
}

function runLeg(leg: Leg, fixtureDir: string, captureDir: string): Promise<LegResult> {
  return watch(leg.label, async () => {
    await invoke("plugin:voice|speech_probe", {
      args: {
        label: leg.label,
        source: leg.source,
        pace: leg.pace,
        vpio: leg.vpio,
        fixtureDir,
        capturePath: leg.capture ? await join(captureDir, `${leg.label}.pcm`) : undefined,
        limit: leg.limit,
      },
    });
    return null;
  });
}

/// The leg with the vendor in it: the same twelve sentences, synthesised now.
/// Everything the fixture legs leave out is in this one — the request, the
/// trim, the relay deciding how far ahead to work — and it answers with the
/// relay's own timeline, which is the only record of anything before the
/// player. Needs MIMO_API_KEY in the app's environment; the run that puts it
/// there is scripts/ios-dictation/speech-run.sh.
///
/// The sentences come from the fixture's manifest so that the two kinds of leg
/// say the same words and their measurements line up sentence by sentence.
async function runLive(): Promise<LegResult> {
  const raw = await readTextFile(`${SPEECH_FIXTURE_DIR}/manifest.json`, {
    baseDir: BaseDirectory.AppData,
  });
  const manifest = JSON.parse(raw) as { sentences: { index: number; text: string }[] };
  const sentences = [...manifest.sentences]
    .sort((a, b) => a.index - b.index)
    .map((sentence) => sentence.text);
  return watch("live", () => invoke("plugin:voice|speech_live", { args: { sentences } }));
}

/// `live` adds the leg that synthesises. It is off by default because it needs
/// a key and a network, and the fixture legs are the control that must keep
/// working without either.
export async function runSpeechProbe(options: { live?: boolean } = {}): Promise<void> {
  const result: SpeechResult = {
    ok: false,
    stage: "start",
    fixtureDir: "",
    legs: [],
    interrupts: null,
    error: null,
    timestamp: new Date().toISOString(),
  };
  render(result);
  await holdTheScreen();

  try {
    const data = await appDataDir();
    const fixtureDir = await join(data, "speech-fixture");
    const captureDir = await join(data, "speech");
    result.fixtureDir = fixtureDir;
    await mkdir(SPEECH_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });

    for (const leg of LEGS) {
      result.stage = leg.label;
      render(result);
      await write(result);
      result.legs.push(await runLeg(leg, fixtureDir, captureDir));
      // Between legs, so that the next one starts from a parked stack rather
      // than from one that is still coming to rest.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // After the fixture legs: they are the control and they answer without a
    // network, so they are on disk before anything is asked of the vendor.
    if (options.live) {
      result.stage = "live";
      render(result);
      await write(result);
      result.legs.push(await runLive());
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // The interruption loop last: it is the leg that can take the process with
    // it, and everything before it is already on disk by then.
    result.stage = "interrupt";
    render(result);
    await write(result);
    result.interrupts = await invoke("plugin:voice|speech_probe", {
      args: {
        label: "interrupt",
        source: "trimmed",
        pace: "burst",
        fixtureDir,
        mode: "interrupt",
        afterMs: 5,
        times: 50,
      },
    });

    result.ok = result.legs.every((leg) => leg.ok);
    result.stage = "done";
  } catch (e) {
    result.error = String(e);
  }
  render(result);
  await write(result);
}
