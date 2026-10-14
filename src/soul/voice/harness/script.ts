// A scripted conversation for the silent bench (docs/platform/560): which clip
// the "user" says next and when. The driver takes its cue from the marks the
// call itself produces (trace.ts), so it answers the AI the way a person would:
// after the reply has been heard, in the middle of it, or right after the
// previous clip.

import type { TraceMark } from "./trace";

/**
 * When a step's clip starts, counted from the end of the previous clip (or the
 * start of the script for the first step):
 *
 * - `reply-end`: the AI's reply has finished playing (`spoken`).
 * - `reply-start`: the AI has started playing (`speaking` 1) — for barge-in.
 * - `clip-end`: straight away.
 * - `next-reply-end`: a reply that starts after this step began waiting has
 *   finished, which is how "wait for the background result to be read out"
 *   is said: replies that were already under way when the step began do not
 *   count.
 */
export type StepStart = "reply-end" | "reply-start" | "clip-end" | "next-reply-end";

export interface ScriptStep {
  /** File name next to the script. */
  clip: string;
  /** What the clip says, for the record and the report. */
  text: string;
  start: StepStart;
  /** Wait this long after the cue before feeding. */
  offsetMs: number;
  /** Give up waiting for the cue after this long and feed anyway. */
  timeoutMs: number;
  /** What the clip is meant to do: start a turn, interrupt, or nothing (a backchannel). */
  expect: "turn" | "interrupt" | "none";
}

export interface VoiceScript {
  name: string;
  /** Recogniser locale for the run. */
  locale: string;
  steps: ScriptStep[];
  /** After the last clip: wait for this many replies to finish, up to `finalTimeoutMs`. */
  finalReplies: number;
  finalTimeoutMs: number;
  /** Then this long before hanging up. */
  tailMs: number;
}

const STARTS: StepStart[] = ["reply-end", "reply-start", "clip-end", "next-reply-end"];
const EXPECTS = ["turn", "interrupt", "none"] as const;

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Checks a script file and fills defaults. Throws with the step that is wrong. */
export function parseScript(raw: unknown): VoiceScript {
  if (!raw || typeof raw !== "object") throw new Error("A voice script is a JSON object.");
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name) throw new Error("A voice script needs a name.");
  if (typeof o.locale !== "string" || !o.locale) throw new Error(`${o.name}: no locale.`);
  if (!Array.isArray(o.steps) || o.steps.length === 0) throw new Error(`${o.name}: no steps.`);
  const steps = o.steps.map((s: unknown, i: number): ScriptStep => {
    const step = (s ?? {}) as Record<string, unknown>;
    if (typeof step.clip !== "string" || !step.clip.endsWith(".wav")) {
      throw new Error(`${o.name} step ${i}: clip must be a .wav file name.`);
    }
    const start = (step.start ?? "reply-end") as StepStart;
    if (!STARTS.includes(start)) throw new Error(`${o.name} step ${i}: unknown start ${String(start)}.`);
    const expect = (step.expect ?? "turn") as ScriptStep["expect"];
    if (!EXPECTS.includes(expect)) throw new Error(`${o.name} step ${i}: unknown expect ${String(expect)}.`);
    return {
      clip: step.clip,
      text: typeof step.text === "string" ? step.text : "",
      start,
      offsetMs: num(step.offsetMs, start === "reply-end" ? 800 : 0),
      timeoutMs: num(step.timeoutMs, 90_000),
      expect,
    };
  });
  return {
    name: o.name,
    locale: o.locale,
    steps,
    finalReplies: num(o.finalReplies, 1),
    finalTimeoutMs: num(o.finalTimeoutMs, 90_000),
    tailMs: num(o.tailMs, 1500),
  };
}

export interface DriverDeps {
  /** Every trace mark from here on, in order. Answers an unsubscribe. */
  subscribe(cb: (mark: TraceMark) => void): () => void;
  /** Play one clip into the call; resolves when its last sample is in. */
  feed(clip: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** A driver row in the run's log. */
  mark(name: string, data?: Record<string, unknown>): void;
}

export interface StepOutcome {
  index: number;
  clip: string;
  /** False when the cue never came and the clip was fed on timeout. */
  cued: boolean;
}

const isReplyEnd = (m: TraceMark) => m.name === "conv:spoken";
const isReplyStart = (m: TraceMark) => m.name === "speech:speaking" && m.data?.value === 1;

/**
 * Runs the script against the live call. The call must already be up; the
 * first step's cue counts from the moment this is called, so a `reply-end`
 * first step waits for the call's opening line.
 */
export async function runScript(script: VoiceScript, deps: DriverDeps): Promise<StepOutcome[]> {
  const seen: TraceMark[] = [];
  const waiters = new Set<{ since: number; pred: (m: TraceMark) => boolean; done: () => void }>();
  const off = deps.subscribe((m) => {
    seen.push(m);
    const at = seen.length - 1;
    for (const w of [...waiters]) {
      if (at >= w.since && w.pred(m)) {
        waiters.delete(w);
        w.done();
      }
    }
  });

  /** Resolves true on the first match at or after `since`, false on timeout. */
  const waitFor = (pred: (m: TraceMark) => boolean, since: number, timeoutMs: number) => {
    for (let i = since; i < seen.length; i++) if (pred(seen[i])) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const w = { since, pred, done: () => resolve(true) };
      waiters.add(w);
      void deps.sleep(timeoutMs).then(() => {
        if (waiters.delete(w)) resolve(false);
      });
    });
  };

  /** `next-reply-end`: a reply that started after `since`, then its end. */
  const waitNextReply = async (since: number, timeoutMs: number) => {
    const started = await waitFor(isReplyStart, since, timeoutMs);
    if (!started) return false;
    const startIdx = seen.findIndex((m, i) => i >= since && isReplyStart(m));
    return waitFor(isReplyEnd, startIdx + 1, timeoutMs);
  };

  const outcomes: StepOutcome[] = [];
  let cursor = 0;
  try {
    for (const [index, step] of script.steps.entries()) {
      deps.mark("step-wait", { index, clip: step.clip, start: step.start });
      let cued = true;
      if (step.start === "reply-end") cued = await waitFor(isReplyEnd, cursor, step.timeoutMs);
      else if (step.start === "reply-start") cued = await waitFor(isReplyStart, cursor, step.timeoutMs);
      else if (step.start === "next-reply-end") cued = await waitNextReply(seen.length, step.timeoutMs);
      if (!cued) deps.mark("step-timeout", { index, clip: step.clip });
      if (step.offsetMs > 0) await deps.sleep(step.offsetMs);
      deps.mark("step-feed", { index, clip: step.clip, text: step.text, expect: step.expect });
      await deps.feed(step.clip);
      cursor = seen.length;
      deps.mark("step-fed", { index, clip: step.clip });
      outcomes.push({ index, clip: step.clip, cued });
    }
    let since = cursor;
    for (let i = 0; i < script.finalReplies; i++) {
      const ok = await waitFor(isReplyEnd, since, script.finalTimeoutMs);
      if (!ok) {
        deps.mark("final-timeout", { reply: i });
        break;
      }
      since = seen.findIndex((m, j) => j >= since && isReplyEnd(m)) + 1;
    }
    await deps.sleep(script.tailMs);
  } finally {
    off();
  }
  return outcomes;
}
