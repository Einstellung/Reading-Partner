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
 * - `long-reply`: a reply of at least `minChars` characters is playing, now or
 *   later — for barge-in. A cue or a one-line answer is over before a clip fed
 *   at its start + offset lands, so `reply-start` cannot aim at one.
 */
export type StepStart = "reply-end" | "reply-start" | "clip-end" | "next-reply-end" | "long-reply";

export interface ScriptStep {
  /** File name next to the script. */
  clip: string;
  /** What the clip says, for the record and the report. */
  text: string;
  /**
   * A trace mark (e.g. `front:notify`) that has to have happened, at any point
   * in the run; `start` then counts from it instead of from the previous clip.
   * How "once the front has asked whether to read the result" is said.
   */
  after?: string;
  start: StepStart;
  /** Wait this long after the cue before feeding. */
  offsetMs: number;
  /** Give up waiting for the cue after this long and feed anyway. */
  timeoutMs: number;
  /** What the clip is meant to do: start a turn, interrupt, or nothing (a backchannel). */
  expect: "turn" | "interrupt" | "none";
  /** `long-reply` only: how long the reply has to be, in characters pushed to speech. */
  minChars: number;
}

export interface VoiceScript {
  name: string;
  /** Recogniser locale for the run. */
  locale: string;
  steps: ScriptStep[];
  /** After the last clip: wait for this many replies to finish, up to `finalTimeoutMs`. */
  finalReplies: number;
  /** A trace mark the final replies are counted from (e.g. `front:read-out-start`). */
  finalAfter?: string;
  finalTimeoutMs: number;
  /** Then this long before hanging up. */
  tailMs: number;
  /**
   * Before a `turn` step whose cue came, wait up to this long for the call to
   * go quiet (see `CallState.quiet`) and stay so for `quietMs`, so a question
   * does not land on a result notice or on a reply that only paused. 0 is off.
   */
  settleMs: number;
  quietMs: number;
}

const STARTS: StepStart[] = ["reply-end", "reply-start", "clip-end", "next-reply-end", "long-reply"];
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
    if (step.after !== undefined && (typeof step.after !== "string" || !step.after)) {
      throw new Error(`${o.name} step ${i}: after must be a mark name.`);
    }
    return {
      clip: step.clip,
      text: typeof step.text === "string" ? step.text : "",
      ...(typeof step.after === "string" ? { after: step.after } : {}),
      start,
      offsetMs: num(step.offsetMs, start === "reply-end" ? 800 : 0),
      timeoutMs: num(step.timeoutMs, 90_000),
      expect,
      minChars: num(step.minChars, 50),
    };
  });
  return {
    name: o.name,
    locale: o.locale,
    steps,
    finalReplies: num(o.finalReplies, 1),
    ...(typeof o.finalAfter === "string" && o.finalAfter ? { finalAfter: o.finalAfter } : {}),
    finalTimeoutMs: num(o.finalTimeoutMs, 90_000),
    tailMs: num(o.tailMs, 1500),
    settleMs: num(o.settleMs, 60_000),
    quietMs: num(o.quietMs, 2000),
  };
}

/**
 * What the call is doing, read off its marks: whether anything is being said
 * or about to be, and how long the reply being said is.
 */
export class CallState {
  speaking = false;
  /** Model requests out, by turn. */
  readonly asking = new Set<number>();
  /** Utterances begun and not yet over. */
  readonly open = new Set<number>();
  /** Task results back that the front has not yet started to tell. */
  readonly notes = new Set<number>();
  /** The latest reply the webview began: its characters so far, whether heard yet, whether over. */
  reply: { utterance: number; chars: number; heard: boolean; over: boolean } | null = null;
  /** Bumped on every mark that can change whether the call is quiet. */
  version = 0;

