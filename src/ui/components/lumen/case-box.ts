// Where the red case stands beside Lumen (docs/68), measured off the generation
// the raster was cut from rather than described in prose.
//
// The two pictures are the evidence. In `docs/assets/lumen/lumen-with-case.png`
// the case and the body were drawn together, so the composition — how tall the
// case is against the body, how far it leans in over the body's left side, that
// the two stand on the same line — is a set of ratios that can be read off it.
// In `lumen-body.webp` the round body sits at a known place inside its own
// square. Put the ratios back through that square and the corner reproduces the
// generation, at 72px or at any other size.
//
// Arithmetic and no React, beside box-cards.ts, for the same reason: these are
// the numbers worth a test.

/** The body raster's square, and the round body's ink inside it, in its pixels. */
export const BODY_RASTER_PX = 512;
export const BODY_INK_PX = { left: 96, right: 414, top: 159, bottom: 469 } as const;

/**
 * The generation, in its own pixels. `BODY` is the round body without the tuft
 * — the tuft is a stem and a flame, and a flame is not what the case is scaled
 * against. `CASE` is the re-cut raster's box in the same picture.
 */
export const SOURCE_BODY_PX = { left: 412, right: 1065, top: 454, bottom: 1074 } as const;
export const SOURCE_CASE_PX = { left: 148, right: 488, top: 718, bottom: 1072 } as const;

function span(box: { left: number; right: number; top: number; bottom: number }) {
  return { w: box.right - box.left + 1, h: box.bottom - box.top + 1 };
}

const SRC_BODY = span(SOURCE_BODY_PX);
const SRC_CASE = span(SOURCE_CASE_PX);
const INK = span(BODY_INK_PX);

/**
 * The case against the body, as the generation has it: a little over half the
 * body's height, its right edge a tenth of the body's width in from the body's
 * left edge — which is what puts it in front of the body's lower left — and its
 * feet on the body's own line.
 */
export const CASE_OF_BODY = {
  height: SRC_CASE.h / SRC_BODY.h,
  width: SRC_CASE.w / SRC_BODY.w,
  /** The case's right edge, from the body's left edge, in body widths. */
  rightFromBodyLeft: (SOURCE_CASE_PX.right - SOURCE_BODY_PX.left) / SRC_BODY.w,
  /** How far the case's feet are above the body's, in body heights. */
  bottomAboveBodyBottom: (SOURCE_BODY_PX.bottom - SOURCE_CASE_PX.bottom) / SRC_BODY.h,
} as const;

/** The case raster's own proportions, which the drawn box keeps. */
export const CASE_ASPECT = SRC_CASE.w / SRC_CASE.h;

export interface CaseRect {
  /** All four as fractions of the component's square box. `left` goes negative:
   *  the case stands off the body's left edge, outside the body's own square. */
  left: number;
  bottom: number;
  width: number;
  height: number;
}

/** The case's box, as fractions of the box Lumen is drawn in. */
export function caseRect(): CaseRect {
  const height = (CASE_OF_BODY.height * INK.h) / BODY_RASTER_PX;
  const width = height * CASE_ASPECT;
  const right =
    (BODY_INK_PX.left + CASE_OF_BODY.rightFromBodyLeft * INK.w) / BODY_RASTER_PX;
  const bottom =
    (BODY_RASTER_PX - (BODY_INK_PX.bottom - CASE_OF_BODY.bottomAboveBodyBottom * INK.h)) /
    BODY_RASTER_PX;
  return { left: right - width, bottom, width, height };
}

/** The same box in CSS pixels, for a body drawn at `boxPx` square. */
export function caseRectPx(boxPx: number): CaseRect {
  const r = caseRect();
  return {
    left: r.left * boxPx,
    bottom: r.bottom * boxPx,
    width: r.width * boxPx,
    height: r.height * boxPx,
  };
}

/**
 * What the button around the case grows by on every side so a finger has 44px
 * to land on, where the case itself draws about 24. CSS pixels and not a
 * fraction: a touch target is a thumb, and a thumb is the same size whatever
 * the body is drawn at.
 */
export const CASE_HIT_PAD_PX = 10;

/** The hit area a `boxPx` corner ends up with, for the contract test. */
export function caseHitPx(boxPx: number): { width: number; height: number } {
  const r = caseRectPx(boxPx);
  return { width: r.width + 2 * CASE_HIT_PAD_PX, height: r.height + 2 * CASE_HIT_PAD_PX };
}
