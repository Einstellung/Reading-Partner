// Unattended on-device dictation check. Activated only in a dedicated smoke
// build (VITE_SMOKE=dictation); main.tsx runs it instead of mounting the app,
// so a normal build never loads this chunk.
//
// It exists because the voice plugin cannot be exercised any other way from a
// build machine. SpeechTranscriber.isAvailable is false on the simulator, and a
// hold is a finger on a screen — nothing in the toolchain presses it. So the
// check drives the real composer bar with synthesised pointer events and drives
// the real DictationSource directly, and writes every event, every timing and
// every transcript to a JSON file the host reads back out of the app container.
//
// Everything under test is production code: nativeDictation(), the three
// commands, the plugin listener, holdReducer, and HoldToTalk itself. The only
// fakes are the pointer events and the pointer-capture stub, because a
// synthesised pointer id is not a live pointer and setPointerCapture rejects it.
//
// Speech comes from the room. The host watches the device console for this
// module's own markers and plays a phrase over a speaker while the microphone
// is open; each scenario names the phrase it expects to hear.

import { mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { holdTheScreen } from "./wake-lock";
import {
  hasOnDeviceDictation,
  nativeDictation,
  releaseDictationMicrophone,
  type DictationEvent,
} from "../ai/voice/dictation";

export const DICTATION_RESULT_DIR = "smoke";
export const DICTATION_RESULT_FILE = "smoke/dictation-result.json";

interface Stamped {
  t: number;
  e: DictationEvent;
}

interface Scenario {
  name: string;
  // BCP-47 for the recogniser, and the host's cue for which phrase to play.
  // Absent means "let the native side pick from the device's preferences",
  // which is what the composer's bar does.
  locale?: string;
  // Hot words. They are also the second half of the host's cue: the plugin logs
  // how many it got, so a run with none is a run the host stays quiet for.
  contextualStrings?: string[];
  holdMs: number;
  // Filled as it runs.
  startMs?: number;
  stopMs?: number;
  firstEventMs?: number;
  firstLevelMs?: number;
  firstVolatileMs?: number;
  firstFinalMs?: number;
  // pointerup -> the stop promise settling, which is the number
  // FINISH_TIMEOUT_MS has to cover.
  releaseToAnswerMs?: number;
  transcript?: string;
  streamed?: string;
  events?: Stamped[];
  levels?: number[];
  error?: string | null;
  note?: string;
}

export interface DictationSmokeResult {
  ok: boolean;
  stage: string;
  wakeLock: string;
  hasOnDeviceDictation: boolean;
  userAgent: string;
  scenarios: Scenario[];
  barDriven: unknown[];
  error: string | null;
  timestamp: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A real hold keeps the screen awake by itself — a finger on the glass resets
// the idle timer. A synthesised pointer event does not, so without the shared
// wake lock the phone locks two minutes in, the app is backgrounded, the
// microphone route goes to [] with no interruption notification, and the
// webview's timers stop: the script freezes mid-hold and never writes another
// line.

// A marker the host can see in the device console in real time. console.log
// does not reach the syslog from WKWebView, but every plugin command does — so
// the cue the host plays speech against is the plugin's own "RP-DICT running"
// line, and these are only for the JSON.
function note(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`[dictation-smoke] ${line}`);
}

async function runScenario(s: Scenario): Promise<Scenario> {
  const events: Stamped[] = [];
  const source = nativeDictation({
    locale: s.locale,
    contextualStrings: s.contextualStrings,
  });
  if (!source) {
    s.error = "nativeDictation() returned null";
    return s;
  }

  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(1);

  try {
    await source.start((e) => {
      const t = at();
      events.push({ t, e });
      if (s.firstEventMs === undefined) s.firstEventMs = t;
      if (e.kind === "level" && s.firstLevelMs === undefined) s.firstLevelMs = t;
      if (e.kind === "volatile" && s.firstVolatileMs === undefined) s.firstVolatileMs = t;
      if (e.kind === "final" && s.firstFinalMs === undefined) s.firstFinalMs = t;
    });
    s.startMs = at();
  } catch (e) {
    s.startMs = at();
    s.error = String((e as Error)?.message ?? e);
    s.events = events;
    return s;
  }

  await sleep(s.holdMs);

  const released = performance.now();
  s.stopMs = at();
  try {
    s.transcript = await source.stop();
  } catch (e) {
    s.error = String((e as Error)?.message ?? e);
  }
  s.releaseToAnswerMs = +(performance.now() - released).toFixed(1);

  s.events = events;
  s.levels = events.filter((x) => x.e.kind === "level").map((x) => (x.e as { value: number }).value);
  s.streamed = fold(events);
  return s;
}

// applyDictationEvent + transcriptText, folded here so the file can record what
// the composer's own timeout path would have produced from the same stream and
// the native answer can be compared against it.
const CJK = /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/;
function join(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const seam =
    /\s$/.test(left) || /^\s/.test(right) || CJK.test(left.slice(-1)) || CJK.test(right[0])
      ? ""
      : " ";
  return left + seam + right;
}
function fold(events: Stamped[]): string {
  const finals: string[] = [];
  let tail = "";
  for (const { e } of events) {
    // Neither carries words: a level is a number and a timing is the press's
    // segments, which this harness records nothing about.
    if (e.kind === "level" || e.kind === "timing") continue;
    const text = e.text.trim();
    if (e.kind === "final") {
      if (text) finals.push(text);
      tail = "";
    } else {
      tail = text;
    }
  }
  return [...finals, tail].reduce(join, "").trim();
}

// A tap: start, then cancel as soon as the start resolves. This is what the
// composer does for any press the finger leaves before the recognizer is up,
// and it is the cheapest way to leave a wedged audio session behind.
async function tap(): Promise<{ ms: number; error: string | null }> {
  const t0 = performance.now();
  const source = nativeDictation({});
  if (!source) return { ms: 0, error: "nativeDictation() returned null" };
  try {
    await source.start(() => {});
    await source.cancel();
    return { ms: +(performance.now() - t0).toFixed(1), error: null };
  } catch (e) {
    return { ms: +(performance.now() - t0).toFixed(1), error: String((e as Error)?.message ?? e) };
  }
}

// A start issued while the previous stop is still flushing. The composer's
// flush timeout makes this routine rather than exotic: it nulls its source and
// permits a new hold without waiting for the old answer.
async function overlappingStart(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const first = nativeDictation({});
  const second = nativeDictation({});
  if (!first || !second) return { error: "nativeDictation() returned null" };

  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(1);
  try {
    await first.start(() => {});
    await sleep(2000);
    // Deliberately not awaited: the point is to start again while this is in
    // flight, which is exactly what the composer does after a flush timeout.
    const pending = first.stop().then(
      (text) => ({ ok: true, text, at: at() }),
      (e) => ({ ok: false, error: String((e as Error)?.message ?? e), at: at() }),
    );
    out.secondStartIssuedAt = at();
    let secondOk = true;
    let secondError: string | null = null;
    try {
      await second.start(() => {});
    } catch (e) {
      secondOk = false;
      secondError = String((e as Error)?.message ?? e);
    }
    out.secondStartResolvedAt = at();
    out.secondStartOk = secondOk;
    out.secondStartError = secondError;
    out.firstStop = await pending;
    if (secondOk) {
      await sleep(1500);
      out.secondStop = await second.stop().catch((e) => ({ error: String(e) }));
    }
  } catch (e) {
    out.error = String((e as Error)?.message ?? e);
  }
  return out;
}

// --- the composer's own bar -------------------------------------------------

// A synthesised pointer id is not a live pointer, so setPointerCapture throws
// NotFoundError and would abort the handler before it dispatched `down`. The
// two capture calls are the only thing stubbed; everything the bar does after
// them is the shipped path.
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

/// Mounts the real composer bar and holds it. Resolves with whatever the bar
/// decided to do with the words.
async function holdTheBar(holdMs: number, glossary?: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { holdMs, glossary: glossary ?? null };
  const [React, ReactDOM, mod] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("../ui/components/chat/HoldToTalk"),
  ]);

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;right:0;bottom:0;padding:12px;background:#fff";
  document.body.appendChild(host);

  let sent: string | null = null;
  let inserted: string | null = null;
  let hint: string | null = null;
  const settled = new Promise<void>((resolve) => {
    const finish = () => setTimeout(resolve, 0);
    const root = ReactDOM.createRoot(host);
    root.render(
      React.createElement(mod.HoldToTalk, {
        glossary,
        onSend: (t: string) => {
          sent = t;
          finish();
        },
        onInsert: (t: string) => {
          inserted = t;
          finish();
        },
        onHint: (m: string | null) => {
          if (m !== null) {
            hint = m;
            finish();
          }
        },
      }),
    );
  });

  await sleep(300);
  const button = host.querySelector("button");
  if (!button) {
    out.error = "the hold bar did not render a button";
    return out;
  }
  stubPointerCapture();

  const box = button.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;

  const t0 = performance.now();
  pointer(button, "pointerdown", cx, cy);
  await sleep(holdMs);
  const released = performance.now();
  pointer(button, "pointerup", cx, cy);

  await Promise.race([settled, sleep(8000)]);
  out.sent = sent;
  out.inserted = inserted;
  out.hint = hint;
  out.releaseToDeliveryMs = +(performance.now() - released).toFixed(1);
  out.totalMs = +(performance.now() - t0).toFixed(1);
  host.remove();
  return out;
}