  apply(m: TraceMark): void {
    const d = m.data ?? {};
    switch (m.name) {
      case "speech:speaking":
        this.speaking = d.value === 1;
        if (this.speaking && this.reply && !this.reply.over) this.reply.heard = true;
        this.version++;
        break;
      case "model-ask":
        this.asking.add(Number(d.turn));
        this.version++;
        break;
      case "model-done":
      case "model-failed":
        this.asking.delete(Number(d.turn));
        this.version++;
        break;
      case "speak-begun":
        this.open.add(Number(d.utterance));
        this.reply = { utterance: Number(d.utterance), chars: 0, heard: false, over: false };
        this.version++;
        break;
      case "speak-push-first":
      case "speak-push":
        if (this.reply && typeof d.chars === "number") this.reply.chars += d.chars;
        break;
      case "speak-stop":
        this.open.clear();
        if (this.reply) this.reply.over = true;
        this.version++;
        break;
      case "conv:spoken":
        // `underrun` can be a pause inside a reply that goes on: the reply is
        // not over, and `quietMs` is what catches it starting again.
        this.speaking = false;
        this.open.delete(Number(d.utterance));
        if (this.reply && d.reason !== "underrun" && this.reply.utterance === Number(d.utterance)) this.reply.over = true;
        this.version++;
        break;
      case "front:note":
        this.notes.add(Number(d.number));
        this.version++;
        break;
      case "front:notify":
        if (Array.isArray(d.numbers)) for (const n of d.numbers) this.notes.delete(Number(n));
        this.version++;
        break;
    }
  }

  /** Nothing playing, nothing asked, nothing begun and unsaid, no result waiting to be told. */
  quiet(): boolean {
    return !this.speaking && this.asking.size === 0 && this.open.size === 0 && this.notes.size === 0;
  }

  /** A reply of at least `minChars` is being heard right now. */
  longReplyPlaying(minChars: number): boolean {
    const r = this.reply;
    return Boolean(r && this.speaking && r.heard && !r.over && r.chars >= minChars);
  }
}

