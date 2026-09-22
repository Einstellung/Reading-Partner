// A turn whose stream went silent and never said so.
//
// The reader's turn streams over one HTTP connection. On iOS the app has no
// background mode, so a few seconds after it is switched away the process is
// frozen; the connection is gone by the time it thaws and the stream that was
// being read produces nothing more — no bytes, no error, no end. pi is still
// inside `drive`, so the run stays open, the lane stays held (held.ts serialises
// turns on it) and the thread stays registered as busy. Everything the reader
// says next is queued into that corpse as a steer (docs/72) and handed to
// nobody. What they see is a reply that stopped mid-sentence and a question
// that gets no answer at all.
//
// So the silence is measured. This file is the measuring and nothing else: no
// harness, no provider, no timers of its own beyond the ones handed in, so the
// tests drive it on a virtual clock.
//
// Two things end a watch:
//
//   silence    no event from the provider for `stallMs`, read off the wall
//              clock rather than off a timer that was armed before the freeze.
//              A frozen webview's timers do not fire, and what they do on the
//              way back is the platform's business; the wall clock jumped
//              either way, so the tick that lands after the thaw is the one
//              that notices.
//   the way back
//              the app came to the front after being away, and the stream
//              produced nothing for the whole of the absence. That is a dead
//              connection and there is no reason to sit out the rest of the
//              window for it. A short absence does not count: switching apps
//              for a moment does not stop a stream, and cutting a live one
//              costs a whole turn.
//
// The clock is paused while a tool runs. A sub-agent or a page fetch can take
// minutes and says nothing in between; what is being measured is the provider's
// silence, not the turn's.

import { observeAppLifecycle } from "../../platform/app/lifecycle";

/** How long a streaming turn may say nothing before it is taken as dead. */
export const TURN_STALL_MS = 90_000;

/**
 * How long the app has to have been away before a stream that produced nothing
 * while it was gone is cut the moment it comes back.
 */
export const AWAY_STALL_MS = 20_000;

/** How often the wall clock is read. */
export const STALL_TICK_MS = 5_000;

/** What the reader's surface is told. */
export const STALL_MESSAGE = "the model stopped answering partway through";

/** The failure a stall raises, so a caller can tell it from a provider error. */
export class StallError extends Error {
  constructor(message: string = STALL_MESSAGE) {
    super(message);
    this.name = "StallError";
  }
}

export function isStall(thrown: unknown): boolean {
  return thrown instanceof StallError;
}

/** Injected clock and ticker; the real ones unless a test hands its own in. */
export interface StallTimers {
  now(): number;
  /** Calls `tick` every `ms` until the returned function is called. */
  every(ms: number, tick: () => void): () => void;
}

export const realStallTimers: StallTimers = {
  now: () => Date.now(),
  every: (ms, tick) => {
    const id = setInterval(tick, ms);
    // A ticker is not a reason for a process to stay up. Node and Bun both
    // offer this; a browser's timer id is a number and has no such method.
    (id as unknown as { unref?: () => void }).unref?.();
    return () => clearInterval(id);
  },
};

export interface StallOptions {
  /** Silence this long ends the watch. TURN_STALL_MS unless a caller says. */
  stallMs?: number;
  awayMs?: number;
  tickMs?: number;
  timers?: StallTimers;
  /** Called once, when the stream is judged dead. */
  onStall: () => void;
}

export interface StallWatch {
  /** The provider said something. */
  beat(): void;
  /** A tool started; the provider is not the one being waited on. */
  hold(): void;
  /** A tool ended. */
  unhold(): void;
  /** The turn is over, one way or another. Idempotent. */
  stop(): void;
  /**
   * The longest this turn's provider has gone without saying anything, in
   * milliseconds. What the window has to clear: a turn cut at less than its own
   * longest silence would have been cut mid-answer. Tool time is not in it.
   */
  longestSilence(): number;
}

/**
 * Every watch running in this process, and where the app is. One registry per
 * process; a test makes its own rather than reaching for the module's.
 */
export interface StallWatches {
  watch(options: StallOptions): StallWatch;
  /** The app went away at `at`. */
  away(at: number): void;
  /** The app came back at `at`: anything silent for the whole absence is cut. */
  back(at: number): void;
}

