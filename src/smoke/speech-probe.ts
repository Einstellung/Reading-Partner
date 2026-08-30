// The unattended half of the playback experiments (docs/33, M-voice-2).
//
// Three fixture legs, two echo legs and, when asked, one with the vendor in it,
// on a fixture already pushed into the app's data container. Nothing but the
// last of them synthesises: what is being measured is the player and the
// engine, and a vendor's latency jitter in the middle of it would be noise.
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
import {
  hasOnDeviceDictation,
  nativeDictation,
  releaseDictationMicrophone,
  type DictationEvent,
} from "../ai/voice/dictation";

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
  /// What each set of audio-session category options did to the route, taken
  /// before the first leg. The answer to "does the headset get the audio, and
  /// at which Bluetooth profile" — the shipping configuration asks for neither
  /// Bluetooth option, and nothing so far has measured what that costs.
  routes: unknown;
  legs: LegResult[];
  echo: EchoResult[];
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
];

/// The control leg of the truth-table run: one sentence, voice processing on,
/// nothing torn down first. It is there to leave a stack standing — without one
/// the echo leg's `close()` has nothing to close and the leg after it is a cold
/// build wearing the label of a rebuild.
const ECHO_ONLY_LEGS: Leg[] = [
  { label: "trimmed-burst", source: "trimmed", pace: "burst", limit: 1 },
];

/// How many sentences the echo legs play. Long enough that the recogniser has
/// something to settle on after the microphone joins, short enough that two of
/// them fit in the run alongside everything else.
const ECHO_SENTENCES = 6;

/// One half of the echo experiment: the phone speaking while its own microphone
/// is open, with the voice-processing unit on and then off.
type EchoResult = {
  label: string;
  vpio: boolean;
  ok: boolean;
  error: string | null;
  /// What the player was given, joined.
  spoken: string;
  /// What the recogniser settled on. The whole transcript, not a tail.
  heard: string;
  /// Character bigrams of `spoken`, and how many of them are in `heard`. A
  /// ratio rather than a word count because the fixture is Chinese and the
  /// recogniser does not agree with anybody about where the words are.
  bigrams: number;
  bigramsHeard: number;
  /// Dictation events of any kind. Zero means the leg did not listen at all,
  /// which is not the same answer as "the unit cancelled everything".
  events: number;
  wallMs: number;
  /// Loudest and mean input level the leg saw, in the 0..1 the meter carries.
  /// An empty transcript over a meter that never moved and an empty transcript
  /// over one that did are two different findings.
  peakLevel: number;
  meanLevel: number;
  /// The duplex leg has two speakers in one recording, so it scores two texts
  /// against the one transcript: `spoken` is what the person read, and this is
  /// what the player said over the top of them. Null on every other leg.
  played: { text: string; bigrams: number; bigramsHeard: number } | null;
};

/// Overlapping character pairs, punctuation and spacing dropped.
function bigramsOf(text: string): Set<string> {
  const clean = text.replace(/[^\p{L}\p{N}]/gu, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < clean.length; i += 1) out.add(clean.slice(i, i + 2));
  return out;
}

/// How many of `target`'s bigrams a transcript contains. One scoring function
/// for every echo leg, so that a sentence the player spoke and a sentence a
/// person read are counted the same way.
function score(target: string, heard: string): { bigrams: number; bigramsHeard: number } {
  const want = bigramsOf(target);
  const got = bigramsOf(heard);
  return { bigrams: want.size, bigramsHeard: [...want].filter((b) => got.has(b)).length };
}

/// A leg's record before the leg runs, with everything that has to exist even
/// if it fails on its first line already on it.
function emptyEcho(label: string, spoken: string): EchoResult {
  return {
    label,
    vpio: true,
    ok: false,
    error: null,
    spoken,
    heard: "",
    ...score(spoken, ""),
    events: 0,
    wallMs: 0,
    peakLevel: 0,
    meanLevel: 0,
    played: null,
  };
}

