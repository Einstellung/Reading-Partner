// The two dictation measurements that need a human voice, as a screen a person
// can follow (VITE_SMOKE=dictation-guided). main.tsx runs this instead of
// mounting the app, so a normal build never loads the chunk.
//
// Why guided rather than "open the app and hold the bar": both numbers are
// timings, and a person cannot hold a button for exactly 2.5 seconds or tell
// anyone when they let go. So the page drives the real composer bar with
// synthesised pointer events on a fixed schedule and the person only reads
// aloud when told. Every hold below goes through the shipped HoldToTalk, its
// reducer and its effects; the pointer events and the pointer-capture stub are
// the only fakes, exactly as in dictation.ts.
//
// What it answers:
//   1. The level curve. `quietDb`/`loudDb` in DictationRun.swift had never heard
//      a voice before this — only a loudspeaker across a desk, which the
//      voice-processing unit treats differently on purpose. The numbers come
//      out of the plugin's own `RP-DICT level rms=… db=…` console lines, which
//      is why nothing here records levels itself.
//   2. FINISH_TIMEOUT_MS, timed from the synthetic pointerup to the bar
//      delivering its text. Only the holds that still had a final arriving at
//      release count towards it; the rest were finished settling before the
//      finger came up and measure the cost of flushing nothing.
//
// Both were answered by the first run, on 2026-08-17: eleven holds, one person
// hand-holding at 0.5-0.8 m in a quiet empty room. What it did not answer is
// anything about Chinese — see `read` below.
//
// The first tap is load-bearing beyond starting the run: the screen wake lock
// is refused without user activation, and without it the phone locks two
// minutes in and takes the rest of the script with it (docs/pitfall/141).

import { mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { holdTheScreen } from "./wake-lock";
import { hasOnDeviceDictation } from "../ai/voice/dictation";

export const GUIDED_RESULT_DIR = "smoke";
export const GUIDED_RESULT_FILE = "smoke/dictation-guided.json";

interface Hold {
  id: string;
  /// Which language the person is asked to read, and nothing more. It does NOT
  /// reach the recogniser: HoldToTalk takes a glossary and no locale, so every
  /// hold below runs on whatever `Locale.preferredLanguages` resolves to. The
  /// first run of this script asked for five zh-CN holds and got five holds of
  /// Chinese speech decoded by the en-US model — "注意力机制取代了循环结构" came
  /// back as "2 E D, teacher, Chidalo, Shun.", which is docs/33's "cross-language
  /// decoding is total, not degraded" arriving by accident.
  ///
  /// To measure zh-CN through this bar, the device's own preferred language has
  /// to be Chinese. Passing a locale would mean giving HoldToTalk a prop the
  /// composer has no use for yet.
  read: "en-US" | "zh-CN";
  holdMs: number;
  /// Shown in large type. Reading is easier than improvising and keeps every
  /// hold the same length of speech.
  say: string;
  /// The meter calibration hold, which is about level rather than latency.
  calibration?: boolean;
}

interface HoldResult {
  index: number;
  id: string;
  read: string;
  holdMs: number;
  /// Device epoch ms, so a hold can be lined up against the console's level
  /// lines. Holds run strictly in order, so the Nth `RP-DICT start` is this one.
  pressedAtEpoch: number;
  releasedAtEpoch: number;
  /// pointerup -> the bar delivering. This is what FINISH_TIMEOUT_MS bounds.
  releaseToDeliveryMs: number | null;
  sent: string | null;
  inserted: string | null;
  hint: string | null;
  error: string | null;
}

export interface GuidedResult {
  ok: boolean;
  stage: string;
  wakeLock: string;
  hasOnDeviceDictation: boolean;
  startedAtEpoch: number;
  holds: HoldResult[];
  error: string | null;
}

const EN_SHORT = "Attention is all you need.";
const EN_LONG =
  "The transformer replaced recurrence with self attention, so the model reads a whole sentence at once instead of one word after another. That single change is what made it possible to train on far more text than before.";
const ZH_SHORT = "注意力机制取代了循环结构。";
const ZH_LONG =
  "注意力机制取代了循环结构，模型可以一次读完整句话，而不是一个词一个词地往下走。正是这一个改动，让它能够在远比过去更多的文本上训练。";

// One calibration hold, then five per language: three short, two long. The
// short ones are 2.5 s because that is the length the flush timeout was written
// against; the long ones are 15 s because a long hold is where a flush has the
// most left to settle.
const SCRIPT: Hold[] = [
  { id: "calibrate", read: "en-US", holdMs: 5000, say: EN_SHORT, calibration: true },
  { id: "en-short-1", read: "en-US", holdMs: 2500, say: EN_SHORT },
  { id: "en-short-2", read: "en-US", holdMs: 2500, say: EN_SHORT },
  { id: "en-short-3", read: "en-US", holdMs: 2500, say: EN_SHORT },
  { id: "en-long-1", read: "en-US", holdMs: 15000, say: EN_LONG },
  { id: "en-long-2", read: "en-US", holdMs: 15000, say: EN_LONG },
  { id: "zh-short-1", read: "zh-CN", holdMs: 2500, say: ZH_SHORT },
  { id: "zh-short-2", read: "zh-CN", holdMs: 2500, say: ZH_SHORT },
  { id: "zh-short-3", read: "zh-CN", holdMs: 2500, say: ZH_SHORT },
  { id: "zh-long-1", read: "zh-CN", holdMs: 15000, say: ZH_LONG },
  { id: "zh-long-2", read: "zh-CN", holdMs: 15000, say: ZH_LONG },
];

const COUNTDOWN_MS = 3000;
const REST_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- the screen --------------------------------------------------------------

interface Screen {
  banner: HTMLDivElement;
  step: HTMLDivElement;
  script: HTMLDivElement;
  clock: HTMLDivElement;
  bar: HTMLDivElement;
}

function build(): Screen {
  const root = document.getElementById("root") as HTMLElement;
  root.innerHTML = "";
  root.style.cssText =
    "font:16px/1.5 -apple-system,system-ui,sans-serif;color:#111;background:#fff;" +
    "min-height:100vh;display:flex;flex-direction:column;padding:20px 18px 24px;gap:14px";

  const banner = document.createElement("div");
  banner.style.cssText = "font-size:30px;font-weight:800;letter-spacing:-0.02em;min-height:38px";

  const step = document.createElement("div");
  step.style.cssText = "font-size:15px;color:#666";

  const script = document.createElement("div");
  script.style.cssText =
    "flex:1;display:flex;align-items:center;font-size:26px;line-height:1.35;font-weight:600";

  const clock = document.createElement("div");
  clock.style.cssText = "font-size:44px;font-weight:800;font-variant-numeric:tabular-nums";

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex";

  root.append(banner, step, script, clock, bar);
  return { banner, step, script, clock, bar };
}

function paint(
  s: Screen,
  banner: string,
  colour: string,
  step: string,
  script: string,
  clock: string,
): void {
  s.banner.textContent = banner;
  s.banner.style.color = colour;
  s.step.textContent = step;
  s.script.textContent = script;
  s.clock.textContent = clock;
}

// A synthesised pointer id is not a live pointer, so setPointerCapture throws
// NotFoundError and would abort the handler before it dispatched `down`.
function stubPointerCapture(): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.setPointerCapture = function () {};
  proto.releasePointerCapture = function () {};
}

function pointer(el: Element, type: string, x: number, y: number): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