interface Entry {
  lastBeat: number;
  longest: number;
  held: number;
  /** The absence this watch is cut by, kept per watch rather than per registry. */
  awayMs: number;
  fire: () => void;
}

export function createStallWatches(defaults: { timers?: StallTimers } = {}): StallWatches {
  const live = new Set<Entry>();
  let awaySince: number | null = null;

  return {
    watch(options) {
      const timers = options.timers ?? defaults.timers ?? realStallTimers;
      const stallMs = options.stallMs ?? TURN_STALL_MS;
      const awayMs = options.awayMs ?? AWAY_STALL_MS;
      const tickMs = options.tickMs ?? STALL_TICK_MS;
      let done = false;
      const entry: Entry = {
        lastBeat: timers.now(),
        longest: 0,
        held: 0,
        awayMs,
        fire: () => {},
      };

      const end = (): void => {
        if (done) return;
        done = true;
        live.delete(entry);
        cancel();
      };
      entry.fire = () => {
        if (done) return;
        end();
        options.onStall();
      };

      const cancel = timers.every(tickMs, () => {
        if (done || entry.held > 0) return;
        if (timers.now() - entry.lastBeat >= stallMs) entry.fire();
      });
      live.add(entry);

      // The silence that just ended goes on the record before the clock moves.
      // Not on the way out of a tool: what was quiet there was the tool.
      const mark = (): void => {
        const at = timers.now();
        entry.longest = Math.max(entry.longest, at - entry.lastBeat);
        entry.lastBeat = at;
      };

      return {
        beat: mark,
        hold() {
          mark();
          entry.held += 1;
        },
        unhold() {
          entry.held = Math.max(0, entry.held - 1);
          entry.lastBeat = timers.now();
        },
        stop: end,
        longestSilence: () => Math.max(entry.longest, entry.held > 0 ? 0 : timers.now() - entry.lastBeat),
      };
    },

    away(at) {
      // The first leaving wins: blur then visibilitychange is one departure,
      // and the earlier of the two is when the stream really stopped being read.
      awaySince ??= at;
    },

    back(at) {
      const since = awaySince;
      awaySince = null;
      if (since === null) return;
      for (const entry of [...live]) {
        if (at - since < entry.awayMs) continue;
        // Something arrived while the app was away, so the connection outlived
        // the absence and the ordinary window applies to it.
        if (entry.lastBeat > since) continue;
        if (entry.held > 0) continue;
        entry.fire();
      }
    },
  };
}

// The one registry the app's turns run on. A module singleton for the same
// reason live-turns.ts is one: a turn outlives the tree that started it, and
// the lifecycle edge that has to reach it is bound somewhere else entirely.
let shared: StallWatches | null = null;

export function stallWatches(): StallWatches {
  shared ??= createStallWatches();
  return shared;
}

/** Throw the registry away. For tests, which are not one process per case. */
export function resetStallWatches(): void {
  shared = null;
}

/**
 * Tell the registry where the app is. Bound once, by the shell: the way out is
 * the last moment the stream was being read, and the way back is the first
 * moment anything can be done about it (platform/app/lifecycle.ts).
 */
export function watchAppAwayForStalls(
  win: Parameters<typeof observeAppLifecycle>[0],
  watches: StallWatches = stallWatches(),
  now: () => number = Date.now,
): () => void {
  return observeAppLifecycle(win, {
    onBackground: () => watches.away(now()),
    onForeground: () => watches.back(now()),
  });
}

/**
 * How long each finished turn's worst silence was, kept where a development
 * build can read it back. This is how TURN_STALL_MS was measured and how it is
 * re-checked when a model or a prompt changes: the window has to clear the
 * worst gap a real turn produces, and a gap is only visible from inside the
 * watch. The array is capped so a long session does not grow it without bound.
 *
 * Only a development build fills it (turn.ts, behind `import.meta.env.DEV`).
 */
export interface SilenceRecord {
  surface: string;
  ms: number;
  at: number;
}

const SILENCE_KEPT = 200;

export function recordLongestSilence(record: SilenceRecord): void {
  const host = globalThis as { __stallSilences?: SilenceRecord[] };
  const kept = (host.__stallSilences ??= []);
  kept.push(record);
  if (kept.length > SILENCE_KEPT) kept.splice(0, kept.length - SILENCE_KEPT);
}