/// Peak and mean of the level events, folded in as they arrive so that nothing
/// has to hold thousands of them.
function newMeter() {
  let peak = 0;
  let sum = 0;
  let n = 0;
  return {
    take(value: number) {
      if (value > peak) peak = value;
      sum += value;
      n += 1;
    },
    read: () => ({
      peakLevel: Math.round(peak * 1000) / 1000,
      meanLevel: n === 0 ? 0 : Math.round((sum / n) * 1000) / 1000,
    }),
  };
}

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
async function fixtureSentences(): Promise<string[]> {
  const raw = await readTextFile(`${SPEECH_FIXTURE_DIR}/manifest.json`, {
    baseDir: BaseDirectory.AppData,
  });
  const manifest = JSON.parse(raw) as { sentences: { index: number; text: string }[] };
  return [...manifest.sentences].sort((a, b) => a.index - b.index).map((s) => s.text);
}

async function runLive(captureDir: string): Promise<LegResult> {
  const sentences = await fixtureSentences();
  // The tape is armed separately because this leg is started from Rust and
  // never passes through the probe that arms the fixture legs' tapes. It is the
  // only recording with the relay's own gaps between sentences in it.
  await invoke("plugin:voice|speech_probe", {
    args: {
      label: "live",
      source: "trimmed",
      pace: "burst",
      fixtureDir: "",
      mode: "capture",
      capturePath: await join(captureDir, "live.pcm"),
    },
  });
  return watch("live", () => invoke("plugin:voice|speech_live", { args: { sentences } }));
}

/// The echo leg: the phone speaks the fixture with its own microphone open, and
/// the answer is how much of what it said the recogniser wrote down. With the
/// voice-processing unit on that should be close to nothing; with it off it
/// should be most of it, and that second half is the control — two empty
/// transcripts mean the leg never listened, not that the unit worked.
///
/// The order is load-bearing twice over. The unit is switched before anything
/// subscribes, because the switch tears the stack down and the teardown ends in
/// a `speaking:0` that a watching leg would take for its own ending. And the
/// player starts before the microphone, because a stack that has a player can
/// take a microphone but a stack that has none has to be rebuilt to get one,
/// and the rebuild would take the recogniser with it.
async function runEcho(
  vpio: boolean,
  fixtureDir: string,
  sentences: number = ECHO_SENTENCES,
): Promise<EchoResult> {
  const label = vpio ? "echo-vpio-on" : "echo-vpio-off";
  const began = performance.now();
  const spoken = (await fixtureSentences()).slice(0, sentences).join("");
  const out = emptyEcho(label, spoken);
  out.vpio = vpio;
  const meter = newMeter();

  let listener: PluginListener | null = null;
  let dictating = false;
  // The locale is not optional here. Without one the native side walks
  // `Locale.preferredLanguages` and lands on en-US, and a Chinese sentence
  // decoded as English comes back as fluent English nonsense rather than as a
  // bad transcript (docs/pitfall/164) — which scores zero against every Chinese
  // bigram and reads exactly like an echo canceller doing its job.
  const source = hasOnDeviceDictation() ? nativeDictation({ locale: "zh-CN" }) : null;
  try {
    if (!source) throw new Error("This device has no on-device dictation.");
    await invoke("plugin:voice|speech_probe", {
      args: { label, source: "trimmed", pace: "burst", vpio, fixtureDir, mode: "vpio" },
    });
    await after(800);

    let live = false;
    let started: (() => void) | null = null;
    let ended: (() => void) | null = null;
    const speakingStarted = new Promise<void>((resolve) => (started = resolve));
    const speakingEnded = new Promise<void>((resolve) => (ended = resolve));
    listener = await addPluginListener("voice", "speech", (event: SpeechEvent) => {
      if (event.kind !== "speaking") return;
      if (event.value === 1) {
        live = true;
        started?.();
        return;
      }
      if (live) ended?.();
    });

    await invoke("plugin:voice|speech_probe", {
      args: {
        label,
        source: "trimmed",
        pace: "burst",
        fixtureDir,
        limit: sentences,
      },
    });
    await Promise.race([speakingStarted, after(20_000)]);
    if (!live) throw new Error("The player never started, so there was nothing to hear.");

    await source.start((event: DictationEvent) => {
      // Levels are the meter. They say nothing about what was transcribed, but
      // they say whether anything reached the input at all, which is the other
      // half of reading a zero.
      if (event.kind === "level") meter.take(event.value);
      else out.events += 1;
    });
    dictating = true;
    await Promise.race([speakingEnded, after(120_000)]);
    // The tail of the last sentence is still settling when the player stops.
    await after(1500);
    out.heard = await source.stop();
    dictating = false;

    Object.assign(out, score(spoken, out.heard), meter.read());
    out.ok = true;
  } catch (e) {
    out.error = String(e);
  } finally {
    if (dictating && source) {
      try {
        await source.cancel();
      } catch {
        // The stack the next leg builds is the one that matters.
      }
    }
    await listener?.unregister();
    // The microphone goes between legs: the next one switches the unit, and a
    // switch under a live recogniser is a different experiment.
    await releaseDictationMicrophone();
    out.wallMs = Math.round(performance.now() - began);
  }
  return out;
}

