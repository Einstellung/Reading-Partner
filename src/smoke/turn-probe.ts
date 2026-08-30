// The turn probe's harness (docs/33, M-voice-3). One run, one file, three
// questions:
//
//   1. does SpeechDetector report anything, and if it does, how far behind the
//      level does it sit, and does it fire on the phone's own voice
//   2. what does finalize(through: nil) cost, in milliseconds and in words
//   3. what this build's tap delivery and this placement's level distribution
//      actually look like, unaggregated
//
// It only sequences. Every number comes from Swift's TurnProbe and goes into
// the file untouched; nothing here averages, thresholds or decides. The whole
// answer is written to turn/turn-result.json and pulled off the device with
// scripts/ios-dictation/fetch-result.sh.
//
// The person in front of the phone speaks five times, four seconds each. The
// screen is the only channel they have: it says when to read and what.

import { addPluginListener, type PluginListener } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { holdTheScreen } from "./wake-lock";

export const TURN_RESULT_DIR = "turn";
export const TURN_RESULT_FILE = "turn/turn-result.json";
const SPEECH_FIXTURE_DIR = "speech-fixture";

type SpeechEvent = { kind: string; value: number; reason?: string };

/// Chinese, because the recogniser follows the phone's language and the fixture
/// is Chinese. Read twice — once with a forced finalize at the end and once
/// left to settle on its own — so the two transcripts are of the same sentence.
const READ_LINE = "我们明天上午九点在图书馆门口见面吧。";

/// The duplex line. Deliberately not one bigram in common with the fixture, so
/// one transcript scores the two speakers apart. The same sentence the echo
/// legs use, for the same reason.
const DUPLEX_LINE = "今天天气很好，我们出去走一走吧。";

/// How long the reader has. Short on purpose: the forced finalize has to land
/// while the natural one is still 2.6 seconds away, and a generous window puts
/// the call after the answer it is trying to beat.
const READ_MS = 4000;
/// Between the end of the reading window and the forced finalize.
const FINALIZE_AFTER_MS = 200;
/// How long the pass keeps listening after a forced finalize, so the words it
/// produced are in the file with room to spare.
const SETTLE_MS = 4000;
/// The same, for the leg that forces nothing: it has to outlast the 2.6 seconds
/// a natural final has been measured at.
const NATURAL_SETTLE_MS = 6000;
/// The reader's window on the duplex leg, which starts once the phone is
/// already speaking.
const DUPLEX_READ_MS = 5000;

/// Sentences of the fixture each stage plays. Three is about eighteen seconds,
/// which is long enough for a detector to have said something and short enough
/// that five stages fit in a run.
const PLAYED_SENTENCES = 3;
const PLAYED_SENTENCES_SHORT = 2;

type PassResult = {
  sensitivity: string;
  /// A full pass runs every stage; the short ones exist only to sweep the
  /// sensitivity levels and skip everything the level cannot change.
  full: boolean;
  ok: boolean;
  error: string | null;
  wallMs: number;
  /// Swift's TurnProbeReport, verbatim.
  report: unknown;
};

