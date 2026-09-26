// What the phone's reflow column looks like (docs/70): the four ladders the Aa
// sheet steps through, the four papers, and the slot on this device that
// remembers where the reader left them.
//
// Here rather than beside the sheet because the column is what reads it:
// flow-mount.ts writes the baseline stylesheet out of these numbers and
// flow-gesture.ts guesses an off-screen document's height with them. The sheet
// only picks a rung.
//
// localStorage, the same reasoning as the paper tint's (base/paper-tint.ts):
// this is one device's view of the text, not a fact about the book, so an iPad
// keeps its own paper and its own column. And it is read synchronously, so the
// column mounts at the size the reader left it at instead of at 17px and then
// jumping.

/** The two methods a per-device preference needs (base/pref-store.ts). */
export interface FlowDisplayStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FlowPaperName = "white" | "paper" | "green" | "dark";

export interface FlowPaper {
  label: string;
  /** What the column is painted on, under the book. */
  surface: string;
  /**
   * Multiplied over the sheet and the book's own colours, or null where
   * nothing is. White paper comes out exactly this colour and black ink stays
   * black (engine/page-wash.ts).
   */
  wash: string | null;
  /** The body text's colour. */
  ink: string;
  /**
   * Whether the book's own html/body background and its text colours are
   * overruled rather than multiplied. White cannot be multiplied down to a
   * dark grey, so the dark paper is not a wash at all: it paints the surface
   * and takes the book's two global colours away.
   */
  overrules: boolean;
}

// The swatch in the sheet is filled with what the page ends up being: the wash
// where there is one, the surface where there is not.
export function flowPaperSwatch(paper: FlowPaper): string {
  return paper.wash ?? paper.surface;
}

export const FLOW_PAPERS: Record<FlowPaperName, FlowPaper> = {
  // The reader with nothing over it: the sheet the column has always been when
  // the app's tint is off.
  white: { label: "White", surface: "#ffffff", wash: null, ink: "#1c1c1c", overrules: false },
  // The app's own paper tint, as a value rather than as a switch. Inside this
  // screen the Aa choice is the only one that speaks, so the column writes the
  // colour out instead of reading --page-wash; the two never stack.
  paper: { label: "Paper", surface: "#ffffff", wash: "#f6efdc", ink: "#1c1c1c", overrules: false },
  // The same multiplication one quarter turn round the wheel: as light as the
  // paper, and as little of a hue as a wash can carry and still read as green.
  green: { label: "Green", surface: "#ffffff", wash: "#e4f0de", ink: "#1c1c1c", overrules: false },
  dark: { label: "Dark", surface: "#1b1c1e", wash: null, ink: "#c8c5bf", overrules: true },
};

export const FLOW_PAPER_NAMES: readonly FlowPaperName[] = ["white", "paper", "green", "dark"];

/** Five rungs with the column's long-standing 17px in the middle. */
export const FLOW_FONT_STEPS: readonly number[] = [14, 15, 17, 19, 21];

export const FLOW_LINE_STEPS: readonly { value: number; label: string }[] = [
  { value: 1.4, label: "Tight" },
  { value: 1.6, label: "Standard" },
  { value: 1.85, label: "Loose" },
];

export const FLOW_PAD_STEPS: readonly { value: number; label: string }[] = [
  { value: 20, label: "Narrow" },
  { value: 36, label: "Wide" },
];

/** Room above the first line and below the last of each document. Not a choice. */
export const FLOW_PAD_Y = 24;

/**
 * How the reader moves through the book: one long column scrolled with the
 * finger, or screens turned left and right (docs/79).
 */
export type FlowMode = "scroll" | "paged";

export const FLOW_MODES: readonly FlowMode[] = ["scroll", "paged"];

export interface FlowDisplay {
  fontPx: number;
  lineHeight: number;
  /** The column's side padding. */
  padX: number;
  paper: FlowPaperName;
  mode: FlowMode;
}

// The column as it has been since docs/70, and the app's own default ground:
// the tint is off until it is switched on, so opening the sheet for the first
// time shows the screen the reader already has.
export const FLOW_DISPLAY_DEFAULT: FlowDisplay = {
  fontPx: 17,
  lineHeight: 1.6,
  padX: 20,
  paper: "white",
  // The iPad's EPUB opens in its vertical column until the reader switches.
  mode: "scroll",
};

export const FLOW_DISPLAY_KEY = "phone-display";

function onLadder(ladder: readonly number[], value: unknown, fallback: number): number {
  return typeof value === "number" && ladder.includes(value) ? value : fallback;
}

/**
 * A stored or hand-edited value as a display. Every field is checked against
 * its own ladder and falls back on its own: a slot holding a font size nobody
 * offers must not cost the reader the paper they chose.
 */
export function normalizeFlowDisplay(value: unknown): FlowDisplay {
  if (typeof value !== "object" || value === null) return FLOW_DISPLAY_DEFAULT;
  const v = value as Record<string, unknown>;
  const paper = v.paper;
  return {
    fontPx: onLadder(FLOW_FONT_STEPS, v.fontPx, FLOW_DISPLAY_DEFAULT.fontPx),
    lineHeight: onLadder(
      FLOW_LINE_STEPS.map((s) => s.value),
      v.lineHeight,
      FLOW_DISPLAY_DEFAULT.lineHeight,
    ),
    padX: onLadder(
      FLOW_PAD_STEPS.map((s) => s.value),
      v.padX,
      FLOW_DISPLAY_DEFAULT.padX,
    ),
    paper:
      typeof paper === "string" && FLOW_PAPER_NAMES.includes(paper as FlowPaperName)
        ? (paper as FlowPaperName)
        : FLOW_DISPLAY_DEFAULT.paper,
    mode: FLOW_MODES.includes(v.mode as FlowMode) ? (v.mode as FlowMode) : FLOW_DISPLAY_DEFAULT.mode,
  };
}

export function readFlowDisplay(store: FlowDisplayStore | null): FlowDisplay {
  let raw: string | null = null;
  try {
    raw = store?.getItem(FLOW_DISPLAY_KEY) ?? null;
  } catch {
    // A storage that throws on read is a storage that is not there.
    return FLOW_DISPLAY_DEFAULT;
  }
  if (raw === null) return FLOW_DISPLAY_DEFAULT;
  try {
    return normalizeFlowDisplay(JSON.parse(raw));
  } catch {
    return FLOW_DISPLAY_DEFAULT;
  }
}

export function writeFlowDisplay(store: FlowDisplayStore | null, display: FlowDisplay): void {
  try {
    store?.setItem(FLOW_DISPLAY_KEY, JSON.stringify(display));
  } catch {
    // Full or disabled storage: the choice still holds for this session.
  }
}

/** Which rung of the size ladder a display is on. */
export function flowFontStep(display: FlowDisplay): number {
  const i = FLOW_FONT_STEPS.indexOf(display.fontPx);
  return i < 0 ? FLOW_FONT_STEPS.indexOf(FLOW_DISPLAY_DEFAULT.fontPx) : i;
}

/** One rung up or down, or the same display where the ladder ends. */
export function stepFlowFont(display: FlowDisplay, delta: number): FlowDisplay {
  const next = flowFontStep(display) + delta;
  if (next < 0 || next >= FLOW_FONT_STEPS.length) return display;
  return { ...display, fontPx: FLOW_FONT_STEPS[next] };
}
