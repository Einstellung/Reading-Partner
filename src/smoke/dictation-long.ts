// The long hold (VITE_SMOKE=dictation-long). Not a dictation question:
// hold-to-talk has a five-minute backstop and no business running this long.
// This is the gate for the rehearsal feature, where someone talks against a deck
// and the AI critiques the delivery — so what it asks is whether SpeechAnalyzer
// survives a long span at all, whether finals keep arriving or the stream goes
// quiet partway, and whether anything grows without bound.
//
// It drives nativeDictation directly rather than the bar. Rehearsal will not be
// a held button, and the bar's overlay re-renders on every level event would be
// noise in a twenty-minute memory reading.
//
// The tap gate is the wake lock's user activation, same as dictation-guided:
// without it the phone locks two minutes in and the run dies backgrounded with
// no interruption notification (docs/pitfall/162).
//
// Memory, thermal state and the native accumulator's size come from the
// plugin's own console lines, which exist only in the measurement build.
//
// It writes as it goes, one appended line per event, because the failure it is
// built to detect is the one that gets no callback. A run held in memory and
// flushed at the end reports nothing at all when the thing it was watching for
// happens: no samples, no timeline, not even the minute it died in. jetsam does
// not send `beforeunload`, and neither does a watchdog kill.
//
// Appending rather than rewriting matters for the same reason. A rewrite of the
// whole document is a window in which the file is neither the old state nor the
// new one; an append that has returned from the IPC is already in the file, and
// survives SIGKILL because the loss would need the page cache to go with it.
// Every record carries a wall clock, so a gap reads as a gap rather than as an
// absence.