export interface DriverDeps {
  /** Every trace mark from here on, in order. Answers an unsubscribe. */
  subscribe(cb: (mark: TraceMark) => void): () => void;
  /** Play one clip into the call; resolves when its last sample is in. */
  feed(clip: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Milliseconds on any steady clock; settling counts its deadline on it. */
  now(): number;
  /** A driver row in the run's log. */
  mark(name: string, data?: Record<string, unknown>): void;
  /** Aborting ends the run at once, as failed, with the signal's reason. */
  signal?: AbortSignal;
  /**
   * How long the call may take to report `opened` before the run gives up. Off
   * unless given: a driver fed canned marks has no call to wait for.
   */
  callUpMs?: number;
}

/** Why a run stopped before the script was done. */
export class RunEnded extends Error {
  constructor(
    readonly kind: "call-ended" | "call-never-up" | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "RunEnded";
  }
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
  const state = new CallState();
  const waiters = new Set<{
    since: number;
    pred: (m: TraceMark) => boolean;
    done: () => void;
    fail: (e: Error) => void;
  }>();
  // Set once, by whatever ends the run first; every wait fails with it and
  // every step checks it before it acts.
  let ended: RunEnded | null = null;
  const end = (e: RunEnded) => {
    if (ended) return;
    ended = e;
    for (const w of [...waiters]) {
      waiters.delete(w);
      w.fail(e);
    }
  };
  const check = () => {
    if (ended) throw ended;
  };
  let up = false;
  const off = deps.subscribe((m) => {
    seen.push(m);
    state.apply(m);
    if (m.name === "conv:state" && typeof m.data?.running === "boolean") {
      // A close that comes before this call's own opening is the last call's
      // tail, not this one going away.
      if (m.data.running) up = true;
      else if (up) {
        end(new RunEnded("call-ended", `The call ended during the run (reason: ${String(m.data.reason ?? "unknown")}).`));
      }
    }
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
    if (ended) return Promise.reject(ended);
    return new Promise<boolean>((resolve, reject) => {
      const w = { since, pred, done: () => resolve(true), fail: reject };
      waiters.add(w);
      void deps.sleep(timeoutMs).then(() => {
        if (waiters.delete(w)) resolve(false);
      });
    });
  };

  /** Resolves true once `cond` holds, checked now and after every mark; false on timeout. */
  const waitUntil = (cond: () => boolean, timeoutMs: number) =>
    cond() ? Promise.resolve(true) : waitFor(() => cond(), seen.length, timeoutMs);

  /**
   * Quiet, and still quiet `quietMs` later with nothing having moved — a
   * reply that ran dry and picks up again, a result that just came back, a
   * request that just went out all start the wait over.
   */
  const settle = async (timeoutMs: number) => {
    const deadline = deps.now() + timeoutMs;
    for (;;) {
      const left = deadline - deps.now();
      if (left <= 0 || !(await waitUntil(() => state.quiet(), left))) return false;
      const v = state.version;
      await deps.sleep(script.quietMs);
      if (state.quiet() && state.version === v) return true;
    }
  };

  /** `next-reply-end`: a reply that started after `since`, then its end. */
  const waitNextReply = async (since: number, timeoutMs: number) => {
    const started = await waitFor(isReplyStart, since, timeoutMs);
    if (!started) return false;
    const startIdx = seen.findIndex((m, i) => i >= since && isReplyStart(m));
    return waitFor(isReplyEnd, startIdx + 1, timeoutMs);
  };

  /** The index just past the first `name` mark at or after `since`, or null on timeout. */
  const after = async (name: string, since: number, timeoutMs: number) => {
    const isIt = (m: TraceMark) => m.name === name;
    if (!(await waitFor(isIt, since, timeoutMs))) return null;
    return seen.findIndex((m, i) => i >= since && isIt(m)) + 1;
  };

  const outcomes: StepOutcome[] = [];
  let cursor = 0;
  const signal = deps.signal;
  const onAbort = () => end(new RunEnded("aborted", String(signal?.reason ?? "The run was cancelled.")));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  if (deps.callUpMs !== undefined) {
    void deps.sleep(deps.callUpMs).then(() => {
      if (!up) end(new RunEnded("call-never-up", `The call did not open within ${deps.callUpMs} ms.`));
    });
  }
  try {
    for (const [index, step] of script.steps.entries()) {
      check();
      deps.mark("step-wait", { index, clip: step.clip, start: step.start });
      let cued = true;
      let from = cursor;
      if (step.after) {
        const past = await after(step.after, 0, step.timeoutMs);
        if (past === null) cued = false;
        // A mark from long ago does not reach back past the previous clip.
        else from = Math.max(past, cursor);
      }
      // A mark that never came leaves the step to be fed on timeout.
      if (cued) {
        if (step.start === "reply-end") cued = await waitFor(isReplyEnd, from, step.timeoutMs);
        else if (step.start === "reply-start") cued = await waitFor(isReplyStart, from, step.timeoutMs);
        else if (step.start === "next-reply-end") {
          cued = await waitNextReply(step.after ? from : seen.length, step.timeoutMs);
        } else if (step.start === "long-reply") {
          cued = await waitUntil(() => state.longReplyPlaying(step.minChars), step.timeoutMs);
        }
      }
      if (!cued) deps.mark("step-timeout", { index, clip: step.clip });
      if (cued && step.expect === "turn" && script.settleMs > 0) {
        // Settled, then the offset, then still settled: a notice that starts in
        // the offset would otherwise be cut by the clip.
        let settled = await settle(script.settleMs);
        if (step.offsetMs > 0) await deps.sleep(step.offsetMs);
        if (settled && !state.quiet()) settled = await settle(script.settleMs);
        if (!settled) deps.mark("settle-timeout", { index, clip: step.clip });
      } else if (step.offsetMs > 0) await deps.sleep(step.offsetMs);
      if (step.start === "long-reply" && cued && !state.longReplyPlaying(step.minChars)) {
        // The reply ended in the offset: the clip lands in silence.
        deps.mark("step-late", { index, clip: step.clip });
      }
      check();
      deps.mark("step-feed", { index, clip: step.clip, text: step.text, expect: step.expect });
      await deps.feed(step.clip);
      cursor = seen.length;
      deps.mark("step-fed", { index, clip: step.clip });
      outcomes.push({ index, clip: step.clip, cued });
    }
    let since = cursor;
    if (script.finalAfter) {
      const past = await after(script.finalAfter, cursor, script.finalTimeoutMs);
      if (past === null) deps.mark("final-timeout", { after: script.finalAfter });
      else since = past;
    }
    for (let i = 0; i < script.finalReplies; i++) {
      const ok = await waitFor(isReplyEnd, since, script.finalTimeoutMs);
      if (!ok) {
        deps.mark("final-timeout", { reply: i });
        break;
      }
      since = seen.findIndex((m, j) => j >= since && isReplyEnd(m)) + 1;
    }
    await deps.sleep(script.tailMs);
    check();
  } finally {
    off();
    signal?.removeEventListener("abort", onAbort);
  }
  return outcomes;
}