/// Seconds the reader is given once the screen turns green. Long enough for a
/// sentence at a normal pace with room on both sides of it.
const HUMAN_READ_MS = 8000;

/// What the reader reads on the duplex leg, where the player is speaking the
/// fixture over the top of them. Chinese because the recogniser follows the
/// phone's language and the whole fixture is Chinese; short, common characters,
/// and not one bigram in common with the fixture, so a single transcript scores
/// the two speakers apart.
const HUMAN_DUPLEX_LINE = "今天天气很好，我们出去走一走吧。";

/// The only channel the human legs have. One of them plays nothing at all and
/// the other plays something the reader is told to ignore, so the screen is
/// what says when to start. Repainted on every tick: a dozen repaints over a
/// dozen seconds costs nothing and there is no state to keep.
function paintPrompt(head: string, line: string, note: string, go: boolean): void {
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
    "font-size:32px;font-weight:600;line-height:1.5;padding:16px;border-radius:12px;" +
    "background:rgba(255,255,255,.14)";
  sentence.textContent = line;
  const foot = document.createElement("div");
  foot.style.cssText = "font-size:20px;opacity:.85";
  foot.textContent = note;
  box.append(title, sentence, foot);
  root.appendChild(box);
}

/// The positive control. Everything `echo-vpio-on` does — voice processing on,
/// the same microphone, the same recogniser, the same bigram scoring against
/// the same sentence — with one thing changed: the sentence comes from a person
/// in the room instead of from the player. Zero on both legs would mean the
/// chain never heard anything and the played leg's zero measures nothing; zero
/// on the played leg alone means the canceller took our own voice out and left
/// a human's in.
///
/// `duplex` keeps the player running while the person reads, over a different
/// sentence, and scores both texts against the one transcript. It is what
/// separates "the canceller removed the far end" from "the input goes deaf for
/// as long as the player runs" — the quiet leg cannot tell those apart, because
/// it has no player in it, and the second one would take barge-in with it.
async function runHuman(
  fixtureDir: string,
  options: { duplex: boolean; played: number },
): Promise<EchoResult> {
  const label = options.duplex ? "echo-human-duplex" : "echo-human";
  const began = performance.now();
  const fixture = await fixtureSentences();
  const playedText = fixture.slice(0, options.played).join("");
  const target = options.duplex ? HUMAN_DUPLEX_LINE : fixture[0];
  const out = emptyEcho(label, target);
  const meter = newMeter();

  let listener: PluginListener | null = null;
  let dictating = false;
  // The locale is not optional here. Without one the native side walks
  // `Locale.preferredLanguages` and lands on en-US, and a Chinese sentence
  // decoded as English comes back as fluent English nonsense rather than as a
  // bad transcript (docs/pitfall/164) — which scores zero against every Chinese
  // bigram and reads exactly like an echo canceller doing its job.
  const source = hasOnDeviceDictation() ? nativeDictation({ locale: "zh-CN" }) : null;
  try {
    if (!source) throw new Error("This device has no on-device dictation.");
    // The same switch the echo legs make, in the same place, and a no-op by the
    // time this leg runs. That is the point: this leg has to inherit the
    // product's configuration rather than ask for one of its own.
    await invoke("plugin:voice|speech_probe", {
      args: { label, source: "trimmed", pace: "burst", vpio: true, fixtureDir, mode: "vpio" },
    });
    await after(800);

    // Counted down before anything else starts, so the reader has the sentence
    // in front of them for three seconds before they have to say it.
    for (let n = 3; n > 0; n -= 1) {
      paintPrompt("GET READY", target, `read it aloud in ${n}...`, false);
      await after(1000);
    }

    let live = false;
    let started: (() => void) | null = null;
    let ended: (() => void) | null = null;
    const speakingStarted = new Promise<void>((resolve) => (started = resolve));
    const speakingEnded = new Promise<void>((resolve) => (ended = resolve));

    if (options.duplex) {
      listener = await addPluginListener("voice", "speech", (event: SpeechEvent) => {
        if (event.kind !== "speaking") return;
        if (event.value === 1) {
          live = true;
          started?.();
          return;
        }
        if (live) ended?.();
      });
      // Player first and microphone second, for the reason the echo leg gives:
      // a stack that has a player can take a microphone, a stack that has none
      // has to be rebuilt to get one, and the rebuild takes the recogniser.
      await invoke("plugin:voice|speech_probe", {
        args: { label, source: "trimmed", pace: "burst", fixtureDir, limit: options.played },
      });
      await Promise.race([speakingStarted, after(20_000)]);
      if (!live) throw new Error("The player never started, so there was nothing to talk over.");
    }

    await source.start((event: DictationEvent) => {
      if (event.kind === "level") meter.take(event.value);
      else out.events += 1;
    });
    dictating = true;

    paintPrompt("READ ALOUD NOW", target, options.duplex ? "ignore the phone" : "", true);
    await after(HUMAN_READ_MS);
    paintPrompt("THANK YOU", target, "stop reading", false);
    // The duplex leg keeps listening until the player is done, so that the
    // played text is scored over its whole length and not over the reader's
    // window.
    if (options.duplex) await Promise.race([speakingEnded, after(60_000)]);
    await after(1500);

    out.heard = await source.stop();
    dictating = false;
    Object.assign(out, score(target, out.heard), meter.read());
    if (options.duplex) out.played = { text: playedText, ...score(playedText, out.heard) };
    out.ok = true;
  } catch (e) {
    out.error = String(e);
  } finally {
    if (dictating && source) {
      try {
        await source.cancel();
      } catch {
        // The stack the next leg builds is the one that matters.
      }
    }
    await listener?.unregister();
    await releaseDictationMicrophone();
    out.wallMs = Math.round(performance.now() - began);
  }
  return out;
}