type TurnResult = {
  ok: boolean;
  stage: string;
  fixtureDir: string;
  /// Whether the sensitivity sweep ran at all. False with a reason beside it
  /// when the first pass reported no detector results: there is nothing for a
  /// second and third pass to compare, and the person's time is worth more.
  sweptSensitivity: boolean;
  sweepSkipped: string | null;
  passes: PassResult[];
  error: string | null;
  timestamp: string;
};

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function write(result: TurnResult): Promise<void> {
  try {
    await mkdir(TURN_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(TURN_RESULT_FILE, JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("writing the turn result failed", e);
  }
}

/// A line on the device console from the webview. `console.log` in a WKWebView
/// reaches nothing a cable can read, so it goes out through the plugin and
/// `idevicesyslog -p 'Reading Partner'` picks it up. Never throws: a broken
/// breadcrumb must not end a run.
async function note(text: string): Promise<void> {
  try {
    await invoke("plugin:voice|speech_probe", {
      args: { label: text, source: "trimmed", pace: "burst", fixtureDir: "", mode: "note" },
    });
  } catch {
    /* the run matters, the breadcrumb does not */
  }
}

/// The only channel the person has. Repainted on every tick; a dozen repaints
/// costs nothing and there is no state to keep.
function paint(head: string, line: string, hint: string, go: boolean): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  const box = document.createElement("div");
  box.style.cssText =
    "font:15px/1.6 -apple-system,system-ui,sans-serif;padding:24px;min-height:100vh;" +
    `background:${go ? "#0a7d28" : "#101418"};color:#fff;box-sizing:border-box;` +
    "display:flex;flex-direction:column;justify-content:center;gap:20px";
  const title = document.createElement("div");
  title.style.cssText = "font-size:28px;font-weight:800;letter-spacing:.5px";
  title.textContent = head;
  const sentence = document.createElement("div");
  sentence.style.cssText =
    "font-size:30px;font-weight:600;line-height:1.5;padding:16px;border-radius:12px;" +
    "background:rgba(255,255,255,.14)";
  sentence.textContent = line;
  const foot = document.createElement("div");
  foot.style.cssText = "font-size:19px;opacity:.85";
  foot.textContent = hint;
  box.append(title, sentence, foot);
  root.appendChild(box);
}

/// Three seconds with the sentence already on the screen, so nobody is reading
/// it for the first time on the word "now".
async function countIn(line: string, what: string): Promise<void> {
  for (let n = 3; n > 0; n -= 1) {
    paint("GET READY", line, `${what} in ${n}...`, false);
    await after(1000);
  }
}

/// Starts the fixture playing and hands back a promise that settles when the
/// player says it has stopped. The `speaking` event is the only thing that
/// knows: `speech_probe` resolves as soon as the first sentence is queued.
async function playFixture(
  label: string,
  fixtureDir: string,
  limit: number,
): Promise<{ started: Promise<boolean>; ended: Promise<void>; done: () => Promise<void> }> {
  let live = false;
  let onStart: ((value: boolean) => void) | null = null;
  let onEnd: (() => void) | null = null;
  const started = new Promise<boolean>((resolve) => (onStart = resolve));
  const ended = new Promise<void>((resolve) => (onEnd = resolve));

  const listener: PluginListener = await addPluginListener(
    "voice",
    "speech",
    (event: SpeechEvent) => {
      if (event.kind !== "speaking") return;
      if (event.value === 1) {
        live = true;
        onStart?.(true);
        return;
      }
      if (live) onEnd?.();
    },
  );

  // No `vpio` key: switching the unit tears the stack down, and the microphone
  // this pass is listening through is standing in it.
  await invoke("plugin:voice|speech_probe", {
    args: { label, source: "trimmed", pace: "burst", fixtureDir, limit },
  });

  return {
    // A player that never started is not a stage; the caller says so rather
    // than waiting out a stage that is not happening.
    started: Promise.race([started, after(20_000).then(() => false)]),
    ended,
    done: async () => {
      await listener.unregister();
    },
  };
}

async function turn(mode: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return invoke("plugin:voice|speech_probe", {
    args: { label: "turn", source: "trimmed", pace: "burst", fixtureDir: "", mode, ...args },
  });
}

/// One pass: one microphone, one analyzer, one sensitivity, every stage inside
/// it. The stages are named from here because nothing in the audio says which
/// is which — only the harness knows what it just asked for.
async function runPass(
  sensitivity: string,
  full: boolean,
  fixtureDir: string,
): Promise<PassResult> {
  const out: PassResult = {
    sensitivity,
    full,
    ok: false,
    error: null,
    wallMs: 0,
    report: null,
  };
  const began = performance.now();
  let started = false;
  try {
    paint("STARTING", sensitivity, "the microphone is coming up", false);
    await turn("turn-start", { sensitivity, locale: "zh-CN", reportResults: true });
    started = true;

    // The floor of this placement, with the stack up and nothing happening. A
    // threshold is a distance from this number and there is no other way to
    // know what it is on a phone in this room.
    await turn("turn-stage", { stage: "silence" });
    paint("SILENCE", "—", "say nothing for three seconds", false);
    await after(3000);

    // Only the phone. The contest with a pure energy threshold is decided here:
    // energy has already scored zero crossings against its own playback, and
    // whether the detector does the same is the one thing that could beat it.
    await turn("turn-stage", { stage: "played" });
    paint("THE PHONE IS SPEAKING", "—", "say nothing until it stops", false);
    const played = await playFixture(
      `turn-${sensitivity}-played`,
      fixtureDir,
      full ? PLAYED_SENTENCES : PLAYED_SENTENCES_SHORT,
    );
    if (await played.started) await Promise.race([played.ended, after(120_000)]);
    else out.error = "the player never started on the played stage";
    await played.done();
    await after(1500);

    // Only the person, and the leg that forces a finalize at the end of it.
    await turn("turn-stage", { stage: "human" });
    await countIn(READ_LINE, "read it aloud");
    paint("READ ALOUD NOW", READ_LINE, "once, at a normal pace", true);
    await after(READ_MS);
    paint("THANK YOU", READ_LINE, "stop reading", false);
    if (full) {
      await after(FINALIZE_AFTER_MS);
      await turn("turn-finalize");
    }
    await after(SETTLE_MS);

    if (full) {
      // The same sentence, left to settle on its own. Two transcripts of one
      // sentence is the comparison that decides whether the first version sends
      // a forced finalize or waits.
      await turn("turn-stage", { stage: "human-natural" });
      await countIn(READ_LINE, "read the same line");
      paint("READ ALOUD NOW", READ_LINE, "the same line, the same way", true);
      await after(READ_MS);
      paint("THANK YOU", READ_LINE, "stop reading", false);
      await after(NATURAL_SETTLE_MS);

      // Both at once. The player starts first and the person reads over it,
      // which is the shape of every barge-in the product will ever see.
      await turn("turn-stage", { stage: "duplex" });
      const duplex = await playFixture(
        `turn-${sensitivity}-duplex`,
        fixtureDir,
        PLAYED_SENTENCES,
      );
      if (await duplex.started) {
        await countIn(DUPLEX_LINE, "read over the phone");
        paint("READ ALOUD NOW", DUPLEX_LINE, "ignore the phone, it keeps talking", true);
        await after(DUPLEX_READ_MS);
        paint("THANK YOU", DUPLEX_LINE, "stop reading; the phone finishes", false);
        await Promise.race([duplex.ended, after(120_000)]);
      } else {
        out.error = "the player never started on the duplex stage";
      }
      await duplex.done();
      await after(1500);
    }

    paint("STOPPING", sensitivity, "settling the recogniser", false);
    // Before the teardown: the pass tears the stack down without keeping it,
    // and a sentence still being spoken through it would be cut off mid-word.
    try {
      await invoke("plugin:voice|stop_speaking", { reason: "turn-probe" });
    } catch {
      /* nothing was speaking */
    }
    out.report = await turn("turn-stop");
    started = false;
    const reported = (out.report ?? {}) as { ok?: boolean; error?: string | null };
    if (reported.error) out.error = reported.error;
    out.ok = reported.ok === true && !out.error;
  } catch (e) {
    out.error = String(e);
    if (started) {
      try {
        out.report = await turn("turn-stop");
      } catch {
        /* the pass is already lost; the file says so */
      }
    }
  } finally {
    // The microphone goes between passes. The next one builds its own analyzer
    // with its own detector, and a pass that inherited a stack would be a cold
    // build wearing a warm one's label.
    try {
      await invoke("plugin:voice|release_microphone");
    } catch {
      /* the stack the next pass builds is the one that matters */
    }
    out.wallMs = Math.round(performance.now() - began);
  }
  return out;
}

/// How many detector results a pass saw. The whole sensitivity sweep hangs off
/// this number: zero means there is nothing for a second level to change.
function detectorEventsOf(report: unknown): number {
  const value = (report as { detectorEvents?: unknown } | null)?.detectorEvents;
  return typeof value === "number" ? value : 0;
}

export async function runTurnProbe(): Promise<void> {
  const result: TurnResult = {
    ok: false,
    stage: "boot",
    fixtureDir: "",
    sweptSensitivity: false,
    sweepSkipped: null,
    passes: [],
    error: null,
    timestamp: new Date().toISOString(),
  };

  // Anything the run does not catch itself lands in the file rather than in a
  // console nobody is reading.
  window.addEventListener("error", (event) => {
    result.error = `window.onerror: ${event.message} @ ${event.filename}:${event.lineno}`;
    void note(result.error);
    void write(result);
  });
  window.addEventListener("unhandledrejection", (event) => {
    result.error = `unhandledrejection: ${String(event.reason)}`;
    void note(result.error);
    void write(result);
  });

  try {
    // Before anything that can hang: the file existing at all is the answer to
    // "did the webview ever run".
    await write(result);
    await note("turn probe up, stage=boot");
    await holdTheScreen();
    const data = await appDataDir();
    const fixtureDir = await join(data, SPEECH_FIXTURE_DIR);
    result.fixtureDir = fixtureDir;

    result.stage = "medium";
    await write(result);
    await note(`stage=${result.stage}`);
    const medium = await runPass("medium", true, fixtureDir);
    result.passes.push(medium);
    await write(result);
    await after(2000);

    // The sweep only if there is something to sweep. Three levels of a detector
    // that reports nothing are three identical silences and two more minutes of
    // somebody's time.
    if (detectorEventsOf(medium.report) > 0) {
      result.sweptSensitivity = true;
      for (const sensitivity of ["low", "high"]) {
        result.stage = sensitivity;
        await write(result);
        await note(`stage=${result.stage}`);
        result.passes.push(await runPass(sensitivity, false, fixtureDir));
        await write(result);
        await after(2000);
      }
    } else {
      result.sweepSkipped =
        "the medium pass reported no detector results, so there is nothing a level can change";
      await note(result.sweepSkipped);
    }

    result.ok = result.passes.every((pass) => pass.ok);
    result.stage = "done";
  } catch (e) {
    result.error = String(e);
  }
  paint(
    result.ok ? "TURN PROBE DONE" : `TURN PROBE ENDED — ${result.stage}`,
    `${result.passes.length} passes`,
    result.error ?? "the file is on the device",
    false,
  );
  await write(result);
  await note(`stage=${result.stage}`);
}