// --- the script -------------------------------------------------------------

// The host cannot see this file while it runs, so the cue it plays speech
// against is what the plugin logs at the top of every start: the locale and the
// number of hot words. The locale picks the language, the count picks the
// length — a six-second passage played into a two-second hold measures nothing
// — and a run with no locale and no hot words is a run that wants silence.
const EN = { locale: "en-US", contextualStrings: ["Transformer"] };
const ZH = { locale: "zh-CN", contextualStrings: ["注意力", "机器之心"] };
const EN_LONG = { locale: "en-US", contextualStrings: ["Transformer", "attention", "recurrence"] };
const ZH_LONG = {
  locale: "zh-CN",
  contextualStrings: ["注意力", "机器之心", "循环结构", "自注意力"],
};

function script(): Scenario[] {
  const list: Scenario[] = [
    { name: "silent-5s", holdMs: 5000 },
    { name: "en-long", ...EN_LONG, holdMs: 14000 },
    { name: "zh-long", ...ZH_LONG, holdMs: 14000 },
    { name: "en-short", ...EN, holdMs: 3000 },
    { name: "zh-short", ...ZH, holdMs: 3000 },
  ];
  // More of each length, for the release-to-answer distribution.
  for (let i = 0; i < 2; i++) {
    list.push({ name: `en-2s-${i}`, ...EN, holdMs: 2500 });
    list.push({ name: `zh-2s-${i}`, ...ZH, holdMs: 2500 });
  }
  list.push({ name: "en-15s", ...EN_LONG, holdMs: 15000 });
  list.push({ name: "zh-15s", ...ZH_LONG, holdMs: 15000 });
  return list;
}

