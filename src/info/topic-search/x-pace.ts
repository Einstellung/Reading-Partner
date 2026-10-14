// How fast the X reader goes (docs/info/88 「节奏」): what a screen is, how long
// a screen is read, how a scroll is broken up, when to pause. Pure: the reader
// passes its own random source, so a test can pin every draw.

export type Range = readonly [number, number];

export interface XPace {
  /** The page's size in CSS pixels; fitted to the screen the page reports (`fitViewport`). */
  viewport: { width: number; height: number };
  /** What a screen's reading time is counted on: the posts' own text and quoted text, or the whole post as the page lays it out (names, counts, card titles). */
  count: "text" | "whole";
  /** Reading speed for the new text on a screen. */
  charsPerSecond: Range;
  /** Added to every screen. */
  screenExtraMs: Range;
  /** One screen's stay is never longer. */
  maxScreenMs: number;
  /** A long pause after this many screens (drawn again after each). */
  longPauseEvery: Range;
  longPauseMs: Range;
  /** One scroll, in screens, made of `scrollSteps` small steps `stepGapMs` apart. */
  scrollScreens: Range;
  scrollSteps: Range;
  stepGapMs: Range;
  /** Reading comes in 2-3 sittings of 30-60 minutes with 10-30 minutes off between. */
  segments: Range;
  segmentMs: Range;
  segmentGapMs: Range;
  /** From one search page to the next. */
  betweenPagesMs: Range;
}

const MIN = 60_000;

/** 88's first table, as the probe ran it: a 1440x900 page, the whole post counted. */
export const PROBE_PACE: XPace = {
  viewport: { width: 1440, height: 900 },
  count: "whole",
  charsPerSecond: [12, 20],
  screenExtraMs: [2_000, 6_000],
  maxScreenMs: 180_000,
  longPauseEvery: [5, 10],
  longPauseMs: [30_000, 120_000],
  scrollScreens: [0.6, 0.9],
  scrollSteps: [3, 4],
  stepGapMs: [150, 400],
  segments: [2, 3],
  segmentMs: [30 * MIN, 60 * MIN],
  segmentGapMs: [10 * MIN, 30 * MIN],
  betweenPagesMs: [20_000, 60_000],
};

/**
 * The reader's pace: the same speeds and pauses, a portrait 1440x2560 monitor's
 * page (a browser's top bars take 140 px), and reading time counted on the
 * words a reader reads rather than everything the post's box holds.
 */
export const X_PACE: XPace = {
  ...PROBE_PACE,
  viewport: { width: 1440, height: 2420 },
  count: "text",
};

/** A draw in [lo, hi). */
export function draw(range: Range, random: () => number): number {
  return range[0] + random() * (range[1] - range[0]);
}

/** A whole number in [lo, hi]. */
export function drawInt(range: Range, random: () => number): number {
  return Math.floor(range[0] + random() * (range[1] - range[0] + 1));
}

/** Browser bars and a desktop's panel: what a maximised window loses off the screen's height. */
export const WINDOW_CHROME_PX = 140;

/**
 * The viewport a real browser could have on this screen: no wider than the
 * screen and no taller than its available height less the window's bars. The
 * page can read both `screen` and `innerHeight`, and a page taller than its
 * screen is not a browser anyone has.
 */
export function fitViewport(
  wanted: { width: number; height: number },
  screen: { availWidth: number; availHeight: number } | null,
): { width: number; height: number } {
  if (!screen || screen.availWidth <= 0 || screen.availHeight <= 0) return wanted;
  return {
    width: Math.min(wanted.width, screen.availWidth),
    height: Math.max(600, Math.min(wanted.height, screen.availHeight - WINDOW_CHROME_PX)),
  };
}

/** How long to stay on a screen that brought `chars` characters of new text into view. */
export function screenStayMs(chars: number, pace: XPace, random: () => number): number {
  const reading = (Math.max(0, chars) / draw(pace.charsPerSecond, random)) * 1000;
  return Math.round(Math.min(pace.maxScreenMs, reading + draw(pace.screenExtraMs, random)));
}

/** One scroll as its small steps, in pixels, for a page `viewport` pixels tall. */
export function scrollSteps(viewport: number, pace: XPace, random: () => number): number[] {
  const total = draw(pace.scrollScreens, random) * viewport;
  const parts = Math.max(1, drawInt(pace.scrollSteps, random));
  const steps: number[] = [];
  let left = total;
  for (let i = 0; i < parts; i++) {
    // Uneven steps, as a wheel or a trackpad gives them.
    const share = i === parts - 1 ? left : (total / parts) * (0.7 + 0.6 * random());
    const step = Math.round(Math.min(left, share));
    steps.push(step);
    left -= step;
  }
  return steps.filter((s) => s > 0);
}