import { mkdir, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { writeTextAtomic } from "../platform/app/atomic-fs";
import { holdTheScreen } from "./wake-lock";
import { nativeDictation, type DictationEvent } from "../ai/voice/dictation";

export const LONG_RESULT_DIR = "smoke";
export const LONG_RESULT_FILE = "smoke/dictation-long.json";
/// The durable record. One JSON object per line, appended, never rewritten.
export const LONG_JOURNAL_FILE = "smoke/dictation-long.jsonl";

// Six minutes, not twenty. With the journal there is no such thing as a wasted
// run — a session that dies at minute four is four minutes of data — so the
// length only has to be long enough for a slope to show. Flat memory and finals
// still arriving across six minutes is most of the signal; extend it once the
// harness has proved it can report its own death.
const RUN_MS = 6 * 60 * 1000;
const SAMPLE_MS = 15 * 1000;

interface Sample {
  atMs: number;
  finals: number;
  volatiles: number;
  levels: number;
  /// Characters in the fold of everything streamed so far. The native
  /// accumulator is the same text; this is the only view of it before stop.
  streamedChars: number;
  /// Wall gap since the previous final, so a stream that goes quiet shows up as
  /// a growing number rather than as an absence nobody notices.
  msSinceLastFinal: number;
}

export interface LongResult {
  ok: boolean;
  stage: string;
  wakeLock: string;
  startedAtEpoch: number;
  plannedMs: number;
  samples: Sample[];
  finalsTimeline: { atMs: number; chars: number }[];
  startError: string | null;
  stopError: string | null;
  releaseToAnswerMs: number | null;
  transcriptChars: number | null;
  streamedChars: number | null;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// One line, appended, flushed before the next thing happens. Failures are
// swallowed: a run that cannot write is still worth watching in the console, and
// throwing here would end the very session under test.
async function journal(record: Record<string, unknown>): Promise<void> {
  try {
    await writeTextFile(LONG_JOURNAL_FILE, JSON.stringify({ wall: Date.now(), ...record }) + "\n", {
      baseDir: BaseDirectory.AppData,
      append: true,
    });
  } catch {
    // Nothing to do about it from inside the run.
  }
}

async function write(result: LongResult): Promise<void> {
  try {
    await mkdir(LONG_RESULT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextAtomic(LONG_RESULT_FILE, JSON.stringify(result, null, 2));
  } catch {
    // The console carries the same story; a failed write does not stop a run
    // that is twenty minutes long.
  }
}

export async function runLongDictation(): Promise<void> {
  const root = document.getElementById("root") as HTMLElement;
  root.innerHTML = "";
  root.style.cssText =
    "font:16px/1.6 -apple-system,system-ui,sans-serif;color:#111;background:#fff;" +
    "min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:28px;gap:18px";

  const banner = document.createElement("div");
  banner.style.cssText = "font-size:30px;font-weight:800";
  const detail = document.createElement("div");
  detail.style.cssText = "font-size:17px;color:#444";
  const stats = document.createElement("pre");
  stats.style.cssText = "font-size:13px;color:#666;white-space:pre-wrap;margin:0";
  root.append(banner, detail, stats);

  const result: LongResult = {
    ok: false,
    stage: "waiting-for-tap",
    wakeLock: "not asked",
    startedAtEpoch: 0,
    plannedMs: RUN_MS,
    samples: [],
    finalsTimeline: [],
    startError: null,
    stopError: null,
    releaseToAnswerMs: null,
    transcriptChars: null,
    streamedChars: null,
    error: null,
  };

  banner.textContent = "Six-minute hold";
  detail.textContent =
    "Tap the button once, then put the phone down and leave it alone for about seven minutes. Nothing else to do.";
  const begin = document.createElement("button");
  begin.textContent = "Tap here to begin";
  begin.style.cssText =
    "width:100%;padding:24px;font-size:22px;font-weight:700;border-radius:16px;border:0;" +
    "background:#111;color:#fff";
  root.appendChild(begin);
  await write(result);

  await new Promise<void>((resolve) => {
    begin.addEventListener("click", () => resolve(), { once: true });
  });
  begin.remove();

  result.wakeLock = await holdTheScreen();
  result.startedAtEpoch = Date.now();
  result.stage = "running";
  await write(result);

  const source = nativeDictation({});
  if (!source) {
    result.error = "nativeDictation() returned null";
    result.stage = "failed";
    await write(result);
    banner.textContent = "Cannot run here";
    return;
  }

  let finals = 0;
  let volatiles = 0;
  let levels = 0;
  let lastFinalAt = 0;
  const settled: string[] = [];
  let tail = "";
  const t0 = performance.now();
  const at = () => performance.now() - t0;
  const fold = () => [...settled, tail].reduce(join, "").trim();

  const onEvent = (e: DictationEvent) => {
    if (e.kind === "level") {
      levels += 1;
      return;
    }
    const text = e.text.trim();
    if (e.kind === "final") {
      finals += 1;
      lastFinalAt = at();
      if (text) settled.push(text);
      tail = "";
      const record = { atMs: +lastFinalAt.toFixed(0), chars: text.length };
      result.finalsTimeline.push(record);
      // Character counts, not words, for the same reason the plugin logs counts
      // (docs/pitfall/165): this file is fetched off the phone and the question
      // is whether finals keep arriving, which a count answers.
      void journal({ kind: "final", index: finals, ...record });
    } else {
      volatiles += 1;
      tail = text;
    }
  };

  await journal({ kind: "start-issued", plannedMs: RUN_MS, wakeLock: result.wakeLock });
  try {
    await source.start(onEvent);
  } catch (e) {
    result.startError = String((e as Error)?.message ?? e);
    result.stage = "start-failed";
    await journal({ kind: "start-failed", error: result.startError });
    await write(result);
    banner.textContent = "Start failed";
    detail.textContent = result.startError;
    return;
  }
  await journal({ kind: "started", atMs: +at().toFixed(0) });
  lastFinalAt = at();

  banner.textContent = "Listening";
  const deadline = t0 + RUN_MS;
  while (performance.now() < deadline) {
    await sleep(Math.min(SAMPLE_MS, Math.max(0, deadline - performance.now())));
    const streamed = fold();
    result.samples.push({
      atMs: +at().toFixed(0),
      finals,
      volatiles,
      levels,
      streamedChars: streamed.length,
      msSinceLastFinal: +(at() - lastFinalAt).toFixed(0),
    });
    result.stage = `running:${Math.round(at() / 1000)}s`;
    // Journal first: the summary rewrite is the part that can be caught
    // half-written, and the sample is the thing worth keeping.
    await journal({ kind: "sample", ...result.samples[result.samples.length - 1] });
    await write(result);

    const mins = (at() / 60000).toFixed(1);
    detail.textContent = `${mins} of ${RUN_MS / 60000} minutes`;
    stats.textContent =
      `finals ${finals}   volatiles ${volatiles}   levels ${levels}\n` +
      `streamed ${streamed.length} chars\n` +
      `since last final ${Math.round((at() - lastFinalAt) / 1000)}s`;
  }

  banner.textContent = "Finishing";
  result.stage = "stopping";
  await journal({ kind: "stop-issued", atMs: +at().toFixed(0) });
  await write(result);

  const released = performance.now();
  try {
    const transcript = await source.stop();
    result.transcriptChars = transcript.length;
  } catch (e) {
    result.stopError = String((e as Error)?.message ?? e);
  }
  result.releaseToAnswerMs = +(performance.now() - released).toFixed(1);
  result.streamedChars = fold().length;
  result.ok = result.stopError === null;
  result.stage = "done";
  await journal({
    kind: "stopped",
    releaseToAnswerMs: result.releaseToAnswerMs,
    transcriptChars: result.transcriptChars,
    streamedChars: result.streamedChars,
    stopError: result.stopError,
  });
  await write(result);

  banner.textContent = result.ok ? "Done" : "Done, with an error";
  detail.textContent = `${result.transcriptChars ?? "?"} characters back in ${result.releaseToAnswerMs} ms`;
  stats.textContent = `finals ${finals}   volatiles ${volatiles}   levels ${levels}`;
}