async function write(result: GuidedResult): Promise<void> {
  try {
    await mkdir(GUIDED_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(GUIDED_RESULT_FILE, JSON.stringify(result, null, 2));
  } catch {
    // The console still has every timing; a failed write is not worth stopping
    // a person who is standing there talking.
  }
}

// --- the run -----------------------------------------------------------------

export async function runGuidedDictation(): Promise<void> {
  const screen = build();
  const result: GuidedResult = {
    ok: false,
    stage: "waiting",
    wakeLock: "not asked",
    hasOnDeviceDictation: hasOnDeviceDictation(),
    startedAtEpoch: 0,
    holds: [],
    error: null,
  };

  const [React, ReactDOM, mod] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../ui/components/chat/HoldToTalk"),
  ]);

  // One bar for the whole run, mounted once, exactly as the composer mounts it.
  let onDelivered: ((kind: "sent" | "inserted" | "hint", text: string) => void) | null = null;
  const barHost = document.createElement("div");
  barHost.style.cssText = "flex:1;min-width:0";
  screen.bar.appendChild(barHost);
  ReactDOM.createRoot(barHost).render(
    React.createElement(mod.HoldToTalk, {
      onSend: (t: string) => onDelivered?.("sent", t),
      onInsert: (t: string) => onDelivered?.("inserted", t),
      onHint: (m: string | null) => {
        if (m !== null) onDelivered?.("hint", m);
      },
    }),
  );
  await sleep(300);
  stubPointerCapture();

  const button = barHost.querySelector("button");
  if (!button) {
    result.error = "the hold bar did not render a button";
    await write(result);
    paint(screen, "Something is wrong", "#c00", "", result.error, "");
    return;
  }

  // --- wait for the tap that grants the wake lock ---------------------------
  const begin = document.createElement("button");
  begin.textContent = "Tap here to begin";
  begin.style.cssText =
    "width:100%;padding:22px;font-size:22px;font-weight:700;border-radius:16px;border:0;" +
    "background:#111;color:#fff";
  screen.clock.replaceWith(begin);
  paint(
    screen,
    "Ready",
    "#111",
    `${SCRIPT.length} holds, about two and a half minutes.`,
    "Hold the phone the way you normally would — about an arm's length from your mouth. Read each line out loud at a normal speaking volume when the screen turns green.",
    "",
  );

  // Written before anyone touches the phone, so the host can tell "the screen is
  // up and waiting" from "the chunk threw and the phone is showing white" —
  // there is no way to see the screen from here (iOS 26 moved the screenshot
  // service behind the personalised developer image, which libimobiledevice
  // cannot mount), and a person should not be called over to find out.
  result.stage = "waiting-for-tap";
  await write(result);

  await new Promise<void>((resolve) => {
    begin.addEventListener("click", () => resolve(), { once: true });
  });
  begin.replaceWith(screen.clock);

  result.wakeLock = await holdTheScreen();
  result.startedAtEpoch = Date.now();
  result.stage = "running";
  await write(result);

  const box = button.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;

  for (let i = 0; i < SCRIPT.length; i++) {
    const hold = SCRIPT[i];
    const language = hold.read === "zh-CN" ? "中文" : "English";
    const label = `${i + 1} of ${SCRIPT.length} · ${language}${
      hold.calibration ? " · meter check" : ""
    }`;

    // Countdown.
    for (let left = Math.ceil(COUNTDOWN_MS / 1000); left > 0; left--) {
      paint(screen, "Get ready", "#b45309", label, hold.say, String(left));
      await sleep(1000);
    }

    // The hold itself.
    let delivered: { kind: string; text: string } | null = null;
    const settled = new Promise<void>((resolve) => {
      onDelivered = (kind, text) => {
        delivered = { kind, text };
        resolve();
      };
    });

    const pressedAtEpoch = Date.now();
    pointer(button, "pointerdown", cx, cy);

    const seconds = Math.ceil(hold.holdMs / 1000);
    for (let elapsed = 0; elapsed < seconds; elapsed++) {
      paint(
        screen,
        hold.calibration ? "SPEAK — watch the bars" : "SPEAK NOW",
        "#15803d",
        label,
        hold.say,
        String(seconds - elapsed),
      );
      await sleep(1000);
    }

    const releasedAtEpoch = Date.now();
    const released = performance.now();
    pointer(button, "pointerup", cx, cy);
    paint(screen, "Stop", "#111", label, hold.say, "");

    await Promise.race([settled, sleep(8000)]);
    const releaseToDeliveryMs = +(performance.now() - released).toFixed(1);
    onDelivered = null;

    const d = delivered as { kind: string; text: string } | null;
    result.holds.push({
      index: i,
      id: hold.id,
      read: hold.read,
      holdMs: hold.holdMs,
      pressedAtEpoch,
      releasedAtEpoch,
      releaseToDeliveryMs: d ? releaseToDeliveryMs : null,
      sent: d?.kind === "sent" ? d.text : null,
      inserted: d?.kind === "inserted" ? d.text : null,
      hint: d?.kind === "hint" ? d.text : null,
      error: d ? null : "nothing was delivered within 8s",
    });
    result.stage = `done:${hold.id}`;
    await write(result);

    if (i < SCRIPT.length - 1) {
      paint(screen, "Good", "#111", label, d?.text ?? "", "");
      await sleep(REST_MS);
    }
  }

  result.ok = true;
  result.stage = "done";
  await write(result);
  paint(
    screen,
    "All done",
    "#15803d",
    `${result.holds.length} holds recorded.`,
    "You can put the phone down. Thank you.",
    "",
  );
}