/// `live` adds the leg that synthesises. It is off by default because it needs
/// a key and a network, and the fixture legs are the control that must keep
/// working without either.
/// A line on the device console, from the webview. `console.log` in a WKWebView
/// reaches nothing a cable can read, so it goes through the plugin and out of
/// NSLog, where `idevicesyslog -p 'Reading Partner'` picks it up. The arguments
/// besides `label` are only there because the probe's argument type requires
/// them. Never throws: a broken breadcrumb must not end a run.
async function note(text: string): Promise<void> {
  try {
    await invoke("plugin:voice|speech_probe", {
      args: { label: text, source: "trimmed", pace: "burst", fixtureDir: "", mode: "note" },
    });
  } catch {
    /* the run matters, the breadcrumb does not */
  }
}

export async function runSpeechProbe(
  options: { live?: boolean; echoOnly?: boolean; control?: boolean } = {},
): Promise<void> {
  // The control run is the short echo run with a person in it, so it inherits
  // every one of that run's decisions.
  const short = options.echoOnly || options.control;
  const result: SpeechResult = {
    ok: false,
    stage: "boot",
    fixtureDir: "",
    routes: null,
    legs: [],
    echo: [],
    interrupts: null,
    error: null,
    timestamp: new Date().toISOString(),
  };
  render(result);
  // Anything the run does not catch itself lands in the file rather than in a
  // console nobody is reading. Two device runs produced no file at all and
  // there was no way afterwards to tell a webview that never started from one
  // that threw on its first line.
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
    // Before anything else, and before the first thing that can hang: the file
    // existing at all is the answer to "did the webview ever run".
    await write(result);
    await note("webview up, stage=boot");
    await holdTheScreen();
    const data = await appDataDir();
    const fixtureDir = await join(data, "speech-fixture");
    const captureDir = await join(data, "speech");
    result.fixtureDir = fixtureDir;
    await mkdir(SPEECH_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });

    // First, while nothing is holding the audio session: which category options
    // the phone honours. It is the shortest leg and the one whose answer does
    // not depend on anything downstream of it, so it goes on disk before any of
    // the long ones can take the process with them.
    result.stage = "routes";
    render(result);
    await write(result);
    await note(`stage=${result.stage}`);
    try {
      result.routes = await invoke("plugin:voice|speech_probe", {
        args: {
          label: "routes",
          source: "trimmed",
          pace: "burst",
          fixtureDir: "",
          mode: "route",
        },
      });
    } catch (e) {
      result.routes = { error: String(e) };
    }
    await write(result);

    // `echoOnly` skips straight to the leg under investigation. The three
    // fixture legs are four minutes of phone time and they have passed in every
    // round; when the question is why the echo leg aborts, they are four minutes
    // of somebody standing next to a phone waiting for a known answer.
    for (const leg of short ? ECHO_ONLY_LEGS : LEGS) {
      result.stage = leg.label;
      render(result);
      await write(result);
      await note(`stage=${result.stage}`);
      result.legs.push(await runLeg(leg, fixtureDir, captureDir));
      // Between legs, so that the next one starts from a parked stack rather
      // than from one that is still coming to rest.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // The vendor leg here, ahead of the echo legs and not behind them. It is
    // after the fixture legs for the reason it always was — they are the control
    // and they answer without a network, so they are on disk before anything is
    // asked of the vendor — but `echo-vpio-off` aborts the process
    // (docs/pitfall/203) and everything behind it has never run. That is the
    // whole of why three rounds came back with no live leg: nothing was wrong
    // with the leg, the run died two stages in front of it.
    if (options.live && !short) {
      result.stage = "live";
      render(result);
      await write(result);
      await note(`stage=${result.stage}`);
      result.legs.push(await runLive(captureDir));
      // On disk before the leg that can take the process is started, rather than
      // at the top of the next stage.
      await write(result);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // The echo legs next: still no network, and they leave the stack in a known
    // state for everything after them.
    // Voice processing on before off, on the truth-table run. Four rounds have
    // read "the leg that tears the stack down first" as the reason the abort
    // happens, but that leg is also the only one that turns voice processing
    // off, and nothing has ever separated the two. This is the missing cell:
    // torn down and rebuilt, voice processing on. It goes first because the
    // other one takes the process with it.
    // The control run stops after the leg that works. `echo-vpio-off` is the
    // one that aborts the process (docs/pitfall/203) and it would take the two
    // human legs — the whole point of this run, and somebody's time — with it.
    for (const vpio of options.control ? [true] : short ? [true, false] : [false, true]) {
      result.stage = vpio ? "echo-vpio-on" : "echo-vpio-off";
      render(result);
      await write(result);
      await note(`stage=${result.stage}`);
      result.echo.push(await runEcho(vpio, fixtureDir, short ? 1 : ECHO_SENTENCES));
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // The positive control, and the only leg with a person in it. Last of the
    // echo legs, so that everything unattended is already on disk before
    // anybody is asked to do anything.
    if (options.control) {
      for (const duplex of [false, true]) {
        result.stage = duplex ? "echo-human-duplex" : "echo-human";
        render(result);
        await write(result);
        await note(`stage=${result.stage}`);
        result.echo.push(await runHuman(fixtureDir, { duplex, played: 2 }));
        await write(result);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }

    // The interruption loop last: it is the leg that can take the process with
    // it, and everything before it is already on disk by then.
    if (short) {
      result.ok = result.echo.every((leg) => leg.ok);
      result.stage = "done";
      render(result);
      await write(result);
      await note(`stage=${result.stage}`);
      return;
    }

    result.stage = "interrupt";
    render(result);
    await write(result);
    await note(`stage=${result.stage}`);
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

    result.ok = result.legs.every((leg) => leg.ok) && result.echo.every((leg) => leg.ok);
    result.stage = "done";
  } catch (e) {
    result.error = String(e);
  }
  render(result);
  await write(result);
  await note(`stage=${result.stage}`);
}