async function write(result: DictationSmokeResult): Promise<void> {
  try {
    await mkdir(DICTATION_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(DICTATION_RESULT_FILE, JSON.stringify(result, null, 2));
  } catch (e) {
    note(`writing the result failed: ${String(e)}`);
  }
}

function render(result: DictationSmokeResult): void {
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
  head.textContent = result.ok ? "DICTATION SMOKE DONE" : `RUNNING — ${result.stage}`;
  box.appendChild(head);
  const pre = document.createElement("pre");
  pre.style.cssText = "white-space:pre-wrap;font-size:11px;margin:0";
  pre.textContent = JSON.stringify(result, null, 2);
  box.appendChild(pre);
  root.appendChild(box);
}

export async function runDictationSmoke(): Promise<void> {
  const result: DictationSmokeResult = {
    ok: false,
    stage: "start",
    wakeLock: "not asked",
    hasOnDeviceDictation: hasOnDeviceDictation(),
    userAgent: navigator.userAgent,
    scenarios: [],
    barDriven: [],
    error: null,
    timestamp: new Date().toISOString(),
  };
  render(result);

  const save = async (stage: string) => {
    result.stage = stage;
    render(result);
    await write(result);
  };

  try {
    result.wakeLock = await holdTheScreen();
    note(`wake lock: ${result.wakeLock}`);
    await save("wake-lock");

    // 1. A stray tap, then a normal hold. If the teardown leaves the session
    //    wedged, the hold after it fails with !rec or a zero sample rate.
    await save("tap");
    const first = await tap();
    result.scenarios.push({
      name: "stray-tap",
      holdMs: 0,
      startMs: first.ms,
      error: first.error,
      note: "start immediately followed by cancel",
    });
    await save("tap-done");
    await sleep(1000);

    await save("after-tap-hold");
    result.scenarios.push(
      await runScenario({
        name: "hold-after-tap",
        ...EN,
        holdMs: 8000,
        note: "the hold that proves the stray tap left a healthy session",
      }),
    );
    await save("after-tap-hold-done");

    // 2. The composer's own bar, twice: once with speech, once silent. First,
    //    because this is the path that has to be shown working and the phone
    //    can auto-lock out from under the rest of the script.
    //    A glossary of one line is the cue for the host to speak English; the
    //    second pass has none, so the room stays quiet and the bar has to
    //    produce its own "No speech detected." line.
    await sleep(1200);
    await save("bar-driven");
    result.barDriven.push(await holdTheBar(9000, "Transformer"));
    await save("bar-driven-1-done");
    await sleep(1200);
    result.barDriven.push(await holdTheBar(3000));
    await save("bar-driven-2-done");

    // 3. A start while the previous stop is still flushing.
    await sleep(1200);
    await save("overlapping-start");
    (result as unknown as Record<string, unknown>).overlapping = await overlappingStart();
    await save("overlapping-start-done");

    // 4. The scripted holds, longest tail last.
    for (const s of script()) {
      await sleep(1200);
      await save(`scenario:${s.name}`);
      result.scenarios.push(await runScenario(s));
      await save(`scenario:${s.name}:done`);
    }

    result.ok = true;
    await save("done");
  } catch (e) {
    result.error = String((e as Error)?.message ?? e);
    await save("failed");
  } finally {
    // The plugin keeps the microphone standing between holds, which is what the
    // product does and what this script is here to exercise. Nothing above ends
    // a voice mode, so without this the script leaves the orange indicator lit
    // on a phone nobody is holding.
    await releaseDictationMicrophone();
  }
}
